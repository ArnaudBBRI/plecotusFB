(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./best-contacts.js'), require('./species.js'), require('./proportional-allocation.js'), require('./review-settings.js'));
  else root.PlecotusManualWorkflow = factory(root.BatReviewCore, root.PlecotusBestContacts, root.BatSpeciesNames, root.PlecotusProportionalAllocation, root.PlecotusReviewSettings);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Best, Names, Proportional, Settings) {
  'use strict';

  const excludedSpecies = Settings.DEFAULTS.excludedSpecies;
  const ratioBins = Object.freeze([
    Object.freeze({ key: '0-0.2', label: '[0 ; 0,2]', max: .2 }),
    Object.freeze({ key: '0.2-0.4', label: ']0,2 ; 0,4]', max: .4 }),
    Object.freeze({ key: '0.4-0.6', label: ']0,4 ; 0,6]', max: .6 }),
    Object.freeze({ key: '0.6-0.8', label: ']0,6 ; 0,8]', max: .8 }),
    Object.freeze({ key: '0.8-1', label: ']0,8 ; 1]', max: 1 }),
    Object.freeze({ key: 'missing', label: 'Ratio absent ou invalide', max: null })
  ]);
  const text = value => String(value == null ? '' : value).trim();
  const knownStatus = status => status === 'validated' || status === 'invalidated' || status === 'unresolved';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function identity(value) {
    const label = text(value);
    if (!label) return '';
    const resolved = Names.resolve(label);
    return resolved.known ? resolved.key : label.toUpperCase();
  }

  function allocationLabel(value) {
    const label = text(value);
    const resolved = Names.resolve(label);
    // Known taxonomic aliases contribute to one proportion. Preserve the raw
    // human label in MANUAL ID and on the manually identified contact itself.
    return resolved.known ? resolved.code || (resolved.category === 'noise' ? 'Noise' : resolved.scientificName) || label : label;
  }

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
        || !knownStatus(item.status) || result.has(item.recordIndex)
        || item.status === 'unresolved' && item.manualId != null
        || own(item, 'manualId') && item.manualId !== null && (typeof item.manualId !== 'string'
          || !item.manualId.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(item.manualId))) throw new TypeError('Une décision de contact du plan est invalide.');
      result.set(item.recordIndex, item);
    }
    return result;
  }

  function contactMetadata(imported, columns, qualColumn, recordIndex) {
    const record = imported.records[recordIndex];
    const at = key => columns[key] < 0 ? '' : record[columns[key]];
    const excel = imported.excelDates === true || imported.sheetName != null || /\.xlsx?$/i.test(imported.fileName || '');
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
      pulses: numeric(at('pulses')), matching: numeric(at('matching')), margin: numeric(at('margin')), date, time, dateValue, timeValue,
      raw: { ratio: text(at('ratio')), date: rawDate, time: rawTime }, record };
  }

  function build(imported, source, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || options.includeBestInQuota != null && typeof options.includeBestInQuota !== 'boolean') throw new TypeError('Les options du plan de vérification sont invalides.');
    const includeBestInQuota = options.includeBestInQuota !== false;
    const settings = Settings.normalize(options.settings);
    const excluded = new Set(settings.excludedSpecies);
    const bestResult = Best.build(imported, settings);
    const ratioLabel = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 20 }).format(settings.ratioThreshold);
    const majorityLabel = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 18 }).format(settings.majorityThreshold * 100) + ' %';
    const columns = Core.canonicalColumns(imported.headers);
    // Exporting results adds calculated/provenance columns, fills MANUAL ID
    // and can move physical CSV lines (comments and multiline cells). None of
    // those changes should replace the contacts already selected for review.
    const sampleColumns = imported.headers.map((header, index) => ({ index,
      key: text(header).toUpperCase().replace(/[^A-Z0-9]/g, '') }))
      .filter(item => item.index !== columns.manualId
        && !['SEMIMANUALID', 'ORIGINEIDPLECOTUS', 'CALENDRIEREXCELPLECOTUS', 'COMMENTAIREPLECOTUS'].includes(item.key))
      .map(item => item.index);
    const qualityColumns = imported.headers.map((header, index) => ({ index, name: text(header).toUpperCase().replace(/[^A-Z0-9]/g, '') })).filter(item => item.name === 'QUAL');
    const qualColumn = qualityColumns.length ? qualityColumns[0].index : -1;
    const decisions = decisionMap(source, imported.records.length);
    const proposedManualIds = imported.records.map((record, index) => {
      const decision = decisions.get(index);
      if (decision) {
        if (decision.status === 'unresolved') return '';
        if (own(decision, 'manualId')) return text(decision.manualId);
        // Older version-1 decisions did not persist the actual identification.
        return decision.status === 'validated' && columns.autoId >= 0 ? text(record[columns.autoId]) : '';
      }
      return columns.manualId >= 0 ? text(record[columns.manualId]) : '';
    });
    const unresolvedIndices = imported.records.map((_, index) => index).filter(index =>
      decisions.get(index)?.status === 'unresolved' || Names.resolve(proposedManualIds[index]).category === 'uncertain');
    const unresolved = new Set(unresolvedIndices);
    const manualIds = proposedManualIds.map((label, index) => unresolved.has(index) ? '' : label);
    const pendingBestIndices = bestResult.groups.filter(group => group.best
      && !unresolved.has(group.best.recordIndex)
      && (!decisions.has(group.best.recordIndex) || !manualIds[group.best.recordIndex])).map(group => group.best.recordIndex);
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
      const isNoId = bestGroup.kind !== 'unclassified' && name.known && name.key === 'unidentified';
      const sensitive = isNoId || excluded.has(name.key);
      const qualifyingCount = contacts.filter(contact => contact.ratio != null && contact.ratio >= settings.ratioThreshold).length;
      const qualifyingShare = qualifyingCount / contacts.length;
      const best = bestGroup.best;
      const referenceMatches = Boolean(best && decisions.get(best.recordIndex)?.status === 'validated'
        && manualIds[best.recordIndex] && identity(manualIds[best.recordIndex]) === identity(bestGroup.label));
      const contradictoryManualIds = indices.filter(index => manualIds[index] && identity(manualIds[index]) !== identity(bestGroup.label));
      const unresolvedDecisions = indices.filter(index => unresolved.has(index) || decisions.has(index) && !manualIds[index]);
      const groupUnresolvedIndices = indices.filter(index => unresolved.has(index));
      const automatic = isSpecies && referenceMatches && qualifyingShare >= settings.majorityThreshold && !sensitive
        && !contradictoryManualIds.length && !unresolvedDecisions.length;
      const mode = automatic ? 'auto' : isSpecies || isNoId ? 'sample' : 'individual';
      const reasons = [];
      if (isNoId) reasons.push('Le groupe NoID est contrôlé par un échantillon de 20 % des contacts, meilleur contact compris, sans validation directe de tout le groupe.');
      else if (!isSpecies) reasons.push('Sans espèce identifiée de façon univoque, chaque contact est contrôlé individuellement.');
      if (!best) reasons.push('Aucun meilleur contact éligible : la validation directe est impossible.');
      else if (unresolved.has(best.recordIndex)) reasons.push('L’identification du meilleur contact a été différée : ce contact doit être revu avant de terminer.');
      else if (!referenceMatches) reasons.push(decisions.has(best.recordIndex)
        ? 'Le meilleur contact a été invalidé : son AUTO-ID n’est pas confirmé.'
        : 'Le meilleur contact reste à valider ou invalider.');
      if (qualifyingShare < settings.majorityThreshold) reasons.push('Moins de ' + majorityLabel + ' des contacts ont un MATCH RATIO supérieur ou égal à ' + ratioLabel + '.');
      if (sensitive) reasons.push('Cette espèce appartient à la liste d’exclusion de la validation directe du projet.');
      if (contradictoryManualIds.length) reasons.push('Des identifications manuelles attribuent déjà certains contacts à une autre espèce : elles sont conservées et intégrées au prorata.');
      if (unresolvedDecisions.some(index => !unresolved.has(index))) reasons.push('Une identification réelle reste à renseigner après une invalidation.');
      if (groupUnresolvedIndices.length) reasons.push('Des identifications incertaines ou non résolues restent à revoir ; aucune attribution au groupe n’est effectuée tant qu’elles ne sont pas terminées.');
      if (automatic) reasons.push('Meilleur contact validé, au moins ' + majorityLabel + ' des ratios supérieurs ou égaux à ' + ratioLabel + ' et espèce hors liste d’exclusion.');
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
            .map(contact => ({ contact, order: seed(JSON.stringify([bestGroup.key, contact.recordIndex,
              contact.fileName, sampleColumns.map(index => String(contact.record[index] == null ? '' : contact.record[index]))])) }))
            .sort((a, b) => a.order - b.order || a.contact.recordIndex - b.contact.recordIndex);
          const referenceCount = referenceBin === binIndex ? 1 : 0;
          if (referenceCount) selectedIndices.push(best.recordIndex);
          selectedIndices.push(...others.slice(0, counts[binIndex] - referenceCount).map(item => item.contact.recordIndex));
        });
        selectedIndices.sort((a, b) => a - b);
      }
      for (const recordIndex of selectedIndices) bins[binFor(byIndex.get(recordIndex).ratio)].selectedCount++;
      const requiredIndices = [...new Set([...selectedIndices.filter(index => !best || index !== best.recordIndex),
        ...groupUnresolvedIndices])].sort((a, b) => a - b);
      const completed = requiredIndices.filter(index => manualIds[index]).length;
      const remaining = requiredIndices.length - completed;
      const pendingIdentificationIndices = [...new Set([...selectedIndices.filter(index => !manualIds[index]), ...unresolvedDecisions])].sort((a, b) => a - b);
      const assignmentReady = !pendingIdentificationIndices.length && (!best || decisions.has(best.recordIndex));
      const observations = indices.filter(index => manualIds[index]).map(recordIndex => ({ recordIndex, label: allocationLabel(manualIds[recordIndex]) }));
      const allocation = Proportional.allocate(mode === 'sample' && assignmentReady
        ? indices.filter(index => !manualIds[index]) : [], observations);
      return { key: bestGroup.key, label: bestGroup.label, kind: bestGroup.kind, total: contacts.length, best,
        mode, sensitive, qualifyingCount, qualifyingShare, ratioThreshold: settings.ratioThreshold,
        majorityThreshold: settings.majorityThreshold, referenceMatches, reasons,
        sampleTarget, selectedIndices, requiredIndices, completed, remaining,
        assignmentReady, pendingIdentificationIndices, unresolvedIndices: groupUnresolvedIndices,
        distribution: allocation.distribution, proportionalAssignments: allocation.assignments,
        progress: requiredIndices.length ? completed / requiredIndices.length : 1,
        contacts: requiredIndices.map(index => ({ ...byIndex.get(index), status: unresolved.has(index) ? 'unresolved' : decisions.get(index)?.status || null,
          manualId: manualIds[index] || null })), bins };
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
    for (const [recordIndex] of decisions) records[recordIndex][manualColumn] = manualIds[recordIndex];
    for (const recordIndex of unresolvedIndices) records[recordIndex][manualColumn] = '';
    for (const item of automaticAssignments) records[item.recordIndex][semiColumn] = item.value;
    for (const group of groups) {
      if (group.mode === 'auto') continue;
      // A human identification always remains tied to its own recording.
      // Only the remaining, genuinely unobserved contacts are extrapolated.
      for (const recordIndex of byKey.get(group.key)) {
        if (manualIds[recordIndex]) records[recordIndex][semiColumn] = manualIds[recordIndex];
      }
      for (const assignment of group.proportionalAssignments) records[assignment.recordIndex][semiColumn] = assignment.label;
    }
    const requiredIndices = [...new Set([...groups.flatMap(group => group.requiredIndices), ...unresolvedIndices])];
    const completed = requiredIndices.filter(index => manualIds[index]).length;
    const remaining = requiredIndices.length - completed;
    return { ready: !pendingBestIndices.length, pendingBestIndices, groups, settings,
      excludedNoiseCount: bestResult.excludedNoiseCount, requiredIndices, completed, remaining,
      assignmentReady: !unresolvedIndices.length && groups.every(group => group.assignmentReady), unresolvedIndices,
      unresolvedContacts: unresolvedIndices.map(index => ({ ...contactMetadata(imported, columns, qualColumn, index),
        status: 'unresolved', manualId: null, groupLabel: columns.autoId < 0 ? 'Sans identification automatique'
          : text(imported.records[index][columns.autoId]) || 'Sans identification automatique' })),
      pendingIdentificationIndices: [...new Set([...groups.flatMap(group => group.pendingIdentificationIndices), ...unresolvedIndices])].sort((a, b) => a - b),
      proportionalAssignments: groups.flatMap(group => group.proportionalAssignments),
      progress: requiredIndices.length ? completed / requiredIndices.length : 1,
      automaticAssignments, processed: { headers, records,
        statuses: imported.records.map((_, index) => decisions.get(index)?.status || null) } };
  }

  return Object.freeze({ build, EXCLUDED_SPECIES: excludedSpecies, RATIO_BINS: ratioBins });
});
