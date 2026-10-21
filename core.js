(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BatReviewCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // All records are arrays in original CSV order. Canonical column indices are
  // only a view: the imported header spelling and every cell remain untouched.
  const ALIASES = {
    autoId: ["AUTOID", "SPECIESAUTOID", "AUTOMATICID", "AUTOMATICIDENTIFICATION", "AUTOSPECIES"],
    file: ["INFILE", "INPUTFILE", "FILENAME", "RECORDINGFILE", "FILE"],
    ratio: ["MATCHRATIO", "MATCHINGRATIO", "AUTOIDMATCHRATIO", "AUTOIDMATCHINGRATIO"],
    matching: ["MATCHING", "MATCHINGPULSES", "MATCHEDPULSES", "MATCHES", "AUTOIDMATCHING", "AUTOIDMATCHINGPULSES"],
    pulses: ["PULSES", "PULSECOUNT", "NUMBEROFPULSES", "AUTOIDPULSES"],
    margin: ["MARGIN", "CLASSIFICATIONMARGIN", "AUTOIDMARGIN"],
    manualId: ["MANUALID", "MANUALIDENTIFICATION", "SPECIESMANUALID"],
    folder: ["FOLDER", "SUBFOLDER"],
    indir: ["INDIR", "INPUTDIRECTORY", "INPUTDIR"],
    offset: ["OFFSET", "OFFSETS", "STARTOFFSET", "OFFSETSECONDS"],
    channel: ["CHANNEL", "CHANNELNUMBER"],
    date: ["DATE", "RECORDINGDATE"],
    date12: ["DATE12", "NIGHTDATE"],
    time: ["TIME", "RECORDINGTIME"],
    alternate1: ["ALTERNATE1", "ALTERNATIVE1", "ALT1", "ALTERNATEID1", "AUTOIDALTERNATE1"],
    alternate2: ["ALTERNATE2", "ALTERNATIVE2", "ALT2", "ALTERNATEID2", "AUTOIDALTERNATE2"]
  };
  const KEY_FOR_ALIAS = Object.create(null);
  Object.keys(ALIASES).forEach(key => ALIASES[key].forEach(alias => { KEY_FOR_ALIAS[alias] = key; }));

  function normalizedHeader(value) {
    return String(value == null ? "" : value).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function canonicalColumns(headers) {
    const columns = Object.fromEntries(Object.keys(ALIASES).map(key => [key, -1]));
    const seen = new Set();
    headers.forEach((header, index) => {
      const cleaned = String(header).trim();
      if (!cleaned) throw new Error("L’en-tête CSV " + (index + 1) + " est vide. Donnez un nom unique à chaque colonne.");
      const identity = cleaned.toUpperCase();
      if (seen.has(identity)) throw new Error("En-tête CSV en double : " + cleaned + ". Les noms de colonnes doivent être uniques.");
      seen.add(identity);
      const key = KEY_FOR_ALIAS[normalizedHeader(header)];
      if (key) {
        if (columns[key] !== -1) throw new Error("Plusieurs en-têtes CSV désignent " + header + ". Gardez une seule colonne sans ambiguïté.");
        columns[key] = index;
      }
    });
    return columns;
  }

  // RFC-style quoted cells, including embedded CR/LF, escaped quotes, and a
  // final record without a newline. Quotes in unquoted preamble text are literal.
  function tokenize(text, delimiter, sniffHeader) {
    const records = [];
    let record = [], value = "", inQuotes = false, afterQuote = false;
    let touched = false, physicalLine = 1, recordLine = 1;
    function fail(message) {
      const error = new Error(message);
      // Preserve complete prefix records so delimiter detection cannot hide a
      // malformed data row by falling back to an unrelated CSV dialect.
      error.parsedRecords = records.slice();
      throw error;
    }
    function finishCell() { record.push(value); value = ""; afterQuote = false; }
    function finishRecord() {
      finishCell();
      const recognized = sniffHeader && !isBlank(record) && !isComment(record) && recognizedKeys(record).has("autoId");
      // During detection retain only a generic first header and a recognized
      // header. A wrong delimiter can otherwise retain another entire dataset.
      if (!sniffHeader || ((!isBlank(record) && !isComment(record)) && (!records.length || recognized))) records.push({ values: record, line: recordLine });
      record = []; touched = false; recordLine = physicalLine;
      return recognized;
    }
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (inQuotes) {
        if (char === '"') {
          if (text[index + 1] === '"') { value += '"'; index++; }
          else { inQuotes = false; afterQuote = true; }
        } else {
          value += char;
          if (char === "\n" || (char === "\r" && text[index + 1] !== "\n")) physicalLine++;
        }
        touched = true;
        continue;
      }
      if (char === delimiter) { finishCell(); touched = true; continue; }
      if (char === "\r" || char === "\n") {
        if (char === "\r" && text[index + 1] === "\n") index++;
        physicalLine++;
        if (finishRecord()) return records;
        continue;
      }
      if (char === '"' && value === "" && !afterQuote) { inQuotes = true; touched = true; continue; }
      if (afterQuote) {
        // Common exporters insert spaces between a closing quote and delimiter.
        if (char === " " || char === "\t") continue;
        fail("Texte inattendu après une cellule CSV entre guillemets, vers la ligne " + physicalLine + ".");
      }
      value += char; touched = true;
    }
    if (inQuotes) fail("Guillemets non refermés dans une cellule CSV, vers la ligne " + recordLine + ".");
    if (touched || record.length || value !== "") finishRecord();
    return records;
  }

  function isBlank(values) { return values.every(value => value.trim() === ""); }
  function isComment(values) { return /^\s*(?:#|\/\/)/.test(values[0] || ""); }
  function recognizedKeys(values) { return new Set(values.map(value => KEY_FOR_ALIAS[normalizedHeader(value)]).filter(Boolean)); }

  // Detect comma, semicolon, or tab; ignore blank/comment and exporter preambles
  // before a recognisable Kaleidoscope AUTO-ID header. Generic CSVs are accepted
  // with a warning when no AUTO-ID header is found.
  function parseCSV(input, explicitDelimiter) {
    if (typeof input !== "string") throw new TypeError("Le contenu CSV doit être du texte.");
    const text = input.replace(/^\uFEFF/, "");
    if (!text.trim()) throw new Error("Le fichier CSV est vide.");
    if (explicitDelimiter != null && ![",", ";", "\t"].includes(explicitDelimiter)) throw new Error("Utilisez une virgule, un point-virgule ou une tabulation comme séparateur CSV.");
    const candidates = [];
    const errors = [];
    (explicitDelimiter ? [explicitDelimiter] : [",", ";", "\t"]).forEach(delimiter => {
      try {
        const parsed = tokenize(text, delimiter, true);
        const first = parsed.findIndex(item => !isBlank(item.values) && !isComment(item.values));
        if (first < 0) return;
        let headerIndex = parsed.findIndex(item => !isBlank(item.values) && !isComment(item.values) && recognizedKeys(item.values).has("autoId"));
        const recognized = headerIndex >= 0;
        if (!recognized) headerIndex = first;
        const keys = recognizedKeys(parsed[headerIndex].values);
        candidates.push({ delimiter, parsed, headerIndex, recognized, keyCount: keys.size, width: parsed[headerIndex].values.length });
      } catch (error) {
        const header = (error.parsedRecords || []).find(item => recognizedKeys(item.values).has("autoId"));
        errors.push({ error, recognized: Boolean(header), keyCount: header ? recognizedKeys(header.values).size : 0 });
      }
    });
    if (!candidates.length) throw (errors[0] && errors[0].error) || new Error("Le fichier CSV n’a pas de ligne d’en-tête.");
    candidates.sort((a, b) => Number(b.recognized) - Number(a.recognized) || b.keyCount - a.keyCount || b.width - a.width);
    const chosen = candidates[0];
    const malformed = errors.find(item => item.recognized && (!chosen.recognized || item.keyCount >= chosen.keyCount));
    if (malformed) throw malformed.error;
    // Decode the selected dialect fully once; malformed data now fails in that
    // dialect rather than being mistaken for a different kind of CSV.
    const parsed = tokenize(text, chosen.delimiter);
    const headerIndex = chosen.recognized ? parsed.findIndex(item => !isBlank(item.values) && !isComment(item.values) && recognizedKeys(item.values).has("autoId")) : parsed.findIndex(item => !isBlank(item.values) && !isComment(item.values));
    const headers = parsed[headerIndex].values.slice();
    canonicalColumns(headers);
    const records = [], warnings = [];
    const preambleCount = parsed.slice(0, headerIndex).filter(item => !isBlank(item.values)).length;
    if (preambleCount) warnings.push(preambleCount + " ligne(s) de préambule ou de commentaire ignorée(s) avant l’en-tête CSV.");
    if (!chosen.recognized) warnings.push("Aucune colonne AUTO-ID reconnue ; tous les contacts doivent être identifiés.");
    parsed.slice(headerIndex + 1).forEach(item => {
      if (isBlank(item.values)) return;
      if (item.values.length > headers.length) throw new Error("La ligne CSV " + item.line + " contient " + item.values.length + " valeurs, mais l’en-tête comporte " + headers.length + " colonnes. Vérifiez le séparateur ou mettez entre guillemets les cellules contenant ce séparateur.");
      const values = item.values.slice();
      if (values.length < headers.length) {
        warnings.push("La ligne CSV " + item.line + " a des cellules finales manquantes ; elles ont été complétées par des valeurs vides.");
        while (values.length < headers.length) values.push("");
      }
      records.push(values);
    });
    if (!records.length) warnings.push("Le fichier CSV contient un en-tête, mais aucun contact.");
    return { headers, records, delimiter: chosen.delimiter, warnings };
  }

  function parseNumber(value, options) {
    const settings = options || {};
    let text = String(value == null ? "" : value).trim();
    if (!text) return null;
    const percent = /%$/.test(text);
    if (percent) {
      if (!settings.ratio) return null;
      text = text.slice(0, -1).trim();
    }
    // Decimal commas are supported. Ambiguous grouping separators are rejected.
    if (text.includes(",") && !text.includes(".") && (text.match(/,/g) || []).length === 1) text = text.replace(",", ".");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
    let number = Number(text);
    if (percent) number /= 100;
    if (!Number.isFinite(number) || number < 0 || (settings.integer && !Number.isInteger(number))) return null;
    if (settings.ratio && number > 1) return null;
    return number;
  }

  function normalizeAutoId(value) {
    const trimmed = String(value == null ? "" : value).trim();
    const identity = trimmed.toUpperCase().replace(/[\s_-]+/g, "");
    if (!identity || identity === "UNCLASSIFIED") return { autoId: "Unclassified", kind: "unclassified", key: "unclassified" };
    if (["NOID", "NOAUTOID", "NOIDENTIFICATION"].includes(identity)) return { autoId: "No ID", kind: "noid", key: "noid" };
    if (identity === "NOISE") return { autoId: "Noise", kind: "noise", key: "noise" };
    return { autoId: trimmed, kind: "species", key: trimmed.toUpperCase() };
  }

  function roundingAllowance(source) {
    let text = String(source).trim();
    const percent = /%$/.test(text);
    if (percent) text = text.slice(0, -1).trim();
    text = text.replace(",", ".");
    const parts = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text);
    if (!parts) return 0;
    const digits = (parts[1] || parts[2] || "").length;
    const exponent = Number(parts[3] || 0);
    // Unadorned endpoints 0 and 1 represent exact ratios; otherwise allow half
    // a unit in the exported decimal precision, including percentage notation.
    if (!percent && digits === 0 && exponent === 0) return 0;
    return 0.5 * Math.pow(10, exponent - digits) / (percent ? 100 : 1);
  }

  function descendingMissingLast(left, right) {
    if (left == null && right == null) return 0;
    if (left == null) return 1;
    if (right == null) return -1;
    return right - left;
  }

  // Ranking is a review order, never a probability or a final species label.
  // Comparison is lexicographic: MATCHING, MATCH RATIO, MARGIN; source order is
  // the stable last tie-breaker. Scores are never compared across species.
  function compareContacts(left, right) {
    return descendingMissingLast(left.matching, right.matching) ||
      descendingMissingLast(left.ratio, right.ratio) ||
      descendingMissingLast(left.margin, right.margin) || left.index - right.index;
  }

  function analyze(headers, records) {
    if (!Array.isArray(headers) || !Array.isArray(records)) throw new TypeError("L’analyse attend des tableaux d’en-têtes et d’enregistrements.");
    const columns = canonicalColumns(headers);
    const warnings = [];
    if (columns.autoId < 0) warnings.push("AUTO-ID est absent. Chaque ligne reste disponible pour une identification manuelle.");
    ["matching", "ratio", "margin"].forEach(key => {
      if (columns[key] < 0) warnings.push("Colonne " + (key === "ratio" ? "MATCH RATIO" : key.toUpperCase()) + " absente ; le classement utilise les autres champs valides.");
    });
    if (columns.date12 < 0 && columns.date >= 0) warnings.push("DATE-12 est absent. Les groupes de classement utilisent DATE ; les enregistrements d’une même nuit peuvent être séparés à minuit.");
    if (columns.date12 < 0 && columns.date < 0) warnings.push("Aucune colonne DATE-12 ou DATE. La nuit des groupes de classement est inconnue.");
    const field = (raw, key) => columns[key] < 0 ? "" : String(raw[columns[key]] == null ? "" : raw[columns[key]]);
    const rows = records.map((record, index) => {
      if (!Array.isArray(record)) throw new TypeError("L’enregistrement " + (index + 1) + " doit être un tableau.");
      if (record.length !== headers.length) throw new Error("L’enregistrement " + (index + 1) + " ne contient pas une valeur par en-tête.");
      const raw = record.map(value => String(value == null ? "" : value));
      const species = normalizeAutoId(field(raw, "autoId"));
      const issues = [];
      function number(key, settings) {
        if (columns[key] < 0) return null;
        const source = field(raw, key);
        const value = parseNumber(source, settings);
        if (value == null) issues.push((key === "ratio" ? "MATCH RATIO" : key.toUpperCase()) + (source.trim() ? " invalide." : " manquant."));
        return value;
      }
      const pulses = number("pulses", { integer: true });
      let matching = number("matching", { integer: true });
      let ratio = number("ratio", { ratio: true });
      let ratioSource = ratio == null ? "missing" : "imported";
      const margin = number("margin");
      const countsConsistent = pulses != null && matching != null && matching <= pulses;
      if (pulses != null && matching != null && matching > pulses) {
        issues.push("MATCHING dépasse PULSES ; exclu du classement. Vérifiez les valeurs source.");
        matching = null;
      }
      if (ratio != null && countsConsistent && pulses > 0 && Math.abs(ratio - matching / pulses) > roundingAllowance(field(raw, "ratio")) + Number.EPSILON * 8) {
        issues.push("MATCH RATIO diffère de MATCHING / PULSES au-delà de la précision d’arrondi enregistrée ; vérifiez les valeurs source.");
      }
      if (ratio == null && !field(raw, "ratio").trim() && countsConsistent && pulses > 0) {
        ratio = matching / pulses;
        ratioSource = "derived";
        const missingIndex = issues.indexOf("MATCH RATIO manquant.");
        if (missingIndex >= 0) issues.splice(missingIndex, 1);
      }
      const file = field(raw, "file");
      if (!file.trim()) issues.push("Nom du fichier d’enregistrement manquant.");
      const folder = field(raw, "folder");
      const indir = field(raw, "indir");
      const date = field(raw, "date");
      const date12 = field(raw, "date12");
      const night = date12.trim() || date.trim();
      if (!night) issues.push("Nuit/date manquante ; les contacts partagent un groupe de nuit inconnue.");
      if (columns.date12 >= 0 && !date12.trim() && date.trim()) issues.push("DATE-12 manquant ; ce contact est regroupé selon DATE.");
      const groupKey = JSON.stringify([indir.trim(), folder.trim(), night, species.key]);
      return {
        id: "contact-" + (index + 1), index, raw,
        autoId: species.autoId, importedAutoId: field(raw, "autoId"), kind: species.kind,
        file, folder: folder || indir, indir, rawFolder: folder,
        offset: field(raw, "offset"), channel: field(raw, "channel"), date, date12,
        time: field(raw, "time"), night, pulses, matching, ratio, ratioSource, margin,
        manualId: field(raw, "manualId"),
        alternate1: field(raw, "alternate1"), alternate2: field(raw, "alternate2"),
        issues, groupKey, rank: 0, isAnchor: false
      };
    });
    // Filename alone is not an identity: one recording may contain many segments.
    const locators = new Map();
    rows.forEach(row => {
      if (!row.file.trim()) return;
      const key = JSON.stringify([row.indir.trim(), row.rawFolder.trim(), row.file.trim(), row.offset.trim(), row.channel.trim()]);
      if (!locators.has(key)) locators.set(key, []);
      locators.get(key).push(row);
    });
    let duplicateLocatorCount = 0;
    locators.forEach(contacts => {
      if (contacts.length > 1) {
        duplicateLocatorCount += contacts.filter(row => row.kind !== "noise").length;
        contacts.forEach(row => row.issues.push("Le repère d’enregistrement est répété dans " + contacts.length + " lignes ; conservez chaque contact séparément."));
      }
    });
    if (duplicateLocatorCount) warnings.push(duplicateLocatorCount + " contacts hors Noise ont des repères dossier/fichier/décalage/canal répétés. Ils conservent des identifiants de ligne source distincts.");
    const groupMap = new Map();
    rows.forEach(row => {
      if (!groupMap.has(row.groupKey)) groupMap.set(row.groupKey, {
        key: row.groupKey, autoId: row.autoId, kind: row.kind, folder: row.folder,
        indir: row.indir, night: row.night, rows: [], count: 0, anchorId: null
      });
      groupMap.get(row.groupKey).rows.push(row);
    });
    const groups = Array.from(groupMap.values());
    groups.forEach(group => {
      group.rows.sort(compareContacts);
      group.count = group.rows.length;
      group.rows.forEach((row, index) => {
        row.rank = index + 1;
        row.isAnchor = index === 0 && row.kind === "species";
      });
      group.anchorId = group.kind === "species" ? group.rows[0].id : null;
    });
    // Summary warnings concern non-Noise contacts. Keep every source row and its
    // issues available in the contact details and verification journal.
    const qualityRows = rows.filter(row => row.kind !== "noise");
    const issueCount = qualityRows.filter(row => row.issues.length > 0).length;
    if (issueCount) warnings.push(issueCount + " contact(s) sur " + qualityRows.length + " présentent des anomalies de données (hors Noise).");
    return { columns, rows, groups, warnings };
  }

  function stringifyCSV(headers, records, delimiter) {
    const separator = delimiter || ",";
    if (![",", ";", "\t"].includes(separator)) throw new Error("Utilisez une virgule, un point-virgule ou une tabulation comme séparateur CSV.");
    function escape(value) {
      const text = String(value == null ? "" : value);
      return text.includes(separator) || /["\r\n]/.test(text) || /^\s|\s$/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }
    return [headers].concat(records).map(record => record.map(escape).join(separator)).join("\r\n") + "\r\n";
  }

  // Use only for a separate review/report export: never alter original id.csv
  // values merely to make them spreadsheet-safe.
  function spreadsheetSafe(value) {
    const text = String(value == null ? "" : value);
    return /^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  }

  return { parseCSV, stringifyCSV, analyze, canonicalColumns, parseNumber, normalizeAutoId, compareContacts, spreadsheetSafe };
});
