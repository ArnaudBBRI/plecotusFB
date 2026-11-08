(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./file-import.js'));
  else root.PlecotusResultsFile = factory(root.BatReviewCore, root.PlecotusFileImport);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, FileImport) {
  'use strict';

  // Fichier « resultats » : toutes les colonnes du fichier id, MANUAL ID,
  // SEMIMANUAL ID et l'origine de chaque identification. Il peut être
  // rechargé dans Plecotus pour reprendre la vérification là où elle en était.
  const ORIGIN_HEADER = 'ORIGINE ID PLECOTUS';
  const CALENDAR_HEADER = 'CALENDRIER EXCEL PLECOTUS';
  const COMMENT_HEADER = 'COMMENTAIRE PLECOTUS';
  const ORIGINS = Object.freeze({
    reviewed: 'Vérification Plecotus',
    unresolved: 'Identification incertaine/non résolue — à revoir',
    pendingIdentification: 'Invalidé, identification à renseigner',
    validatedWithoutAutoId: 'Validé sans AUTO-ID',
    sourceManual: 'MANUAL ID du fichier source',
    direct: 'Validation directe de l\'espèce',
    proportional: 'Prorata',
    noise: 'Bruit (AUTO-ID Noise)',
    unassigned: 'Non attribuée'
  });
  const text = value => String(value == null ? '' : value).trim();
  const headerKey = value => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Tolère une réécriture du fichier (accents perdus, casse, ponctuation).
  const originKey = value => text(value).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const invalidLabel = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

  function uniqueColumn(headers, name, label) {
    const found = headers.map((header, index) => ({ index, name: headerKey(header) })).filter(item => item.name === name);
    if (found.length > 1) throw new Error('Plusieurs colonnes ' + label + ' : gardez-en une seule.');
    return found.length ? found[0].index : -1;
  }

  function suggestedName(fileName) {
    const stem = text(fileName).replace(/\.[^.\\/]+$/, '').replace(/_resultats$/i, '');
    return (stem || 'plecotus') + '_resultats.csv';
  }

  function isResultsFile(imported) {
    return Boolean(imported && Array.isArray(imported.headers)
      && imported.headers.some(header => headerKey(header) === headerKey(ORIGIN_HEADER)));
  }

  function build(imported, plan, snapshot) {
    const processed = plan && plan.processed;
    if (!imported || !Array.isArray(imported.records) || !processed || !Array.isArray(processed.headers)
      || !Array.isArray(processed.records) || processed.records.length !== imported.records.length) {
      throw new Error('Les résultats ne peuvent pas être préparés. Rechargez le fichier puis réessayez.');
    }
    const headers = processed.headers.slice();
    let originIndex = uniqueColumn(headers, headerKey(ORIGIN_HEADER), ORIGIN_HEADER);
    if (originIndex < 0) originIndex = headers.push(ORIGIN_HEADER) - 1;
    const excelDates = imported.excelDates === true || imported.sheetName != null || /\.xlsx?$/i.test(imported.fileName || '');
    let calendarIndex = uniqueColumn(headers, headerKey(CALENDAR_HEADER), CALENDAR_HEADER);
    if (excelDates && calendarIndex < 0) calendarIndex = headers.push(CALENDAR_HEADER) - 1;
    const source = Core.canonicalColumns(imported.headers);
    const sourceCommentIndex = uniqueColumn(imported.headers, headerKey(COMMENT_HEADER), COMMENT_HEADER);
    const hasCommentSnapshot = snapshot != null && Object.prototype.hasOwnProperty.call(snapshot, 'comments');
    const comments = new Map();
    if (hasCommentSnapshot) {
      if (!Array.isArray(snapshot.comments)) throw new TypeError('Les commentaires des contacts doivent être une liste.');
      for (const item of snapshot.comments) {
        if (!item || !Number.isInteger(item.recordIndex) || item.recordIndex < 0 || item.recordIndex >= imported.records.length
          || typeof item.text !== 'string' || comments.has(item.recordIndex)) {
          throw new TypeError('Chaque commentaire doit désigner un contact unique et contenir un texte.');
        }
        comments.set(item.recordIndex, item.text);
      }
    }
    let commentIndex = uniqueColumn(headers, headerKey(COMMENT_HEADER), COMMENT_HEADER);
    if (commentIndex < 0 && (sourceCommentIndex >= 0 || [...comments.values()].some(value => value !== ''))) {
      commentIndex = headers.push(COMMENT_HEADER) - 1;
    }
    const processedColumns = Core.canonicalColumns(headers);
    const semiIndex = uniqueColumn(headers, 'SEMIMANUALID', 'SEMIMANUAL ID');
    const decisions = new Map((snapshot && Array.isArray(snapshot.decisions) ? snapshot.decisions : [])
      .map(item => [item.recordIndex, item]));
    const direct = new Set((plan.automaticAssignments || []).map(item => item.recordIndex));
    const proportional = new Set((plan.proportionalAssignments || []).map(item => item.recordIndex));
    const unresolved = new Set(plan.unresolvedIndices || []);
    const counts = Object.fromEntries(Object.keys(ORIGINS).map(name => [name, 0]));
    const records = processed.records.map((record, index) => {
      const copy = record.slice();
      while (copy.length < headers.length) copy.push('');
      const original = imported.records[index];
      if (commentIndex >= 0) copy[commentIndex] = hasCommentSnapshot ? comments.get(index) ?? ''
        : sourceCommentIndex >= 0 ? original[sourceCommentIndex] : copy[commentIndex];
      const decision = decisions.get(index);
      let origin;
      if (unresolved.has(index)) origin = 'unresolved';
      else if (decision) {
        origin = decision.status === 'unresolved' ? 'unresolved' : text(decision.manualId) ? 'reviewed'
          : decision.status === 'invalidated' ? 'pendingIdentification' : 'validatedWithoutAutoId';
      } else if (source.manualId >= 0 && text(original[source.manualId])) origin = 'sourceManual';
      else if (direct.has(index)) origin = 'direct';
      else if (proportional.has(index)) origin = 'proportional';
      else if (source.autoId >= 0 && Core.normalizeAutoId(original[source.autoId]).kind === 'noise') origin = 'noise';
      else origin = 'unassigned';
      counts[origin]++;
      copy[originIndex] = ORIGINS[origin];
      if (origin === 'unresolved') {
        if (processedColumns.manualId >= 0) copy[processedColumns.manualId] = '';
        if (semiIndex >= 0) copy[semiIndex] = '';
      }
      // Preserve serial DATE/TIME source cells and explicitly carry the Excel
      // calendar, since the results CSV no longer has workbook metadata.
      if (excelDates) copy[calendarIndex] = imported.excelDate1904 === true ? '1904' : '1900';
      return copy;
    });
    const delimiter = [',', ';', '\t'].includes(imported.delimiter) ? imported.delimiter : ',';
    // Valeurs recopiées telles quelles (pas de protection tableur) pour permettre la reprise.
    return { headers, records, counts, fileName: suggestedName(imported.fileName),
      text: '﻿' + Core.stringifyCSV(headers, records, delimiter) };
  }

  function prepareResume(imported) {
    if (!isResultsFile(imported)) return null;
    const headers = imported.headers;
    const originIndex = uniqueColumn(headers, headerKey(ORIGIN_HEADER), ORIGIN_HEADER);
    const semiIndex = uniqueColumn(headers, 'SEMIMANUALID', 'SEMIMANUAL ID');
    const calendarIndex = uniqueColumn(headers, headerKey(CALENDAR_HEADER), CALENDAR_HEADER);
    let calendar = null;
    if (calendarIndex >= 0) {
      for (const record of imported.records) {
        const value = text(record[calendarIndex]);
        if (!['1900', '1904'].includes(value)) {
          throw new Error('La colonne ' + CALENDAR_HEADER + ' doit contenir 1900 ou 1904 sur chaque ligne.');
        }
        if (calendar !== null && calendar !== value) {
          throw new Error('La colonne ' + CALENDAR_HEADER + ' doit indiquer le même calendrier sur toutes les lignes.');
        }
        calendar = value;
      }
    }
    const columns = Core.canonicalColumns(headers);
    const entries = [], pending = [], validatedOnly = [], unresolved = [];
    let ignored = 0;
    const reviewed = originKey(ORIGINS.reviewed);
    const pendingKey = originKey(ORIGINS.pendingIdentification);
    const validatedKey = originKey(ORIGINS.validatedWithoutAutoId);
    const unresolvedKey = originKey(ORIGINS.unresolved);
    // Les identifications faites dans Plecotus redeviennent des décisions ; leur
    // MANUAL ID est retiré des données importées, qui retrouvent l'état du fichier id.
    const records = imported.records.map((record, recordIndex) => {
      const copy = record.slice();
      const origin = originKey(record[originIndex]);
      const manual = columns.manualId >= 0 ? text(record[columns.manualId]) : '';
      if (origin === reviewed || origin === pendingKey || origin === validatedKey || origin === unresolvedKey) {
        if (origin === reviewed) {
          if (manual && !invalidLabel.test(manual)) entries.push({ recordIndex, manualId: manual });
          else ignored++;
        } else if (origin === unresolvedKey) unresolved.push(recordIndex);
        else if (origin === pendingKey) pending.push(recordIndex);
        else validatedOnly.push(recordIndex);
        if (columns.manualId >= 0) copy[columns.manualId] = '';
      }
      if (semiIndex >= 0) copy[semiIndex] = '';
      copy[originIndex] = '';
      return copy;
    });
    const cleaned = { ...imported, records,
      // Empreinte propre au contenu exact du fichier résultats chargé.
      resumeIdentity: JSON.stringify(imported.records) };
    if (calendar !== null) {
      cleaned.excelDates = true;
      cleaned.excelDate1904 = calendar === '1904';
    }
    cleaned.columns = Core.canonicalColumns(headers);
    cleaned.summary = FileImport.summarize(cleaned);
    cleaned.warnings = (imported.warnings || []).slice();
    return { imported: cleaned, entries, pending, validatedOnly, unresolved, ignored,
      total: entries.length + pending.length + validatedOnly.length + unresolved.length };
  }

  function applyResume(decisions, resume) {
    if (!resume || !resume.total) return { restored: 0, fromBrowser: false };
    // Ce fichier exact a déjà été chargé dans ce navigateur : son travail
    // poursuivi depuis (même non enregistré) est conservé.
    if (decisions.snapshot().decisions.length) return { restored: 0, fromBrowser: true };
    if (resume.entries.length) decisions.setManualIds(resume.entries);
    if (resume.pending.length) decisions.setMany(resume.pending, 'invalidated');
    if (resume.validatedOnly.length) decisions.setMany(resume.validatedOnly, 'validated');
    if (resume.unresolved && resume.unresolved.length) decisions.setMany(resume.unresolved, 'unresolved');
    return { restored: resume.total, fromBrowser: false };
  }

  return Object.freeze({ ORIGIN_HEADER, CALENDAR_HEADER, COMMENT_HEADER, ORIGINS, suggestedName, isResultsFile, build, prepareResume, applyResume });
});
