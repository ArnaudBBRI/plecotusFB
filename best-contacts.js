(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.PlecotusBestContacts = factory(root.BatReviewCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  const day = 86400000;
  const text = value => String(value == null ? '' : value).trim();

  function numeric(value) {
    let source = text(value);
    if (source.includes(',') && !source.includes('.')) source = source.replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(source)) return null;
    const number = Number(source);
    return Number.isFinite(number) ? number : null;
  }

  function utcDate(year, month, date) {
    const result = new Date(0);
    result.setUTCFullYear(year, month - 1, date);
    result.setUTCHours(0, 0, 0, 0);
    if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== date) return null;
    return result.getTime();
  }

  function dateValue(value, excel, date1904) {
    const source = text(value);
    const iso = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const serial = excel ? numeric(source) : null;
    if (serial == null || serial < 0 || serial > 2958465) return null;
    const whole = Math.floor(serial);
    // Excel's fictitious 29 February 1900 has no valid calendar equivalent.
    if (!date1904 && whole === 60) return null;
    return date1904
      ? Date.UTC(1904, 0, 1) + whole * day
      : Date.UTC(1899, 11, 31) + (whole > 60 ? whole - 1 : whole) * day;
  }

  function timeValue(value, excel) {
    const source = text(value);
    const clock = source.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:[.,]\d+)?)$/);
    if (clock) {
      const hours = Number(clock[1]), minutes = Number(clock[2]), seconds = Number(clock[3].replace(',', '.'));
      if (hours > 23 || minutes > 59 || seconds >= 60) return null;
      return hours * 3600 + minutes * 60 + seconds;
    }
    const serial = excel ? numeric(source) : null;
    if (serial == null || serial < 0) return null;
    return Math.round((serial - Math.floor(serial)) * 86400000) / 1000;
  }

  function displayDate(value, parsed) {
    return parsed == null ? text(value) : new Date(parsed).toISOString().slice(0, 10);
  }

  function displayTime(value, parsed) {
    if (parsed == null) return text(value);
    const milliseconds = Math.round(parsed * 1000);
    return new Date(milliseconds).toISOString().slice(11, milliseconds % 1000 ? 23 : 19);
  }

  function descending(left, right) {
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return right - left;
  }

  function ascending(left, right) {
    if (left == null) return right == null ? 0 : 1;
    if (right == null) return -1;
    return left - right;
  }

  function compare(left, right) {
    return descending(left.ratio, right.ratio) || descending(left.qual, right.qual)
      || descending(left.pulses, right.pulses) || ascending(left.dateValue, right.dateValue)
      || ascending(left.timeValue, right.timeValue) || left.recordIndex - right.recordIndex;
  }

  function build(imported) {
    if (!imported || !Array.isArray(imported.headers) || !Array.isArray(imported.records)) {
      throw new TypeError('La sélection des meilleurs contacts exige les en-têtes et les lignes importées.');
    }
    const columns = Core.canonicalColumns(imported.headers);
    const quality = imported.headers.map((header, index) => ({ index, name: text(header).toUpperCase().replace(/[^A-Z0-9]/g, '') })).filter(item => item.name === 'QUAL');
    if (quality.length > 1) throw new Error('Plusieurs en-têtes désignent Qual. Gardez une seule colonne sans ambiguïté.');
    columns.qual = quality.length ? quality[0].index : -1;
    const missingColumns = [['ratio', 'MATCH RATIO'], ['qual', 'Qual'], ['pulses', 'PULSES'], ['date', 'DATE'], ['time', 'TIME']]
      .filter(([key]) => columns[key] < 0).map(([, label]) => label);
    const excel = imported.sheetName != null || /\.xlsx?$/i.test(imported.fileName || '');
    const groups = new Map();
    let excludedNoiseCount = 0, excludedCandidateCount = 0;

    imported.records.forEach((record, recordIndex) => {
      if (!Array.isArray(record)) throw new TypeError('Chaque contact doit être une ligne du fichier importé.');
      const at = key => columns[key] < 0 ? '' : record[columns[key]];
      const rawAuto = String(at('autoId') == null ? '' : at('autoId'));
      const auto = Core.normalizeAutoId(rawAuto);
      if (auto.kind === 'noise') { excludedNoiseCount++; return; }
      // Keep the source AUTO-ID groups separate, as in the R script.
      const key = 'source:' + rawAuto;
      if (!groups.has(key)) groups.set(key, { key, label: text(rawAuto) || 'Sans identification automatique', kind: auto.kind, count: 0, eligibleCount: 0, best: null });
      const group = groups.get(key);
      group.count++;
      const raw = Object.fromEntries(['ratio', 'qual', 'pulses', 'matching', 'date', 'time'].map(name => [name, text(at(name))]));
      const ratio = numeric(raw.ratio), qual = numeric(raw.qual), matching = numeric(raw.matching);
      // MATCHING affects eligibility only; it never breaks a ranking tie.
      if (ratio == null && qual == null && matching == null) { excludedCandidateCount++; return; }
      const sourceRow = imported.sourceRows && imported.sourceRows[recordIndex];
      const parsedDate = dateValue(raw.date, excel, imported.excelDate1904 === true);
      const parsedTime = timeValue(raw.time, excel);
      const candidate = { recordIndex, lineNumber: Number.isInteger(sourceRow) && sourceRow > 0 ? sourceRow : recordIndex + 2,
        fileName: text(at('file')), ratio, qual, pulses: numeric(raw.pulses), matching,
        date: displayDate(raw.date, parsedDate), time: displayTime(raw.time, parsedTime),
        dateValue: parsedDate, timeValue: parsedTime, raw, record };
      group.eligibleCount++;
      if (!group.best || compare(candidate, group.best) < 0) group.best = candidate;
    });

    return { groups: [...groups.values()].sort((left, right) => left.label.localeCompare(right.label, 'fr') || left.key.localeCompare(right.key, 'fr')),
      excludedNoiseCount, excludedCandidateCount, missingColumns };
  }

  return Object.freeze({ build });
});
