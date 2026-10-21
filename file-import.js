(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), () => root.XLSX);
  else root.PlecotusFileImport = factory(root.BatReviewCore, () => root.XLSX);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, workbookReader) {
  'use strict';

  const MAX_FILE_SIZE = 50 * 1024 * 1024;

  function summarize(parsed) {
    const columns = Core.canonicalColumns(parsed.headers);
    if (columns.file < 0) {
      throw new Error('La colonne IN FILE (ou File) est introuvable. Choisissez un export de contacts compatible.');
    }
    let manualIdCount = 0, noiseContacts = 0;
    for (const row of parsed.records) {
      if (columns.manualId >= 0 && String(row[columns.manualId] == null ? '' : row[columns.manualId]).trim()) manualIdCount++;
      if (columns.autoId >= 0 && Core.normalizeAutoId(row[columns.autoId]).kind === 'noise') noiseContacts++;
    }
    return {
      totalContacts: parsed.records.length,
      noiseContacts: columns.autoId >= 0 ? noiseContacts : null,
      contactsExcludingNoise: columns.autoId >= 0 ? parsed.records.length - noiseContacts : null,
      manualIdCount,
      vanilla: manualIdCount === 0,
      hasManualIdColumn: columns.manualId >= 0,
      hasAutoIdColumn: columns.autoId >= 0
    };
  }

  function decodeCSV(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let text, warning;
    if (bytes[0] === 255 && bytes[1] === 254) text = new TextDecoder('utf-16le').decode(bytes);
    else if (bytes[0] === 254 && bytes[1] === 255) text = new TextDecoder('utf-16be').decode(bytes);
    else {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch {
        text = new TextDecoder('windows-1252').decode(bytes);
        warning = 'CSV décodé en Windows-1252 : vérifiez les accents.';
      }
    }
    if (text.includes('\u0000')) {
      throw new Error('Le CSV contient des caractères nuls. Réenregistrez-le en UTF-8 ou en UTF-16 avec indicateur d’encodage.');
    }
    return { text, warnings: warning ? [warning] : [] };
  }

  function result(parsed, fileName, sheetName, extraWarnings) {
    const summary = summarize(parsed);
    const warnings = [...(extraWarnings || []), ...parsed.warnings];
    if (!summary.hasManualIdColumn) warnings.push('Colonne MANUAL ID absente : aucune identification manuelle importée.');
    return { fileName, sheetName, headers: parsed.headers, records: parsed.records,
      columns: Core.canonicalColumns(parsed.headers), summary, warnings };
  }

  function parseSheet(workbook, name, xlsx, fileName) {
    // SheetJS otherwise replaces Excel errors with defval, which could hide a
    // nonempty MANUAL ID. Preserve their visible error text in a detached view.
    const sheet = { ...workbook.Sheets[name] };
    let hasErrors = false;
    for (const address of Object.keys(sheet)) {
      const cell = sheet[address];
      if (address[0] === '!' || !cell || cell.t !== 'e') continue;
      sheet[address] = { t: 's', v: xlsx.utils.format_cell(cell) || '#ERREUR' };
      hasErrors = true;
    }
    // Stored values matter: a display format such as ;;; can hide an entered ID.
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: false });
    if (!rows.length) throw new Error('La feuille est vide.');
    // Reuse the CSV header, quoting, blank-row and ambiguous-column rules.
    const parsed = Core.parseCSV(Core.stringifyCSV(rows[0], rows.slice(1)), ',');
    return result(parsed, fileName, name, hasErrors ? ['Des cellules Excel contiennent des erreurs ; leur texte est conservé dans les données importées.'] : []);
  }

  async function read(file, options) {
    const settings = options || {};
    if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') {
      throw new Error('Choisissez un fichier CSV ou Excel.');
    }
    const extension = (file.name.match(/\.([^.]+)$/) || [])[1];
    if (!extension || !['csv', 'xls', 'xlsx'].includes(extension.toLowerCase())) {
      throw new Error('Format non pris en charge. Choisissez un fichier CSV, XLS ou XLSX.');
    }
    if (file.size > MAX_FILE_SIZE) throw new Error('Le fichier dépasse la limite de 50 Mo.');
    let buffer;
    try { buffer = await file.arrayBuffer(); }
    catch { throw new Error('Le fichier ne peut pas être lu. Sélectionnez-le à nouveau.'); }
    if (buffer.byteLength > MAX_FILE_SIZE) throw new Error('Le fichier dépasse la limite de 50 Mo.');
    if (!buffer.byteLength) throw new Error('Le fichier est vide.');
    if (extension.toLowerCase() === 'csv') {
      const decoded = decodeCSV(buffer);
      return result(Core.parseCSV(decoded.text), file.name, null, decoded.warnings);
    }

    const xlsx = settings.xlsx || workbookReader();
    if (!xlsx || typeof xlsx.read !== 'function' || !xlsx.utils) {
      throw new Error('Le lecteur Excel est indisponible. Rechargez Plecotus avant de réessayer.');
    }
    let workbook;
    try { workbook = xlsx.read(new Uint8Array(buffer), { type: 'array', cellHTML: false }); }
    catch { throw new Error('Impossible de lire ce fichier Excel. Vérifiez qu’il est valide et non protégé par un mot de passe.'); }
    if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.SheetNames.length) {
      throw new Error('Le classeur Excel ne contient aucune feuille.');
    }
    if (settings.sheetName != null) {
      if (!workbook.SheetNames.includes(settings.sheetName)) throw new Error('La feuille sélectionnée est introuvable dans ce classeur.');
      return parseSheet(workbook, settings.sheetName, xlsx, file.name);
    }

    const candidates = [], failures = [];
    for (const name of workbook.SheetNames) {
      try { candidates.push(parseSheet(workbook, name, xlsx, file.name)); }
      catch (error) { failures.push({ name, error }); }
    }
    if (!candidates.length) {
      const detail = failures[0];
      throw new Error('Aucune feuille de contacts compatible.' + (detail ? ' Feuille « ' + detail.name + ' » : ' + detail.error.message : ''));
    }
    if (candidates.length > 1) {
      const error = new Error('Plusieurs feuilles contiennent des contacts. Choisissez la feuille à importer.');
      error.code = 'SHEET_SELECTION_REQUIRED';
      error.sheets = candidates.map(candidate => candidate.sheetName);
      throw error;
    }
    const selected = candidates[0];
    if (failures.length) selected.warnings.push('Feuille(s) sans tableau de contacts compatible ignorée(s) : ' + failures.map(item => item.name).join(', ') + '.');
    return selected;
  }

  return { read, summarize, decodeCSV, MAX_FILE_SIZE };
});
