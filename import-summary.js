(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./species.js'));
  else root.BatImportSummary = factory(root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Names) {
  'use strict';

  const valueAt = (collection, key) => collection instanceof Map ? collection.get(key) : collection && collection[key];
  const unresolvedCategories = new Set(['pending', 'uncertain', 'unidentified']);

  // The source column and the current decisions answer different questions.
  // Keep every filled source label visible, even when a project correction or
  // an invalid saved decision has superseded it. No identification is changed.
  function summarize(data, classification) {
    if (!data || !Array.isArray(data.rows) || !classification || !classification.byId || !Array.isArray(classification.groups)) {
      throw new TypeError('Le bilan des MANUAL ID exige les lignes CSV et leur classification.');
    }
    const labels = new Map(), groups = new Map();
    const classifierGroups = new Map(classification.groups.map(group => [group.key, group]));
    let filledCount = 0, activeCount = 0, unresolvedCount = 0, unrecognizedCount = 0;

    for (const row of data.rows) {
      if (!row || typeof row.id !== 'string') throw new TypeError('Chaque contact doit avoir un identifiant de ligne source.');
      const label = String(row.manualId == null ? '' : row.manualId).trim();
      if (!label) continue;
      const assignment = valueAt(classification.byId, row.id);
      if (!assignment) throw new TypeError('Un contact du CSV est absent de la classification.');
      const active = assignment.origin === 'manual' && assignment.decisionSource === 'source';
      const name = Names.resolve(label);
      filledCount++;
      if (active) activeCount++;
      if (unresolvedCategories.has(name.category)) unresolvedCount++;
      if (!name.known) unrecognizedCount++;

      // Preserve each trimmed source spelling; the final activity table may
      // reconcile aliases, but this import inventory must show what was read.
      if (!labels.has(label)) labels.set(label, { label, count: 0, activeCount: 0, known: name.known, category: name.category });
      const labelEntry = labels.get(label);
      labelEntry.count++;
      if (active) labelEntry.activeCount++;

      const group = classifierGroups.get(assignment.groupKey);
      if (!group) throw new TypeError('Le groupe AUTO-ID d’un contact est absent de la classification.');
      if (!groups.has(group.key)) groups.set(group.key, { key: group.key, autoId: group.autoId, sourceCount: 0, activeCount: 0 });
      const groupEntry = groups.get(group.key);
      groupEntry.sourceCount++;
      if (active) groupEntry.activeCount++;
    }

    return {
      filledCount, activeCount, overriddenCount: filledCount - activeCount,
      unresolvedCount, unrecognizedCount,
      labels: [...labels.values()].sort((left, right) => left.label.localeCompare(right.label, 'fr')),
      groups: [...groups.values()].sort((left, right) => left.autoId.localeCompare(right.autoId, 'fr') || left.key.localeCompare(right.key))
    };
  }

  return { summarize };
});
