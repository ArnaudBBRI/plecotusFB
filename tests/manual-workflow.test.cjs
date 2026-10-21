const test = require('node:test');
const assert = require('node:assert/strict');
const Workflow = require('../manual-workflow.js');
const Best = require('../best-contacts.js');
const Names = require('../species.js');
const Import = require('../file-import.js');
const Decisions = require('../contact-decisions.js');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

test('import, review persistence and recalculated working IDs agree throughout the species workflow', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/manual-workflow-review.csv'));
  const file = { name: 'manual-workflow-review.csv', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
  const source = await Import.read(file);
  const original = structuredClone(source);
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const choices = await Decisions.create(source, { storage, crypto: webcrypto });
  assert.equal(Workflow.build(source, choices).ready, false);
  const bests = Best.build(source).groups.filter(group => group.best);
  choices.setMany(bests.map(group => group.best.recordIndex), 'validated');
  const eptser = bests.find(group => group.label === 'EPTSER').best.recordIndex;
  choices.set(eptser, 'invalidated');
  assert.equal(Workflow.build(source, choices).ready, false, 'an invalidation needs the actual identification');
  choices.setManualId(eptser, 'MYODAU');
  const plan = Workflow.build(source, choices);
  assert.equal(plan.ready, true);
  assert.equal(plan.remaining, 8);
  assert.equal(plan.groups.find(group => group.label === 'PIPPIP').mode, 'auto');
  assert.equal(plan.groups.find(group => group.label === 'NYCNOC').requiredIndices.length, 4);
  assert.equal(plan.groups.find(group => group.label === 'MYODAS').requiredIndices.length, 1);
  assert.equal(plan.groups.find(group => group.label === 'NoID').requiredIndices.length, 2);
  assert.equal(plan.automaticAssignments.length, 10);
  const firstAdditional = plan.requiredIndices[0];
  choices.set(firstAdditional, 'invalidated');
  assert.equal(Workflow.build(source, choices).remaining, 8);
  choices.setManualId(firstAdditional, 'Noise');
  assert.equal(Workflow.build(source, choices).remaining, 7);
  choices.setMany(plan.requiredIndices, 'validated');
  const reimported = await Import.read(file);
  const restored = await Decisions.create(reimported, { storage, crypto: webcrypto });
  const completed = Workflow.build(reimported, restored);
  assert.equal(completed.remaining, 0);
  assert.ok(completed.groups.every(group => group.progress === 1));
  assert.deepEqual(completed.requiredIndices, plan.requiredIndices);
  assert.equal(restored.get(eptser).status, 'invalidated');
  const semi = completed.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(completed.processed.records.filter(record => record[semi] === 'PIPPIP').length, 10);
  assert.equal(completed.processed.records.filter(record => record[semi]).length, 57);
  assert.equal(completed.assignmentReady, true);
  assert.deepEqual(source, original);
});

function imported(specifications, extraHeaders = []) {
  return { fileName: 'workflow.csv', sheetName: null,
    headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'PULSES', 'DATE', 'TIME', 'MATCHING', 'MANUAL ID', ...extraHeaders],
    records: specifications.map(([species, ratio, quality = '1', manual = '', ...extra], index) =>
      ['contact-' + index + '.wav', species, String(ratio), String(quality), '10', '2026-10-01', '21:00:00', '1', manual, ...extra]),
    sourceRows: specifications.map((_, index) => index + 4) };
}
function decisions(...items) { return { decisions: items.map(([recordIndex, status = 'validated', manualId]) =>
  ({ recordIndex, status, ...(manualId === undefined ? {} : { manualId }) })) }; }
function bestDecisions(source, status = 'validated') {
  return decisions(...Best.build(source).groups.filter(group => group.best).map(group => [group.best.recordIndex, status]));
}
const groupOf = (result, label) => result.groups.find(group => group.label === label);

test('the gate requires every available best to have a decision and an actual identification', () => {
  const source = imported([['PIPPIP', .9], ['PIPPIP', .8], ['MYODAS', .7], ['Noise', 1]]);
  let result = Workflow.build(source, decisions());
  assert.equal(result.ready, false);
  assert.deepEqual(result.pendingBestIndices, [2, 0]);
  result = Workflow.build(source, decisions([0, 'validated'], [2, 'invalidated']));
  assert.equal(result.ready, false);
  assert.deepEqual(result.pendingBestIndices, [2]);
  result = Workflow.build(source, decisions([0, 'validated'], [2, 'invalidated', 'MYODAU']));
  assert.equal(result.ready, true);
  assert.equal(result.excludedNoiseCount, 1);
  assert.deepEqual(result.groups.map(group => group.label), ['MYODAS', 'PIPPIP']);
  assert.equal(result.automaticAssignments.some(item => item.recordIndex === 3), false);
});

test('exactly half at MATCH RATIO 0.6 meets both inclusive thresholds', () => {
  const source = imported([['PIPPIP', .6], ['PIPPIP', .2]]);
  const result = Workflow.build(source, bestDecisions(source));
  const group = result.groups[0];
  assert.equal(group.qualifyingCount, 1);
  assert.equal(group.qualifyingShare, .5);
  assert.equal(group.mode, 'auto');
  assert.equal(group.progress, 1);
  assert.equal(group.remaining, 0);
  assert.deepEqual(result.automaticAssignments.map(item => item.value), ['PIPPIP', 'PIPPIP']);
  const columns = result.processed.headers;
  assert.equal(result.processed.records[0][columns.indexOf('MANUAL ID')], 'PIPPIP');
  assert.deepEqual(result.processed.records.map(record => record[columns.indexOf('SEMIMANUAL ID')]), ['PIPPIP', 'PIPPIP']);
  assert.equal(source.records[0][8], '', 'input cells remain unchanged');
  assert.equal(source.headers.includes('SEMIMANUAL ID'), false);
});

test('missing, negative, infinite and over-one source ratios stay in the denominator without qualifying', () => {
  const source = imported([['PIPPIP', .9], ['PIPPIP', ''], ['PIPPIP', -1], ['PIPPIP', 'Infinity'], ['PIPPIP', 2]]);
  const group = Workflow.build(source, bestDecisions(source)).groups[0];
  assert.equal(group.total, 5);
  assert.equal(group.qualifyingCount, 1);
  assert.equal(group.qualifyingShare, .2);
  assert.equal(group.mode, 'sample');
  assert.equal(group.bins.at(-1).count, 4);
});

test('all nine excluded species and recognized scientific aliases prevent direct validation', () => {
  const codes = Workflow.EXCLUDED_SPECIES;
  const aliases = ['Barbastella barbastellus', 'Rhinolophus ferrumequinum', 'Rhinolophus hipposideros',
    'Myotis bechsteinii', 'Myotis dasycneme', 'Myotis myotis', 'Myotis emarginatus', 'Nyctalus noctula', 'Nyctalus leisleri'];
  const source = imported([...codes, ...aliases].map(code => [code, 1]));
  const result = Workflow.build(source, bestDecisions(source));
  assert.equal(result.groups.length, 18);
  for (const group of result.groups) {
    assert.equal(group.sensitive, true, group.label);
    assert.equal(group.mode, 'sample', group.label);
  }
  assert.equal(result.automaticAssignments.length, 0);
});

test('an invalidated or pending reference cannot produce SEMIMANUAL IDs', () => {
  const source = imported(Array.from({ length: 10 }, () => ['PIPPIP', .9]));
  const bestIndex = Best.build(source).groups[0].best.recordIndex;
  for (const state of [decisions(), decisions([bestIndex, 'invalidated'])]) {
    const result = Workflow.build(source, state);
    assert.equal(result.groups[0].mode, 'sample');
    assert.equal(result.automaticAssignments.length, 0);
    const semi = result.processed.headers.indexOf('SEMIMANUAL ID');
    assert.ok(result.processed.records.every(record => record[semi] === ''));
  }
});

test('20 percent rounds upward, includes the best and tracks only additional controls', () => {
  const source = imported(Array.from({ length: 12 }, (_, index) => ['NYCNOC', index / 12]));
  const first = Workflow.build(source, bestDecisions(source));
  const group = first.groups[0];
  assert.equal(group.sampleTarget, 3);
  assert.equal(group.selectedIndices.length, 3);
  assert.ok(group.selectedIndices.includes(group.best.recordIndex));
  assert.equal(group.requiredIndices.length, 2);
  assert.equal(group.completed, 0);
  assert.equal(group.remaining, 2);
  assert.equal(group.progress, 0);
  assert.deepEqual(group.contacts.map(contact => contact.recordIndex), group.requiredIndices);
  const next = Workflow.build(source, decisions([group.best.recordIndex], [group.requiredIndices[0]], [group.requiredIndices[1], 'invalidated']));
  assert.equal(next.groups[0].progress, .5);
  assert.equal(next.groups[0].remaining, 1);
  assert.equal(next.groups[0].assignmentReady, false);
  assert.deepEqual(next.groups[0].pendingIdentificationIndices, [group.requiredIndices[1]]);
  assert.deepEqual(next.groups[0].selectedIndices, group.selectedIndices, 'decisions never reshuffle the sample');
  assert.equal(next.processed.records[group.requiredIndices[1]][8], '', 'invalidation does not invent a species label');
  const corrected = Workflow.build(source, decisions([group.best.recordIndex], [group.requiredIndices[0]], [group.requiredIndices[1], 'invalidated', 'MYODAU']));
  assert.equal(corrected.groups[0].progress, 1);
  assert.equal(corrected.groups[0].assignmentReady, true);
  assert.equal(corrected.processed.records[group.requiredIndices[1]][8], 'MYODAU');
});

test('proportional class quotas use fixed bins, largest remainders and deterministic samples', () => {
  const ratios = [.1, .3, .5, .7, .9];
  const source = imported(ratios.flatMap(value => Array.from({ length: 10 }, () => ['NYCNOC', value])));
  const state = bestDecisions(source);
  const first = Workflow.build(source, state).groups[0];
  assert.equal(first.sampleTarget, 10);
  assert.deepEqual(first.bins.map(bin => bin.count), [10, 10, 10, 10, 10, 0]);
  assert.deepEqual(first.bins.map(bin => bin.selectedCount), [2, 2, 2, 2, 2, 0]);
  const second = Workflow.build(structuredClone(source), structuredClone(state)).groups[0];
  assert.deepEqual(second.selectedIndices, first.selectedIndices);
});

test('small groups can require no additional manual controls once their reference was checked', () => {
  const source = imported([['NYCNOC', .9], ['NYCNOC', .2], ['NYCNOC', .1]]);
  const result = Workflow.build(source, bestDecisions(source));
  const group = result.groups[0];
  assert.equal(group.mode, 'sample');
  assert.equal(group.sampleTarget, 1);
  assert.deepEqual(group.requiredIndices, []);
  assert.equal(group.progress, 1);
});

test('NoID, missing identities, unknown codes and generic species groups remain individual work', () => {
  const source = imported([['NoID', .9], ['NoID', .7], ['', .9], ['', .8], ['UNKNOWN', .9], ['Myotis sp.', .9], ['Noise', .9]]);
  const result = Workflow.build(source, bestDecisions(source));
  assert.equal(result.groups.length, 4);
  for (const group of result.groups) assert.equal(group.mode, 'individual');
  assert.equal(result.automaticAssignments.length, 0);
  assert.equal(result.requiredIndices.length, 2, 'already-reviewed bests do not need reviewing again');
});

test('groups without an eligible best have no impossible gate and still receive manual controls', () => {
  const source = imported([['NoID', '', ''], ['NoID', '', '']]);
  for (const record of source.records) record[7] = '';
  const result = Workflow.build(source, decisions());
  assert.equal(result.ready, true);
  assert.equal(result.groups[0].best, null);
  assert.deepEqual(result.groups[0].requiredIndices, [0, 1]);
  assert.equal(result.groups[0].progress, 0);
});

test('recomputing after a reference change clears previous calculated source cells in the working copy', () => {
  const source = imported([['PIPPIP', .9, 1, '', 'OLD'], ['PIPPIP', .8, 1, '', 'OLD']], ['SEMIMANUAL ID']);
  const accepted = Workflow.build(source, bestDecisions(source));
  assert.ok(accepted.processed.records.every(record => record.at(-1) === 'PIPPIP'));
  const rejected = Workflow.build(source, bestDecisions(source, 'invalidated'));
  assert.ok(rejected.processed.records.every(record => record.at(-1) === ''));
  assert.ok(source.records.every(record => record.at(-1) === 'OLD'));
});

test('representative controls retain original physical lines and metadata even when a ratio is missing', () => {
  const source = imported(Array.from({ length: 20 }, (_, index) => ['NYCNOC', index < 10 ? '' : .9]));
  source.sourceRows = source.sourceRows.map(value => value + 30);
  const result = Workflow.build(source, bestDecisions(source));
  const group = result.groups[0];
  assert.equal(group.bins.at(-1).selectedCount, 2);
  const missing = group.contacts.find(contact => contact.ratio == null);
  assert.ok(missing);
  assert.equal(missing.lineNumber, source.sourceRows[missing.recordIndex]);
  assert.equal(missing.fileName, source.records[missing.recordIndex][0]);
  assert.equal(missing.qual, 1);
  assert.equal(missing.date, '2026-10-01');
});

test('model instances are accepted and unrelated decisions or malformed options fail explicitly', () => {
  const source = imported([['PIPPIP', .9]]);
  assert.equal(Workflow.build(source, { snapshot: () => bestDecisions(source) }).ready, true);
  for (const state of [{}, decisions([-1]), decisions([1]), decisions([0, 'yes']), decisions([0], [0])]) {
    assert.throws(() => Workflow.build(source, state), /décision/i);
  }
  assert.throws(() => Workflow.build(source, decisions(), { includeBestInQuota: 'yes' }), /options/i);
});

test('a complete 60/40 manual sample fills every remaining contact and preserves human labels', () => {
  const source = imported(Array.from({ length: 50 }, () => ['NYCNOC', .9]));
  const original = structuredClone(source);
  const selected = Workflow.build(source, bestDecisions(source)).groups[0].selectedIndices;
  assert.equal(selected.length, 10);
  const state = decisions(...selected.map((index, position) => [index, position < 6 ? 'validated' : 'invalidated',
    position < 6 ? position % 2 ? 'Nyctalus noctula' : 'NYCNOC'
      : position % 2 ? 'Murin de Daubenton' : 'MYODAU']));
  const result = Workflow.build(source, state);
  const group = result.groups[0];
  assert.equal(result.assignmentReady, true);
  assert.equal(group.completed, 9);
  assert.equal(group.remaining, 0);
  assert.equal(group.proportionalAssignments.length, 40);
  assert.deepEqual(group.distribution, [
    { label: 'MYODAU', manualCount: 4, share: .4, assignedCount: 16 },
    { label: 'NYCNOC', manualCount: 6, share: .6, assignedCount: 24 }
  ]);
  const manual = result.processed.headers.indexOf('MANUAL ID');
  const semi = result.processed.headers.indexOf('SEMIMANUAL ID');
  for (const item of state.decisions) {
    assert.equal(result.processed.records[item.recordIndex][manual], item.manualId);
    assert.equal(result.processed.records[item.recordIndex][semi], item.manualId);
    assert.equal(group.proportionalAssignments.some(value => value.recordIndex === item.recordIndex), false);
  }
  assert.equal(result.processed.records.filter(record => Names.resolve(record[semi]).key === 'NYCNOC').length, 30);
  assert.equal(result.processed.records.filter(record => Names.resolve(record[semi]).key === 'MYODAU').length, 20);
  assert.deepEqual(source, original);
});

test('pre-existing source MANUAL IDs count as observations and retain their own recordings', () => {
  const source = imported(Array.from({ length: 20 }, () => ['NYCNOC', .9]));
  const initial = Workflow.build(source, bestDecisions(source));
  const group = initial.groups[0];
  const selected = group.selectedIndices;
  for (let position = 0; position < selected.length; position++) {
    source.records[selected[position]][8] = ['NYCNOC', 'NYCNOC', 'MYODAU', 'Noise'][position];
  }
  const extra = source.records.findIndex((_, index) => !selected.includes(index));
  source.records[extra][8] = 'MYODAU';
  const result = Workflow.build(source, bestDecisions(source));
  const completed = result.groups[0];
  const semi = result.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(completed.assignmentReady, true);
  assert.equal(completed.remaining, 0, 'source manual IDs finish already identified additional controls');
  assert.equal(completed.proportionalAssignments.length, 15);
  assert.deepEqual(completed.distribution, [
    { label: 'MYODAU', manualCount: 2, share: .4, assignedCount: 6 },
    { label: 'Noise', manualCount: 1, share: .2, assignedCount: 3 },
    { label: 'NYCNOC', manualCount: 2, share: .4, assignedCount: 6 }
  ]);
  assert.equal(result.processed.records[extra][8], 'MYODAU');
  assert.equal(result.processed.records[extra][semi], 'MYODAU');
  assert.equal(result.processed.records.filter(record => record[semi] === 'MYODAU').length, 8);
  assert.equal(result.processed.records.filter(record => record[semi] === 'Noise').length, 4);
  assert.equal(result.processed.records.filter(record => record[semi] === 'NYCNOC').length, 8);
});

test('revising a manual outcome recalculates the prorata and clears inferred IDs until corrections are supplied', () => {
  const source = imported(Array.from({ length: 10 }, () => ['NYCNOC', .9, 1, '', 'OLD']), ['SEMIMANUAL ID']);
  const group = Workflow.build(source, bestDecisions(source)).groups[0];
  const best = group.best.recordIndex, additional = group.requiredIndices[0];
  const mixed = Workflow.build(source, decisions([best], [additional, 'invalidated', 'MYODAU']));
  const semi = mixed.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(mixed.processed.records.filter(record => record[semi] === 'MYODAU').length, 5);
  const sameSpecies = Workflow.build(source, decisions([best], [additional]));
  assert.ok(sameSpecies.processed.records.every(record => record[semi] === 'NYCNOC'));
  const awaitingCorrection = Workflow.build(source, decisions([best], [additional, 'invalidated']));
  assert.equal(awaitingCorrection.assignmentReady, false);
  assert.deepEqual(awaitingCorrection.pendingIdentificationIndices, [additional]);
  assert.equal(awaitingCorrection.proportionalAssignments.length, 0);
  assert.equal(awaitingCorrection.processed.records.filter(record => record[semi]).length, 1, 'only the genuine reference identification remains');
  assert.ok(source.records.every(record => record.at(-1) === 'OLD'));
});

test('a small sensitive group still extrapolates its corrected reference when no additional check is required', () => {
  const source = imported([['NYCNOC', .9], ['NYCNOC', .2], ['NYCNOC', .1]]);
  const best = Best.build(source).groups[0].best.recordIndex;
  const result = Workflow.build(source, decisions([best, 'invalidated', 'MYODAU']));
  const group = result.groups[0];
  const semi = result.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(group.mode, 'sample');
  assert.equal(group.remaining, 0);
  assert.equal(group.assignmentReady, true);
  assert.equal(group.proportionalAssignments.length, 2);
  assert.equal(result.automaticAssignments.length, 0);
  assert.ok(result.processed.records.every(record => record[semi] === 'MYODAU'));
});

test('individual categories preserve actual identifications without extrapolating unchecked rows', () => {
  const source = imported([['NoID', .9], ['NoID', .5], ['NoID', .2]]);
  const best = Best.build(source).groups[0].best.recordIndex;
  const result = Workflow.build(source, decisions([best, 'invalidated', 'PIPPIP']));
  const group = result.groups[0];
  const semi = result.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(group.mode, 'individual');
  assert.equal(group.remaining, 2);
  assert.equal(group.assignmentReady, false);
  assert.equal(group.proportionalAssignments.length, 0);
  assert.deepEqual(result.processed.records.map(record => record[semi]), ['PIPPIP', '', '']);
});

test('returning a reference to validated never overwrites contrary human IDs with the AUTO-ID', () => {
  const source = imported(Array.from({ length: 10 }, () => ['PIPPIP', .9]));
  const best = Best.build(source).groups[0].best.recordIndex;
  const rejectedPlan = Workflow.build(source, decisions([best, 'invalidated', 'MYODAU']));
  const additional = rejectedPlan.groups[0].requiredIndices[0];
  const restored = Workflow.build(source, decisions([best], [additional, 'invalidated', 'MYODAU']));
  const group = restored.groups[0];
  const semi = restored.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(group.referenceMatches, true);
  assert.equal(group.mode, 'sample');
  assert.equal(restored.automaticAssignments.length, 0);
  assert.ok(group.reasons.some(reason => /identifications manuelles/.test(reason)));
  assert.equal(restored.processed.records[additional][semi], 'MYODAU');
  assert.equal(restored.processed.records.filter(record => record[semi] === 'MYODAU').length, 5);
});

test('an unresolved invalidation outside the selected sample blocks guessed labels until it is identified', () => {
  const source = imported(Array.from({ length: 20 }, () => ['NYCNOC', .9]));
  const group = Workflow.build(source, bestDecisions(source)).groups[0];
  const outside = source.records.findIndex((_, index) => !group.selectedIndices.includes(index));
  const state = decisions(...group.selectedIndices.map(index => [index]), [outside, 'invalidated']);
  const result = Workflow.build(source, state);
  const semi = result.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(result.remaining, 0);
  assert.equal(result.assignmentReady, false);
  assert.deepEqual(result.pendingIdentificationIndices, [outside]);
  assert.equal(result.proportionalAssignments.length, 0);
  assert.equal(result.processed.records[outside][semi], '');
  assert.equal(result.processed.records.filter(record => record[semi]).length, 4);
});
