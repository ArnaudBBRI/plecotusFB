(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./best-contacts.js'), require('./species.js'));
  else root.PlecotusManualWorkflow = factory(root.BatReviewCore, root.PlecotusBestContacts, root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Best, Names) {
  'use strict';

  const excludedSpecies = Object.freeze(['BARBAR', 'RHIFER', 'RHIHIP', 'MYOBEC', 'MYODAS', 'MYOMYO', 'MYOEMA', 'NYCNOC', 'NYCLEI']);
  const excluded = new Set(excludedSpecies);
  const ratioBins = Object.freeze([
    Object.freeze({ key: '0-0.2', label: '[0 ; 0,2]', max: .2 }),
    Object.freeze({ key: '0.2-0.4', label: ']0,2 ; 0,4]', max: .4 }),
    Object.freeze({ key: '0.4-0.6', label: ']0,4 ; 0,6]', max: .6 }),
    Object.freeze({ key: '0.6-0.8', label: ']0,6 ; 0,8]', max: .8 }),
    Object.freeze({ key: '0.8-1', label: ']0,8 ; 1]', max: 1 }),
    Object.freeze({ key: 'missing', label: 'Ratio absent ou invalide', max: null })
  ]);
  const text = value => String(value == null ? '' : value).trim();
  const knownStatus = status => status === 'validated' || status === 'invalidated';

  function numeric(value) {
    let source = text(value);
    if (source.includes(',') && !source.includes('.')) source = source.replace(',', '.');
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(source)) return null;
    const number = Number(source);
    return Number.isFinite(number) ? number : null;
  }

  function ratio(value) {
    const number = numeric(value);
    return number != null && number >= 0 && number <= 1 ? number : null;
  }

  function binFor(value) {
    return value == null ? ratioBins.length - 1 : ratioBins.findIndex(bin => bin.max != null && value <= bin.max);
  }

  function seed(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return hash >>> 0;
  }

  // Proportional integer quotas, with the already-reviewed reference forced
  // into its own class. Ties have a fixed order and never depend on decisions.
  function quotas(weights, total, referenceBin) {
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const minimums = weights.map((_, index) => index === referenceBin ? 1 : 0);
    const exact = weights.map(value => weightTotal ? total * value / weightTotal : 0);
    const result = exact.map((value, index) => Math.min(weights[index], Math.max(minimums[index], Math.floor(value))));
    let assigned = result.reduce((sum, value) => sum + value, 0);
    while (assigned < total) {
      const candidates = result.map((_, index) => index).filter(index => result[index] < weights[index]);
      candidates.sort((a, b) => (exact[b] - result[b]) - (exact[a] - result[a]) || a - b);
      if (!candidates.length) break;
      result[candidates[0]]++; assigned++;
    }
    while (assigned > total) {
      const candidates = result.map((_, index) => index).filter(index => result[index] > minimums[index]);
      candidates.sort((a, b) => (result[b] - exact[b]) - (result[a] - exact[a]) || b - a);
      if (!candidates.length) break;
      result[candidates[0]]--; assigned--;
    }
    return result;
  }

  function decisionMap(source, count) {
    if (source && typeof source.snapshot === 'function') source = source.snapshot();
    if (source == null) return new Map();
    if (!source || !Array.isArray(source.decisions)) throw new TypeError('Les décisions du plan de vérification sont invalides.');
    const result = new Map();
    for (const item of source.decisions) {
      if (!item || !Number.isInteger(item.recordIndex) || item.recordIndex < 0 || item.recordIndex >= count
        || !knownStatus(item.status) || result.has(item.recordIndex)) throw new TypeError('Une décision de contact du plan est invalide.');
      result.set(item.recordIndex, item);
    }
    return result;
  }

  function contactMetadata(imported, columns, qualColumn, recordIndex) {
    const record = imported.records[recordIndex];
    const at = key => columns[key] < 0 ? '' : record[columns[key]];
    const excel = imported.sheetName != null || /\.xlsx?$/i.test(imported.fileName || '');
    const rawDate = text(at('date')), rawTime = text(at('time'));
    let date = rawDate, time = rawTime, dateValue = null, timeValue = null;
    const iso = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) {
      const value = new Date(0);
      value.setUTCFullYear(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      value.setUTCHours(0, 0, 0, 0);
      if (value.getUTCFullYear() === Number(iso[1]) && value.getUTCMonth() === Number(iso[2]) - 1 && value.getUTCDate() === Number(iso[3])) dateValue = value.getTime();
    } else if (excel) {
      const serial = numeric(rawDate), whole = serial == null ? null : Math.floor(serial);
      if (whole != null && whole >= 0 && whole <= 2958465 && (imported.excelDate1904 || whole !== 60)) {
        dateValue = imported.excelDate1904 ? Date.UTC(1904, 0, 1) + whole * 86400000
          : Date.UTC(1899, 11, 31) + (whole > 60 ? whole - 1 : whole) * 86400000;
      }
    }
    if (dateValue != null) date = new Date(dateValue).toISOString().slice(0, 10);
    const clock = rawTime.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:[.,]\d+)?)$/);
    if (clock) {
      const hours = Number(clock[1]), minutes = Number(clock[2]), seconds = Number(clock[3].replace(',', '.'));
      if (hours <= 23 && minutes <= 59 && seconds < 60) timeValue = hours * 3600 + minutes * 60 + seconds;
    } else if (excel) {
      const serial = numeric(rawTime);
      if (serial != null && serial >= 0) timeValue = Math.round((serial - Math.floor(serial)) * 86400000) / 1000;
    }
    if (timeValue != null) {
      const milliseconds = Math.round(timeValue * 1000);
      time = new Date(milliseconds).toISOString().slice(11, milliseconds % 1000 ? 23 : 19);
    }
    const sourceRow = imported.sourceRows && imported.sourceRows[recordIndex];
    return { recordIndex, lineNumber: Number.isInteger(sourceRow) && sourceRow > 0 ? sourceRow : recordIndex + 2,
      fileName: text(at('file')), ratio: ratio(at('ratio')), qual: qualColumn < 0 ? null : numeric(record[qualColumn]),
      pulses: numeric(at('pulses')), matching: numeric(at('matching')), date, time, dateValue, timeValue,
      raw: { ratio: text(at('ratio')), date: rawDate, time: rawTime }, record };
  }

  function build(imported, source, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || options.includeBestInQuota != null && typeof options.includeBestInQuota !== 'boolean') throw new TypeError('Les options du plan de vérification sont invalides.');
    const includeBestInQuota = options.includeBestInQuota !== false;
    const bestResult = Best.build(imported);
    const columns = Core.canonicalColumns(imported.headers);
    const qualityColumns = imported.headers.map((header, index) => ({ index, name: text(header).toUpperCase().replace(/[^A-Z0-9]/g, '') })).filter(item => item.name === 'QUAL');
    const qualColumn = qualityColumns.length ? qualityColumns[0].index : -1;
    const decisions = decisionMap(source, imported.records.length);
    const pendingBestIndices = bestResult.groups.filter(group => group.best && !decisions.has(group.best.recordIndex)).map(group => group.best.recordIndex);
    const byKey = new Map(bestResult.groups.map(group => [group.key, []]));
    imported.records.forEach((record, index) => {
      const rawAuto = columns.autoId < 0 ? '' : String(record[columns.autoId] == null ? '' : record[columns.autoId]);
      const rows = byKey.get('source:' + rawAuto);
      if (rows) rows.push(index);
    });
    const automaticAssignments = [];
    const groups = bestResult.groups.map(bestGroup => {
      const indices = byKey.get(bestGroup.key);
      const contacts = indices.map(index => contactMetadata(imported, columns, qualColumn, index));
      const byIndex = new Map(contacts.map(contact => [contact.recordIndex, contact]));
      const name = Names.resolve(bestGroup.label);
      const isSpecies = name.known && name.isSpecies;
      const sensitive = excluded.has(name.key);
      const qualifyingCount = contacts.filter(contact => contact.ratio != null && contact.ratio >= .6).length;
      const qualifyingShare = qualifyingCount / contacts.length;
      const best = bestGroup.best;
      const referenceMatches = Boolean(best && decisions.get(best.recordIndex)?.status === 'validated');
      const automatic = isSpecies && referenceMatches && qualifyingCount * 2 >= contacts.length && !sensitive;
      const mode = automatic ? 'auto' : isSpecies ? 'sample' : 'individual';
      const reasons = [];
      if (!isSpecies) reasons.push('Sans espèce identifiée de façon univoque, chaque contact est contrôlé individuellement.');
      if (!best) reasons.push('Aucun meilleur contact éligible : la validation directe est impossible.');
      else if (!referenceMatches) reasons.push(decisions.has(best.recordIndex)
        ? 'Le meilleur contact a été invalidé : son AUTO-ID n’est pas confirmé.'
        : 'Le meilleur contact reste à valider ou invalider.');
      if (qualifyingCount * 2 < contacts.length) reasons.push('Moins de 50 % des contacts ont un MATCH RATIO supérieur ou égal à 0,6.');
      if (sensitive) reasons.push('Cette espèce appartient à la liste d’exclusion de la validation directe du projet.');
      if (automatic) reasons.push('Meilleur contact validé, au moins 50 % des ratios supérieurs ou égaux à 0,6 et espèce hors liste d’exclusion.');
      let selectedIndices = [], sampleTarget = 0;
      const bins = ratioBins.map(bin => ({ ...bin, count: 0, selectedCount: 0 }));
      for (const contact of contacts) bins[binFor(contact.ratio)].count++;
      if (mode === 'auto') {
        for (const recordIndex of indices) automaticAssignments.push({ recordIndex,
          value: String(imported.records[recordIndex][columns.autoId] == null ? '' : imported.records[recordIndex][columns.autoId]), groupKey: bestGroup.key });
      } else if (mode === 'individual') {
        sampleTarget = indices.length;
        selectedIndices = indices.slice();
      } else {
        sampleTarget = Math.min(indices.length, Math.max(1, Math.ceil(indices.length * .2)) + (!includeBestInQuota && best ? 1 : 0));
        const referenceBin = best ? binFor(byIndex.get(best.recordIndex).ratio) : -1;
        const counts = quotas(bins.map(bin => bin.count), sampleTarget, referenceBin);
        bins.forEach((bin, binIndex) => {
          const inBin = contacts.filter(contact => binFor(contact.ratio) === binIndex);
          const others = inBin.filter(contact => !best || contact.recordIndex !== best.recordIndex)
            .map(contact => ({ contact, order: seed(JSON.stringify([bestGroup.key, contact.lineNumber, contact.recordIndex, contact.fileName, contact.record])) }))
            .sort((a, b) => a.order - b.order || a.contact.recordIndex - b.contact.recordIndex);
          const referenceCount = referenceBin === binIndex ? 1 : 0;
          if (referenceCount) selectedIndices.push(best.recordIndex);
          selectedIndices.push(...others.slice(0, counts[binIndex] - referenceCount).map(item => item.contact.recordIndex));
        });
        selectedIndices.sort((a, b) => a - b);
      }
      for (const recordIndex of selectedIndices) bins[binFor(byIndex.get(recordIndex).ratio)].selectedCount++;
      const requiredIndices = selectedIndices.filter(index => !best || index !== best.recordIndex);
      const completed = requiredIndices.filter(index => decisions.has(index)).length;
      const remaining = requiredIndices.length - completed;
      return { key: bestGroup.key, label: bestGroup.label, kind: bestGroup.kind, total: contacts.length, best,
        mode, sensitive, qualifyingCount, qualifyingShare, referenceMatches, reasons,
        sampleTarget, selectedIndices, requiredIndices, completed, remaining,
        progress: requiredIndices.length ? completed / requiredIndices.length : 1,
        contacts: requiredIndices.map(index => ({ ...byIndex.get(index), status: decisions.get(index)?.status || null })), bins };
    });
    const headers = imported.headers.slice();
    const manualColumn = columns.manualId < 0 ? headers.push('MANUAL ID') - 1 : columns.manualId;
    const semiColumns = headers.map((header, index) => ({ index, name: text(header).toUpperCase().replace(/[^A-Z0-9]/g, '') })).filter(item => item.name === 'SEMIMANUALID');
    if (semiColumns.length > 1) throw new Error('Plusieurs colonnes désignent SEMIMANUAL ID. Gardez une seule colonne sans ambiguïté.');
    const semiColumn = semiColumns.length ? semiColumns[0].index : headers.push('SEMIMANUAL ID') - 1;
    const records = imported.records.map(record => {
      const copy = record.slice();
      while (copy.length < headers.length) copy.push('');
      copy[semiColumn] = '';
      return copy;
    });
    for (const [recordIndex, decision] of decisions) {
      records[recordIndex][manualColumn] = decision.status === 'validated' && columns.autoId >= 0
        ? text(imported.records[recordIndex][columns.autoId]) : '';
    }
    for (const item of automaticAssignments) records[item.recordIndex][semiColumn] = item.value;
    const requiredIndices = groups.flatMap(group => group.requiredIndices);
    const completed = groups.reduce((sum, group) => sum + group.completed, 0);
    const remaining = groups.reduce((sum, group) => sum + group.remaining, 0);
    return { ready: !pendingBestIndices.length, pendingBestIndices, groups,
      excludedNoiseCount: bestResult.excludedNoiseCount, requiredIndices, completed, remaining,
      progress: requiredIndices.length ? completed / requiredIndices.length : 1,
      automaticAssignments, processed: { headers, records,
        statuses: imported.records.map((_, index) => decisions.get(index)?.status || null) } };
  }

  return Object.freeze({ build, EXCLUDED_SPECIES: excludedSpecies, RATIO_BINS: ratioBins });
});
