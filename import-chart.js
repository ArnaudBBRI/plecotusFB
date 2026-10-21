(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./species.js'));
  else root.PlecotusImportChart = factory(root.BatReviewCore, root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Names) {
  'use strict';

  function identity(auto) {
    if (auto.kind === 'unclassified') {
      return { key: 'source:unclassified', scientificName: 'Sans identification automatique', frenchName: '', isSpecies: false, known: false };
    }
    const name = Names.resolve(auto.autoId);
    if (!name.known || name.category === 'noise') {
      // Only source AUTO-ID Noise is excluded. In particular, the literal
      // source label Bruit must survive the chart renderer’s extra noise guard.
      return { key: 'source:' + auto.autoId, scientificName: /^(noise|bruit)$/i.test(auto.autoId) ? auto.autoId + ' (libellé source)' : auto.autoId,
        frenchName: 'Nom non renseigné', isSpecies: false, known: false };
    }
    return { key: 'known:' + name.key, scientificName: name.scientificName || auto.autoId,
      frenchName: name.frenchName, isSpecies: name.isSpecies, known: true };
  }

  function build(imported) {
    if (!imported || !Array.isArray(imported.headers) || !Array.isArray(imported.records)) {
      throw new TypeError('Le graphique exige les en-têtes et les contacts du fichier importé.');
    }
    const columns = Core.canonicalColumns(imported.headers);
    const groups = new Map();
    let noiseCount = columns.autoId < 0 ? null : 0;
    let total = 0;
    for (const record of imported.records) {
      if (!Array.isArray(record)) throw new TypeError('Chaque contact du graphique doit être une ligne du fichier.');
      const auto = Core.normalizeAutoId(columns.autoId < 0 ? '' : record[columns.autoId]);
      if (auto.kind === 'noise') { noiseCount++; continue; }
      const name = identity(auto);
      if (!groups.has(name.key)) groups.set(name.key, { scientificName: name.scientificName, frenchName: name.frenchName,
        isSpecies: name.isSpecies, known: name.known, contacts: 0 });
      groups.get(name.key).contacts++;
      total++;
    }
    const rows = [...groups.values()].sort((a, b) => b.contacts - a.contacts || a.scientificName.localeCompare(b.scientificName, 'fr'));
    return { rows, total, noiseCount };
  }

  return Object.freeze({ build });
});
