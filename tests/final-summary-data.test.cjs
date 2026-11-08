const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Summary = require('../final-summary-data.js');
const Workflow = require('../manual-workflow.js');
const Best = require('../best-contacts.js');
const Decisions = require('../contact-decisions.js');
const Core = require('../core.js');
const Names = require('../species.js');
const Chart = require('../activity-chart.js');

function source(labels) {
  return { fileName: 'vérification.csv', headers: ['AUTO-ID', 'IN FILE', 'MATCH RATIO', 'Qual', 'MANUAL ID'],
    records: labels.map((label, index) => [label, 'contact-' + index + '.wav', '.9', '1', '']),
    sourceRows: labels.map((_, index) => index + 4) };
}

function ready(source, outcomes) {
  return { ready: true, assignmentReady: true, remaining: 0, pendingIdentificationIndices: [], pendingBestIndices: [],
    processed: { headers: [...source.headers, 'SEMIMANUAL ID'], records: source.records.map((row, index) =>
      [...row.slice(0, 4), outcomes[index]?.manual || '', outcomes[index]?.semi || '']) } };
}

test('completed workflow reconciles AUTO IDs with genuine 60/40 manual proportions, automatic acceptance, NoID and source noise', async () => {
  const imported = source([...Array(50).fill('NYCNOC'), ...Array(10).fill('PIPPIP'), 'NoID', 'NoID', 'Noise']);
  const original = structuredClone(imported);
  const choices = await Decisions.create(imported, { storage: null, crypto: webcrypto });
  choices.setMany(Best.build(imported).groups.filter(group => group.best).map(group => group.best.recordIndex), 'validated');
  const plan = Workflow.build(imported, choices);
  choices.setMany(plan.requiredIndices, 'validated');
  const nycnoc = plan.groups.find(group => group.label === 'NYCNOC');
  for (const index of nycnoc.selectedIndices.slice(0, 4)) choices.setManualId(index, 'MYODAU');
  const completed = Workflow.build(imported, choices);
  const originalPlan = structuredClone(completed);
  const result = Summary.build(imported, completed);
  assert.deepEqual(result.beforeRows.map(row => [row.code, row.contacts]), [['NYCNOC', 50], ['PIPPIP', 10], ['NoID', 2]]);
  assert.deepEqual(result.afterRows.map(row => [row.code, row.contacts]), [['NYCNOC', 30], ['MYODAU', 20], ['PIPPIP', 10], ['NoID', 2]]);
  assert.deepEqual(result.totals, { sourceContacts: 63, beforeContacts: 62, afterContacts: 62,
    beforeNoise: 1, afterNoise: 1, manualContacts: 12, calculatedContacts: 50 });
  assert.equal(completed.groups.find(group => group.label === 'NoID').sampleTarget, 1);
  assert.equal(result.tableRows.find(row => row.scientificName === 'Myotis daubentonii').frenchName, 'Murin de Daubenton');
  assert.equal(result.tableRows.reduce((sum, row) => sum + row.contacts, 0), 62);
  assert.ok(result.tableRows.every(row => Object.keys(row).join(',') === 'scientificName,frenchName,contacts'));
  assert.deepEqual(imported, original);
  assert.deepEqual(completed, originalPlan);
});

test('MANUAL ID takes priority over SEMIMANUAL ID and actual Noise moves into the after noise counter', () => {
  const imported = source(['NYCNOC', 'NYCNOC', 'PIPPIP', 'Noise']);
  const result = Summary.build(imported, ready(imported, [
    { manual: 'MYODAU', semi: 'NYCNOC' }, { semi: 'MYODAU' }, { manual: 'Noise', semi: 'PIPPIP' }, { manual: 'PIPPIP' }
  ]));
  assert.equal(result.beforeRows.find(row => row.code === 'NYCNOC').contacts, 2);
  assert.deepEqual(result.afterRows.map(row => [row.code, row.contacts]), [['MYODAU', 2]]);
  assert.deepEqual(result.totals, { sourceContacts: 4, beforeContacts: 3, afterContacts: 2,
    beforeNoise: 1, afterNoise: 2, manualContacts: 2, calculatedContacts: 1 });
  const comparison = new Map(result.comparisonRows.map(row => [row.code, row]));
  assert.deepEqual([comparison.get('NYCNOC').before, comparison.get('NYCNOC').after], [2, 0]);
  assert.deepEqual([comparison.get('MYODAU').before, comparison.get('MYODAU').after], [0, 2]);
});

test('known taxonomic aliases merge once and keep identical colors before and after even when counts reverse', () => {
  const imported = source(['PIPPIP', 'Pipistrelle commune', 'Pipistrellus pipistrellus', 'MYODAU']);
  const result = Summary.build(imported, ready(imported, [
    { manual: 'Myotis daubentonii' }, { semi: 'MYODAU' }, { semi: 'Murin de Daubenton' }, { manual: 'PIPPIP' }
  ]));
  assert.equal(result.beforeRows.length, 2);
  assert.equal(result.afterRows.length, 2);
  assert.equal(result.beforeRows.find(row => row.code === 'PIPPIP').contacts, 3);
  assert.equal(result.afterRows.find(row => row.code === 'MYODAU').contacts, 3);
  for (const before of result.beforeRows) assert.equal(before.color, result.afterRows.find(row => row.key === before.key).color);
  assert.equal(Chart.prepare(result.beforeRows).total, 4);
  assert.equal(Chart.prepare(result.afterRows).total, 4);
  assert.equal(result.beforeRows.find(row => row.code === 'MYODAU').color,
    result.comparisonRows.find(row => row.code === 'MYODAU').color);
});

test('unknown labels and empty source IDs remain visible without inventing Latin names; source Bruit matches import scope', () => {
  const imported = source(['', 'Mélange <inconnu>', 'Bruit', ' n-o_i s e ']);
  const result = Summary.build(imported, ready(imported, [
    { manual: 'NoID Myo' }, { manual: 'Espèce libre <x>' }, { manual: 'Bruit' }, {}
  ]));
  assert.equal(result.totals.beforeContacts, 3);
  assert.equal(result.totals.afterContacts, 2);
  assert.ok(result.beforeRows.some(row => row.scientificName === 'Sans identification automatique'));
  assert.ok(result.beforeRows.some(row => row.scientificName === 'Bruit (libellé source)'));
  assert.equal(Chart.prepare(result.beforeRows).total, 3);
  const unknown = result.tableRows.find(row => row.scientificName === 'Espèce libre <x>');
  assert.deepEqual(unknown, { scientificName: 'Espèce libre <x>', frenchName: 'Nom non renseigné', contacts: 1 });
  assert.ok(result.afterRows.some(row => row.code === 'NoID Myo'));
});

test('chart filtering never changes complete comparison totals or the export table', () => {
  const imported = source(['PIPPIP', 'MYODAU']);
  const result = Summary.build(imported, ready(imported, [{ manual: 'PIPPIP' }, { manual: 'MYODAU' }]));
  const original = structuredClone(result);
  const filtered = Names.chartRows(result.afterRows, false);
  const selected = Chart.select(result.beforeRows, new Set([Chart.rowKey(result.beforeRows[0])]));
  assert.equal(filtered.rows.length, 1);
  assert.equal(selected.total, 1);
  assert.deepEqual(result, original);
  assert.equal(result.tableRows.length, 2);
});

test('all-noise and header-only completed files produce explicit empty distributions', () => {
  for (const labels of [['Noise', 'NOISE'], []]) {
    const imported = source(labels);
    const result = Summary.build(imported, ready(imported, []));
    assert.deepEqual(result.beforeRows, []);
    assert.deepEqual(result.afterRows, []);
    assert.deepEqual(result.comparisonRows, []);
    assert.deepEqual(result.tableRows, []);
    assert.equal(result.totals.sourceContacts, labels.length);
    assert.equal(result.totals.afterNoise, labels.length);
  }
});

test('a missing source AUTO-ID column still permits a complete comparison after explicit identification', () => {
  const imported = { fileName: 'sans-auto.csv', headers: ['IN FILE'], records: [['a.wav'], ['b.wav']] };
  const plan = { ready: true, assignmentReady: true, remaining: 0, pendingIdentificationIndices: [], pendingBestIndices: [],
    processed: { headers: ['IN FILE', 'MANUAL ID'], records: [['a.wav', 'NoID'], ['b.wav', 'MYODAU']] } };
  const result = Summary.build(imported, plan);
  assert.equal(result.beforeHasAutoId, false);
  assert.equal(result.beforeRows[0].contacts, 2);
  assert.equal(result.beforeRows[0].scientificName, 'Sans identification automatique');
  assert.equal(result.totals.afterContacts, 2);
});

test('incomplete controls, unresolved final IDs and ambiguous or malformed data cannot silently create a final summary', () => {
  const imported = source(['NYCNOC']);
  const plan = ready(imported, [{ manual: 'NYCNOC' }]);
  for (const change of [{ ready: false }, { assignmentReady: false }, { remaining: 1 },
    { pendingIdentificationIndices: [0] }, { pendingBestIndices: [0] }, { unresolvedIndices: [0] }]) {
    assert.throws(() => Summary.build(imported, { ...plan, ...change }), /Terminez tous les contrôles/);
  }
  assert.throws(() => Summary.build(imported, ready(imported, [{}])), /identification finale manque/);
  for (const label of ['Identification incertaine/non résolue', 'Uncertain / unresolved']) {
    assert.throws(() => Summary.build(imported, ready(imported, [{ manual: label }])), /reste à reprendre/);
    assert.throws(() => Summary.build(imported, ready(imported, [{ semi: label }])), /reste à reprendre/);
  }
  const shorter = structuredClone(plan); shorter.processed.records = [];
  assert.throws(() => Summary.build(imported, shorter), /mêmes contacts/);
  const bad = structuredClone(plan); bad.processed.headers.push('semimanual_id');
  bad.processed.records[0].push('NYCNOC');
  assert.throws(() => Summary.build(imported, bad), /Plusieurs colonnes/);
  assert.throws(() => Summary.build({ ...imported, records: [null] }, plan), /ligne.*incomplète/);
  assert.throws(() => Summary.build({ headers: ['AUTO-ID', 'Auto ID'], records: [] }, plan), /ambiguïté/);
});

test('the standalone browser global follows the same data contract', () => {
  const context = vm.createContext({ BatReviewCore: Core, BatSpeciesNames: Names, BatActivityChart: Chart });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../final-summary-data.js'), 'utf8'), context);
  const imported = source(['PIPPIP']);
  const result = context.PlecotusFinalSummaryData.build(imported, ready(imported, [{ manual: 'PIPPIP' }]));
  assert.equal(result.afterRows[0].contacts, 1);
  assert.equal(result.tableRows[0].frenchName, 'Pipistrelle commune');
});
