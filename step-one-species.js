(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./best-contacts.js'), require('./species.js'));
  else root.PlecotusStepOneSpecies = factory(root.BatReviewCore, root.PlecotusBestContacts, root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Best, Names) {
  'use strict';

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const text = value => String(value == null ? '' : value).trim();
  const statuses = new Set(['validated', 'invalidated', 'unresolved']);

  function validateDecision(item, recordIndex, count) {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || !Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= count
      || own(item, 'recordIndex') && item.recordIndex !== recordIndex
      || !statuses.has(item.status)
      || item.status === 'unresolved' && item.manualId != null
      || own(item, 'manualId') && item.manualId !== null && (typeof item.manualId !== 'string'
        || !item.manualId.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(item.manualId))) {
      throw new TypeError('Une décision de meilleur contact est invalide.');
    }
    return item;
  }

  function decisionReader(source, count) {
    if (source && typeof source.snapshot === 'function') source = source.snapshot();
    if (source == null) return () => null;
    if (source && typeof source.get === 'function') return index => {
      const item = source.get(index);
      return item == null ? null : validateDecision(item, index, count);
    };
    if (!source || !Array.isArray(source.decisions)) {
      throw new TypeError('Les décisions de l’étape 1 sont invalides.');
    }
    const decisions = new Map();
    for (const item of source.decisions) {
      const index = item && item.recordIndex;
      validateDecision(item, index, count);
      if (decisions.has(index)) throw new TypeError('Un meilleur contact ne peut avoir plusieurs décisions.');
      decisions.set(index, item);
    }
    return index => decisions.get(index) || null;
  }

  function build(imported, decisions, settings) {
    // Re-select references on every build: a saved ranking change may choose a
    // contact that has not yet received the review required for this export.
    const review = Best.build(imported, settings);
    const columns = Core.canonicalColumns(imported.headers);
    const getDecision = decisionReader(decisions, imported.records.length);
    const selected = review.groups.filter(group => group.best);
    const bestIndices = selected.map(group => group.best.recordIndex).sort((a, b) => a - b);
    const pendingBestIndices = [], identities = new Map(), selection = [];
    for (const group of selected) {
      const index = group.best.recordIndex;
      const decision = getDecision(index);
      // Source MANUAL ID and calculated IDs never substitute for a local
      // review. Only legacy binary validations may confirm the source AUTO-ID.
      const label = !decision || decision.status === 'unresolved' ? ''
        : own(decision, 'manualId') ? text(decision.manualId)
          : decision.status === 'validated' && columns.autoId >= 0 ? text(imported.records[index][columns.autoId]) : '';
      const identified = Names.resolve(label);
      selection.push([group.key, index, decision && decision.status || null, label]);
      if (!label || identified.category === 'pending' || identified.category === 'uncertain') {
        pendingBestIndices.push(index);
      } else if (identified.category !== 'noise' && !identities.has(identified.key)) {
        identities.set(identified.key, { scientificName: identified.scientificName || label,
          frenchName: identified.frenchName || '', isSpecies: identified.isSpecies });
      }
    }
    pendingBestIndices.sort((a, b) => a - b);
    const hasBestContacts = bestIndices.length > 0;
    const ready = hasBestContacts && pendingBestIndices.length === 0;
    const rows = ready ? [...identities.values()].sort((left, right) =>
      left.scientificName.localeCompare(right.scientificName, 'fr')
      || left.frenchName.localeCompare(right.frenchName, 'fr')) : [];
    return { ready, rows, pendingBestIndices, hasBestContacts, bestIndices,
      noBestGroupKeys: review.groups.filter(group => !group.best).map(group => group.key),
      selectionSignature: JSON.stringify([review.settings.ranking, selection]) };
  }

  return Object.freeze({ build });
});
