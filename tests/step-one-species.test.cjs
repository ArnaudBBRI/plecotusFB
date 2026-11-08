const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Data = require('../step-one-species.js');
const Best = require('../best-contacts.js');
const Core = require('../core.js');
const Names = require('../species.js');
const Decisions = require('../contact-decisions.js');
const Workflow = require('../manual-workflow.js');
const Summary = require('../final-summary-data.js');

function source(specifications) {
  return { fileName: 'contacts.csv', headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'PULSES', 'MANUAL ID', 'SEMIMANUAL ID'],
    records: specifications.map((item, index) => [item.file || 'contact-' + index + '.wav', item.auto || '',
      item.ratio === undefined ? '.9' : item.ratio, item.qual === undefined ? '1' : item.qual,
      '10', item.manual || '', item.semi || '']), sourceRows: specifications.map((_, index) => index + 5) };
}
const snapshot = (...items) => ({ decisions: items.map(([recordIndex, status = 'validated', manualId]) =>
  ({ recordIndex, status, ...(manualId === undefined ? {} : { manualId }) })) });
const named = label => {
  const { scientificName, frenchName, isSpecies } = Names.resolve(label);
  return { scientificName, frenchName, isSpecies };
};

test('the list uses corrected current best identifications, deduplicates aliases and never counts contacts', () => {
  const imported = source([{ auto: 'PIPPIP' }, { auto: 'PIPPIP', ratio: '.8', manual: 'MYOMYO' },
    { auto: 'PIPNAT' }, { auto: 'EPTSER' }, { auto: ' n-o_i s e ', manual: 'PLEAUR' }]);
  const choices = snapshot([0, 'invalidated', 'MYODAU'], [1, 'invalidated', 'MYOMYO'],
    [2, 'invalidated', 'Vespertilion de Daubenton'], [3, 'validated', 'Cnephaeus serotinus'],
    [4, 'invalidated', 'PLEAUR']);
  const original = structuredClone({ imported, choices });
  const result = Data.build(imported, choices);
  assert.equal(result.ready, true);
  assert.equal(result.hasBestContacts, true);
  assert.deepEqual(result.bestIndices, [0, 2, 3]);
  assert.deepEqual(result.pendingBestIndices, []);
  assert.deepEqual(result.rows, [named('EPTSER'), named('MYODAU')]);
  assert(result.rows.every(row => Object.keys(row).sort().join(',') === 'frenchName,isSpecies,scientificName'));
  assert.deepEqual({ imported, choices }, original);
});

test('source MANUAL ID and SEMIMANUAL ID cannot replace a local review, and explicit null never falls back', () => {
  const imported = source([{ auto: 'PIPPIP', manual: 'MYOMYO', semi: 'PLEAUR' },
    { auto: 'MYODAU', manual: 'Identification incertaine/non résolue', semi: 'MYODAU' }]);
  let result = Data.build(imported, null);
  assert.equal(result.ready, false);
  assert.deepEqual(result.pendingBestIndices, [0, 1]);
  assert.deepEqual(result.rows, []);
  result = Data.build(imported, snapshot([0, 'validated', null], [1, 'invalidated']));
  assert.equal(result.ready, false);
  assert.deepEqual(result.pendingBestIndices, [0, 1]);
  result = Data.build(imported, snapshot([0], [1]));
  assert.equal(result.ready, true, 'legacy binary validations confirm AUTO-ID without using source manual cells');
  assert.deepEqual(result.rows, [named('MYODAU'), named('PIPPIP')]);
});

test('deferred best contacts block this export even when the manual workflow allows continuing', async () => {
  const imported = source([{ auto: 'PIPPIP' }, { auto: 'PIPPIP', ratio: '.8' }]);
  const choices = await Decisions.create(imported, { storage: null, crypto: webcrypto });
  choices.set(0, 'unresolved');
  assert.equal(Workflow.build(imported, choices).ready, true);
  assert.equal(Data.build(imported, choices).ready, false);
  assert.deepEqual(Data.build(imported, choices).pendingBestIndices, [0]);
  choices.setManualId(0, 'MYODAU');
  choices.set(1, 'unresolved');
  assert.equal(Workflow.build(imported, choices).assignmentReady, false);
  assert.equal(Data.build(imported, choices).ready, true, 'a deferred non-best is outside this list');
  assert.deepEqual(Data.build(imported, choices).rows, [named('MYODAU')]);
});

test('pending and uncertain labels are never treated as finalized identifications', () => {
  const imported = source([{ auto: 'PIPPIP' }]);
  for (const label of ['Identification incertaine/non résolue', 'Unresolved', 'À vérifier', 'Pending classification']) {
    const result = Data.build(imported, snapshot([0, 'invalidated', label]));
    assert.equal(result.ready, false, label);
    assert.deepEqual(result.pendingBestIndices, [0]);
    assert.deepEqual(result.rows, []);
  }
  const uncertainSource = source([{ auto: 'Unresolved', manual: 'PIPPIP' }]);
  assert.equal(Data.build(uncertainSource, snapshot([0])).ready, false);
});

test('NoID, broader categories and free labels follow the final table naming without merging distinct outcomes', () => {
  const labels = ['No ID', 'NoID', 'NoID Myo', 'MYOSP', 'Myotis spp.', 'Espèce libre <x>', 'MYODAU / MYONAT'];
  const imported = source(labels.map((_, index) => ({ auto: 'SOURCE' + index })));
  const choices = snapshot(...labels.map((label, index) => [index, 'invalidated', label]));
  const result = Data.build(imported, choices);
  const processed = { headers: imported.headers, records: imported.records.map((record, index) =>
    record.map((cell, column) => column === 5 ? labels[index] : cell)) };
  const final = Summary.build(imported, { ready: true, assignmentReady: true, remaining: 0,
    pendingBestIndices: [], pendingIdentificationIndices: [], unresolvedIndices: [], processed });
  assert.equal(result.ready, true);
  assert.deepEqual(result.rows, final.tableRows.map(({ scientificName, frenchName }) =>
    ({ scientificName, frenchName, isSpecies: Names.resolve(scientificName).isSpecies })));
  assert.equal(result.rows.length, 5);
  assert(result.rows.some(row => row.scientificName === 'NoID'));
  assert(result.rows.some(row => row.scientificName === 'NoID Myo'));
  assert(result.rows.some(row => row.scientificName === 'MYODAU / MYONAT' && !row.isSpecies));
});

test('no eligible best is unavailable while completed bests corrected to Noise yield a valid empty list', () => {
  const none = source([{ auto: 'PIPPIP', ratio: '', qual: '' }, { auto: 'Noise' }]);
  let result = Data.build(none, snapshot([0]));
  assert.equal(result.ready, false);
  assert.equal(result.hasBestContacts, false);
  assert.deepEqual(result.bestIndices, []);
  assert.deepEqual(result.noBestGroupKeys, ['source:PIPPIP']);
  assert.deepEqual(result.rows, []);
  const imported = source([{ auto: 'PIPPIP' }, { auto: 'MYODAU' }, { auto: 'NYCNOC', ratio: '', qual: '' }]);
  result = Data.build(imported, snapshot([0, 'invalidated', 'Noise'], [1, 'invalidated', 'Bruit']));
  assert.equal(result.ready, true);
  assert.equal(result.hasBestContacts, true);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.noBestGroupKeys, ['source:NYCNOC']);
  assert.equal(Data.build(source([{ auto: 'Noise' }]), null).hasBestContacts, false);
  assert.equal(Data.build(source([]), null).ready, false);
});

test('ranking changes recalculate the best and invalidate old selection signatures immediately', async () => {
  const imported = source([{ auto: 'PIPPIP', ratio: '.9', qual: '1' }, { auto: 'PIPPIP', ratio: '.8', qual: '10' }]);
  const choices = await Decisions.create(imported, { storage: null, crypto: webcrypto });
  choices.set(0, 'validated');
  const original = structuredClone(imported), saved = choices.snapshot();
  const previous = Data.build(imported, choices);
  const settings = { ranking: [{ key: 'qual', direction: 'desc' }] }, originalSettings = structuredClone(settings);
  let result = Data.build(imported, choices, settings);
  assert.equal(previous.ready, true);
  assert.equal(result.ready, false);
  assert.deepEqual(result.bestIndices, [1]);
  assert.deepEqual(result.pendingBestIndices, [1]);
  assert.notEqual(result.selectionSignature, previous.selectionSignature);
  assert.deepEqual(settings, originalSettings);
  assert.deepEqual(choices.snapshot(), saved);
  choices.setManualId(1, 'MYODAU');
  result = Data.build(imported, choices, settings);
  assert.equal(result.ready, true);
  assert.deepEqual(result.rows, [named('MYODAU')]);
  const signature = result.selectionSignature;
  choices.setManualId(1, 'PLEAUR');
  assert.notEqual(Data.build(imported, choices, settings).selectionSignature, signature);
  assert.deepEqual(imported, original);
});

test('the completed best list is available before additional sampling and unaffected by later non-best work', async () => {
  const imported = source(Array.from({ length: 20 }, (_, index) => ({ auto: 'NYCNOC', ratio: String(.9 - index / 100) })));
  const choices = await Decisions.create(imported, { storage: null, crypto: webcrypto });
  choices.set(0, 'validated');
  assert(Workflow.build(imported, choices).remaining > 0);
  const initial = Data.build(imported, choices);
  assert.equal(initial.ready, true);
  assert.deepEqual(initial.rows, [named('NYCNOC')]);
  choices.setManualId(1, 'NoID');
  choices.set(2, 'unresolved');
  assert.deepEqual(Data.build(imported, choices), initial);
});

test('get-only models are read live for current best indices and returned rows are detached', () => {
  const imported = source([{ auto: 'PIPPIP', ratio: '.8' }, { auto: 'PIPPIP', ratio: '.9' }]);
  const calls = [], choice = { status: 'invalidated', manualId: 'MYODAU' };
  const model = { get(index) { calls.push(index); return choice; } };
  const first = Data.build(imported, model);
  assert.deepEqual(calls, [1]);
  first.rows[0].scientificName = 'changed';
  first.bestIndices.push(999);
  assert.deepEqual(Data.build(imported, model).rows, [named('MYODAU')]);
  choice.manualId = 'MYONAT';
  assert.deepEqual(Data.build(imported, model).rows, [named('MYONAT')]);
});

test('malformed decision payloads and invalid settings fail instead of supplying a guessed list', () => {
  const imported = source([{ auto: 'PIPPIP' }]);
  assert.throws(() => Data.build(null, null), TypeError);
  assert.throws(() => Data.build(imported, { decisions: 'invalid' }), TypeError);
  assert.throws(() => Data.build(imported, snapshot([0], [0])), TypeError);
  assert.throws(() => Data.build(imported, snapshot([2])), TypeError);
  assert.throws(() => Data.build(imported, snapshot([0, 'guessed', 'MYODAU'])), TypeError);
  assert.throws(() => Data.build(imported, snapshot([0, 'invalidated', 12])), TypeError);
  assert.throws(() => Data.build(imported, snapshot([0, 'invalidated', 'MYO\nDAU'])), TypeError);
  assert.throws(() => Data.build(imported, snapshot([0, 'unresolved', 'MYODAU'])), TypeError);
  assert.throws(() => Data.build(imported, snapshot([0]), { ranking: [] }), TypeError);
});

test('the browser module requires only the existing local best selector, catalog and core', () => {
  const browser = { PlecotusBestContacts: Best, BatSpeciesNames: Names, BatReviewCore: Core };
  vm.runInNewContext(fs.readFileSync(require.resolve('../step-one-species.js'), 'utf8'), browser);
  const result = browser.PlecotusStepOneSpecies.build(source([{ auto: 'NoID' }]), snapshot([0]));
  assert.equal(result.ready, true);
  assert.equal(result.rows[0].scientificName, 'NoID');
});
