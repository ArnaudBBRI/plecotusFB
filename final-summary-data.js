(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./species.js'), require('./activity-chart.js'));
  else root.PlecotusFinalSummaryData = factory(root.BatReviewCore, root.BatSpeciesNames, root.BatActivityChart);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Names, Chart) {
  'use strict';

  const text = value => String(value == null ? '' : value).trim();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const byName = (left, right) => left.scientificName.localeCompare(right.scientificName, 'fr')
    || left.frenchName.localeCompare(right.frenchName, 'fr') || (left.key || '').localeCompare(right.key || '', 'fr');

  function dense(value) {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index++) if (!own(value, index)) return false;
    return true;
  }

  function columnsFor(source) {
    if (!source || !dense(source.headers) || !dense(source.records)
      || !source.headers.length || source.headers.some(header => typeof header !== 'string')) {
      throw new TypeError('Le récapitulatif exige les en-têtes et les contacts complets du fichier.');
    }
    const columns = Core.canonicalColumns(source.headers);
    const semi = source.headers.map((header, index) => ({ index, name: text(header).toUpperCase().replace(/[^A-Z0-9]/g, '') }))
      .filter(header => header.name === 'SEMIMANUALID');
    if (semi.length > 1) throw new TypeError('Plusieurs colonnes désignent SEMIMANUAL ID dans le récapitulatif.');
    for (const record of source.records) {
      if (!dense(record) || record.length !== source.headers.length || record.some(cell =>
        cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)
        || typeof cell === 'number' && !Number.isFinite(cell))) {
        throw new TypeError('Une ligne de contacts du récapitulatif est incomplète ou invalide.');
      }
    }
    return { ...columns, semi: semi.length ? semi[0].index : -1 };
  }

  function sourceIdentity(value) {
    const auto = Core.normalizeAutoId(value);
    if (auto.kind === 'unclassified') return { key: 'source:unclassified', code: '',
      scientificName: 'Sans identification automatique', frenchName: '', isSpecies: false, known: false, category: 'unclassified' };
    const label = text(auto.autoId);
    const resolved = Names.resolve(label);
    // Source noise follows the import's exact AUTO-ID rule. The French source
    // label "Bruit" is not an AUTO-ID Noise row and stays in the before count.
    if (resolved.category === 'noise') return { key: 'source:' + label, code: '',
      scientificName: label + ' (libellé source)', frenchName: 'Nom non renseigné', isSpecies: false, known: false, category: 'unknown' };
    return identification(label);
  }

  function identification(label) {
    const resolved = Names.resolve(label);
    return { key: resolved.key, code: resolved.code || '',
      scientificName: resolved.scientificName || text(label), frenchName: resolved.frenchName || '',
      isSpecies: resolved.isSpecies, known: resolved.known, category: resolved.category };
  }

  function add(map, row) {
    if (!map.has(row.key)) map.set(row.key, { ...row, contacts: 0 });
    map.get(row.key).contacts++;
  }

  function build(imported, plan) {
    if (!plan || plan.ready !== true || plan.assignmentReady !== true || plan.remaining !== 0
      || !dense(plan.pendingIdentificationIndices) || plan.pendingIdentificationIndices.length
      || !dense(plan.pendingBestIndices) || plan.pendingBestIndices.length) {
      throw new Error('Terminez tous les contrôles et renseignez les identifications réelles avant de finaliser.');
    }
    const sourceColumns = columnsFor(imported);
    const processed = plan.processed;
    const finalColumns = columnsFor(processed);
    if (processed.records.length !== imported.records.length) {
      throw new Error('Le récapitulatif doit conserver exactement les mêmes contacts avant et après vérification.');
    }
    const before = new Map(), after = new Map();
    let beforeNoise = 0, afterNoise = 0, manualContacts = 0, calculatedContacts = 0;
    imported.records.forEach((source, index) => {
      const auto = sourceColumns.autoId < 0 ? '' : source[sourceColumns.autoId];
      if (Core.normalizeAutoId(auto).kind === 'noise') {
        beforeNoise++; afterNoise++;
        return;
      }
      add(before, sourceIdentity(auto));
      const record = processed.records[index];
      const manual = finalColumns.manualId < 0 ? '' : text(record[finalColumns.manualId]);
      const semi = finalColumns.semi < 0 ? '' : text(record[finalColumns.semi]);
      const actual = manual || semi;
      if (!actual) throw new Error('Une identification finale manque pour le contact de la ligne '
        + (imported.sourceRows && imported.sourceRows[index] || index + 2) + '.');
      if (manual) manualContacts++;
      else calculatedContacts++;
      const identified = identification(actual);
      if (identified.category === 'noise') afterNoise++;
      else add(after, identified);
    });

    const union = new Map();
    for (const row of [...before.values(), ...after.values()]) {
      if (!union.has(row.key)) union.set(row.key, { ...row, contacts: 0 });
      union.get(row.key).contacts += row.contacts;
    }
    // One palette is assigned across both populations, before separate sorting
    // or filtering, so each species keeps the same color in both diagrams.
    const colors = new Map(Chart.prepare([...union.values()]).rows.map(row => [Chart.rowKey(row), row.color]));
    const colorize = row => ({ ...row, color: colors.get(Chart.rowKey(row)) });
    const ordered = map => [...map.values()].map(colorize).sort((a, b) => b.contacts - a.contacts || byName(a, b));
    const beforeRows = ordered(before), afterRows = ordered(after);
    const comparisonRows = [...union.values()].map(row => ({ ...colorize(row),
      before: before.get(row.key)?.contacts || 0, after: after.get(row.key)?.contacts || 0 }))
      .sort((a, b) => Math.max(b.before, b.after) - Math.max(a.before, a.after) || byName(a, b));
    const tableRows = afterRows.map(({ scientificName, frenchName, contacts }) => ({ scientificName, frenchName, contacts }))
      .sort(byName);
    const sourceContacts = imported.records.length;
    return { fileName: text(imported.fileName), beforeRows, afterRows, comparisonRows, tableRows,
      beforeHasAutoId: sourceColumns.autoId >= 0,
      totals: { sourceContacts, beforeContacts: sourceContacts - beforeNoise, afterContacts: sourceContacts - afterNoise,
        beforeNoise, afterNoise, manualContacts, calculatedContacts } };
  }

  return Object.freeze({ build });
});
