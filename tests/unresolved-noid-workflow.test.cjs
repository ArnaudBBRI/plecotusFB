const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const Import = require('../file-import.js');
const Best = require('../best-contacts.js');
const Decisions = require('../contact-decisions.js');
const Workflow = require('../manual-workflow.js');
const Settings = require('../review-settings.js');
const Results = require('../results-file.js');

function input(count = 20, species = 'NYCNOC') {
  return { fileName: 'unresolved.csv', headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'MANUAL ID'],
    records: Array.from({ length: count }, (_, index) => ['contact-' + index + '.wav', species,
      String((count - index) / count), String(count - index), '']),
    sourceRows: Array.from({ length: count }, (_, index) => index + 2) };
}
const model = (source, options = {}) => Decisions.create(source, { storage: null, crypto: webcrypto, ...options });
const cell = (processed, index, column) => processed.records[index][processed.headers.indexOf(column)];
async function read(text, name = 'unresolved_resultats.csv') {
  const bytes = Buffer.from(text, 'utf8');
  return Import.read({ name, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
}

test('deferred decisions persist in v1 snapshots and can be resolved to a species or explicit NoID', async () => {
  const source = input(3, 'PIPPIP');
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const choices = await model(source, { storage });
  choices.setManualId(0, 'MYODAU');
  const unresolved = choices.set(0, 'unresolved');
  assert.equal(unresolved.status, 'unresolved');
  assert.equal(unresolved.manualId, null);
  assert.equal(unresolved.validated, false);
  assert.equal(unresolved.suggestedId, null);
  assert.equal(Decisions.isComplete(unresolved), false);
  assert(Object.isFrozen(unresolved));
  assert.equal(choices.snapshot().version, 1);
  const restored = await model(source, { storage });
  assert.deepEqual(restored.get(0), unresolved);
  restored.setManualId(0, 'Pipistrelle commune');
  assert.equal(restored.get(0).status, 'validated');
  assert.equal(Decisions.isComplete(restored.get(0)), true);
  restored.setManualId(1, 'NoID');
  assert.equal(restored.get(1).status, 'invalidated');
  assert.equal(Decisions.isComplete(restored.get(1)), true);
  restored.setManualId(2, Decisions.UNRESOLVED_LABEL);
  assert.equal(restored.get(2).status, 'unresolved');
  assert.equal(restored.get(2).manualId, null);
  restored.setManualId(2, 'Identification incertaine');
  assert.equal(restored.get(2).status, 'unresolved');
});

test('deferred batches remain atomic and malformed persisted deferred outcomes never supply a partial review', async () => {
  const source = input(3);
  const saved = new Map();
  let writes = 0;
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => { writes++; saved.set(key, value); } };
  const choices = await model(source, { storage });
  choices.setMany([2, 0, 2], 'unresolved');
  assert.equal(writes, 1);
  assert.deepEqual(choices.snapshot().decisions.map(item => item.recordIndex), [0, 2]);
  const before = choices.snapshot();
  assert.throws(() => choices.setMany([1, 99], 'unresolved'), /numéro/);
  assert.deepEqual(choices.snapshot(), before);
  assert.equal(writes, 1);
  const key = [...saved.keys()][0];
  const forged = JSON.parse(saved.get(key));
  forged.decisions[1].manualId = 'MYODAU';
  saved.set(key, JSON.stringify(forged));
  assert.deepEqual((await model(source, { storage })).snapshot().decisions, []);
});

test('deferring the best contact unlocks the next screen while keeping it mandatory and blocking assignments', async () => {
  const source = input(20, 'PIPPIP');
  for (const record of source.records) record[2] = '.9';
  source.records[0][4] = 'PIPPIP';
  const original = structuredClone(source);
  const choices = await model(source);
  choices.set(0, 'unresolved');
  let plan = Workflow.build(source, choices);
  assert.equal(plan.ready, true);
  assert.deepEqual(plan.pendingBestIndices, []);
  assert.deepEqual(plan.unresolvedIndices, [0]);
  assert.deepEqual(plan.groups[0].unresolvedIndices, [0]);
  assert(plan.requiredIndices.includes(0));
  assert(plan.groups[0].contacts.some(contact => contact.recordIndex === 0 && contact.status === 'unresolved'));
  choices.setMany(plan.requiredIndices.filter(index => index !== 0), 'validated');
  plan = Workflow.build(source, choices);
  assert.equal(plan.remaining, 1);
  assert.equal(plan.assignmentReady, false);
  assert.equal(plan.groups[0].assignmentReady, false);
  assert.equal(plan.automaticAssignments.length, 0);
  assert.equal(plan.proportionalAssignments.length, 0);
  assert.equal(cell(plan.processed, 0, 'MANUAL ID'), '');
  assert.equal(cell(plan.processed, 0, 'SEMIMANUAL ID'), '');
  assert.equal(plan.groups[0].distribution.reduce((sum, item) => sum + item.manualCount, 0), plan.requiredIndices.length - 1,
    'the deferred reference cannot contribute an observation through its original MANUAL ID');
  choices.setManualId(0, 'PIPPIP');
  plan = Workflow.build(source, choices);
  assert.deepEqual(plan.unresolvedIndices, []);
  assert.equal(plan.assignmentReady, true);
  assert.equal(plan.groups[0].mode, 'auto');
  assert.deepEqual(source, original);
});

test('an out-of-sample deferred contact is added to mandatory controls and excluded from observed proportions', async () => {
  const source = input(20);
  const choices = await model(source);
  choices.set(0, 'validated');
  const initial = Workflow.build(source, choices);
  choices.setMany(initial.requiredIndices, 'validated');
  assert.equal(Workflow.build(source, choices).assignmentReady, true);
  const outside = source.records.findIndex((_, index) => !initial.groups[0].selectedIndices.includes(index));
  source.records[outside][4] = 'MYODAU';
  choices.set(outside, 'unresolved');
  const blocked = Workflow.build(source, choices);
  assert.deepEqual(blocked.groups[0].selectedIndices, initial.groups[0].selectedIndices);
  assert(blocked.requiredIndices.includes(outside));
  assert(blocked.pendingIdentificationIndices.includes(outside));
  assert.equal(blocked.remaining, 1);
  assert.equal(blocked.assignmentReady, false);
  assert.equal(blocked.proportionalAssignments.length, 0);
  assert.equal(blocked.groups[0].distribution.some(item => item.label === 'MYODAU'), false);
  assert.equal(cell(blocked.processed, outside, 'MANUAL ID'), '');
  choices.setManualId(outside, 'NoID');
  const completed = Workflow.build(source, choices);
  assert.equal(completed.assignmentReady, true);
  assert.equal(cell(completed.processed, outside, 'MANUAL ID'), 'NoID');
  assert(completed.groups[0].distribution.some(item => item.label === 'NoID'));
});

test('saved deferred Noise contacts block the global gate and expose sorted metadata for re-review', async () => {
  const source = input(4, 'Noise');
  const choices = await model(source);
  choices.setMany([3, 1], 'unresolved');
  const plan = Workflow.build(source, choices);
  assert.equal(plan.groups.length, 0);
  assert.equal(plan.ready, true);
  assert.equal(plan.assignmentReady, false);
  assert.deepEqual(plan.unresolvedIndices, [1, 3]);
  assert.deepEqual(plan.pendingIdentificationIndices, [1, 3]);
  assert.deepEqual(plan.unresolvedContacts.map(item => [item.recordIndex, item.fileName, item.groupLabel]),
    [[1, 'contact-1.wav', 'Noise'], [3, 'contact-3.wav', 'Noise']]);
  assert.equal(plan.remaining, 2);
});

test('imported uncertainty outcomes are deferred without becoming manual observations or mutating the source', async () => {
  const source = input(10);
  source.records[0][4] = Decisions.UNRESOLVED_LABEL;
  source.records[5][4] = 'Uncertain';
  const original = structuredClone(source);
  const choices = await model(source);
  const plan = Workflow.build(source, choices);
  assert.equal(plan.ready, true, 'an imported deferred best can be revisited on the manual screen');
  assert.deepEqual(plan.unresolvedIndices, [0, 5]);
  assert.equal(plan.assignmentReady, false);
  assert(plan.groups[0].requiredIndices.includes(0));
  assert(plan.groups[0].requiredIndices.includes(5));
  assert.equal(plan.groups[0].distribution.length, 0);
  assert.equal(cell(plan.processed, 0, 'MANUAL ID'), '');
  assert.equal(cell(plan.processed, 5, 'MANUAL ID'), '');
  const saved = Results.build(source, plan, choices.snapshot());
  assert.equal(saved.records[0][saved.headers.indexOf(Results.ORIGIN_HEADER)], Results.ORIGINS.unresolved);
  assert.equal(saved.records[5][saved.headers.indexOf(Results.ORIGIN_HEADER)], Results.ORIGINS.unresolved);
  assert.deepEqual(source, original);
});

test('generic NoID aliases use the normal stratified 20 percent sample and can propagate explicit manual outcomes', async () => {
  for (const alias of ['NoID', 'No ID', 'NoAutoID', 'Chauve-souris non identifiée']) {
    const source = input(20, alias);
    const choices = await model(source);
    choices.set(0, 'validated');
    let plan = Workflow.build(source, choices, { settings: { excludedSpecies: [], majorityThreshold: 0, ratioThreshold: 0 } });
    const group = plan.groups[0];
    assert.equal(group.mode, 'sample', alias);
    assert.equal(group.sensitive, true);
    assert.equal(group.sampleTarget, 4);
    assert.equal(group.selectedIndices.length, 4);
    assert(group.selectedIndices.includes(0));
    assert.equal(group.requiredIndices.length, 3);
    assert.equal(plan.automaticAssignments.length, 0);
    choices.setMany(group.requiredIndices, 'validated');
    choices.setManualId(group.requiredIndices[0], 'MYODAU');
    plan = Workflow.build(source, choices);
    assert.equal(plan.assignmentReady, true);
    assert.equal(plan.proportionalAssignments.length, 16);
    assert(plan.groups[0].distribution.some(item => item.label === 'NoID'));
    assert(plan.groups[0].distribution.some(item => item.label === 'MYODAU'));
  }
});

test('NoID without an eligible best still uses a sample while blank and unknown source IDs remain individual', async () => {
  const noid = input(10, 'NoID');
  for (const record of noid.records) { record[2] = ''; record[3] = ''; }
  const plan = Workflow.build(noid, await model(noid));
  assert.equal(plan.ready, true);
  assert.equal(plan.groups[0].best, null);
  assert.equal(plan.groups[0].sampleTarget, 2);
  assert.equal(plan.requiredIndices.length, 2);
  for (const species of ['', 'Unclassified', 'UNRECOGNIZED', 'Myotis sp.', 'NoID Pip']) {
    const source = input(10, species);
    assert.equal(Workflow.build(source, await model(source)).groups[0].mode, 'individual');
  }
});

test('NoID is pinned and canonicalized in both defaults and older exclusion preferences', () => {
  assert.equal(Settings.DEFAULTS.excludedSpecies.at(-1), 'NoID');
  for (const excludedSpecies of [[], ['PIPPIP'], ['No ID'], ['NoAutoID', 'NoID', 'PIPPIP']]) {
    const normalized = Settings.normalize({ excludedSpecies });
    assert.equal(normalized.excludedSpecies.at(-1), 'NoID');
    assert.equal(normalized.excludedSpecies.filter(label => label === 'NoID').length, 1);
  }
  assert.deepEqual(Settings.normalize({ excludedSpecies: [] }).excludedSpecies, ['NoID']);
  assert.throws(() => Settings.normalize({ excludedSpecies: ['NoID Myo'] }), /Espèce inconnue/);
});

test('portable CSV results distinguish deferred outcomes, clear IDs and restore them as unfinished decisions', async () => {
  const source = input(20, 'NoID');
  const choices = await model(source);
  choices.set(0, 'unresolved');
  const first = Workflow.build(source, choices);
  choices.setMany(first.requiredIndices.filter(index => index !== 0), 'validated');
  const plan = Workflow.build(source, choices);
  const saved = Results.build(source, plan, choices.snapshot());
  assert.equal(saved.counts.unresolved, 1);
  assert.equal(cell(saved, 0, Results.ORIGIN_HEADER), 'Identification incertaine/non résolue — à revoir');
  assert.equal(cell(saved, 0, 'MANUAL ID'), '');
  assert.equal(cell(saved, 0, 'SEMIMANUAL ID'), '');
  const loaded = await read(saved.text, saved.fileName);
  const resume = Results.prepareResume(loaded);
  assert.deepEqual(resume.unresolved, [0]);
  const restored = await model(resume.imported);
  Results.applyResume(restored, resume);
  assert.equal(restored.get(0).status, 'unresolved');
  assert.equal(restored.get(0).manualId, null);
  const rebuilt = Workflow.build(resume.imported, restored);
  assert.equal(rebuilt.ready, true);
  assert.equal(rebuilt.assignmentReady, false);
  assert.equal(rebuilt.remaining, 1);
  assert.deepEqual(rebuilt.requiredIndices, plan.requiredIndices);
  restored.setManualId(0, 'NoID');
  assert.equal(Workflow.build(resume.imported, restored).assignmentReady, true);
  const newer = await model(resume.imported);
  newer.setManualId(0, 'MYODAU');
  assert.deepEqual(Results.applyResume(newer, resume), { restored: 0, fromBrowser: true });
  assert.equal(newer.get(0).manualId, 'MYODAU');
});
