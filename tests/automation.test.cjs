const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const A = require('../automation.js');

const headers = ['IN FILE', 'FOLDER', 'DATE', 'DATE-12', 'AUTO ID', 'PULSES', 'MATCHING', 'MATCH RATIO', 'MARGIN', 'OFFSET', 'CHANNEL', 'MANUAL ID', 'ALTERNATE 1'];
function contact(index, changes = {}) {
  const values = { 'IN FILE': `contact-${index}.wav`, FOLDER: 'Bois', DATE: '2026-09-02', 'DATE-12': '2026-09-01', 'AUTO ID': 'PIPPIP', PULSES: '100', MATCHING: index === 0 ? '50' : '49', 'MATCH RATIO': '0.5', MARGIN: '0.1', OFFSET: '0', CHANNEL: '0', 'MANUAL ID': '', 'ALTERNATE 1': '', ...changes };
  return headers.map(header => values[header]);
}
function data(count = 50, changes = {}) {
  return analyze(Array.from({ length: count }, (_, index) => contact(index, typeof changes === 'function' ? changes(index) : changes)));
}
function analyze(records) { return { headers, ...Core.analyze(headers, records) }; }
function change(source, index, fields) {
  const records = source.rows.map(row => row.raw.slice());
  for (const [name, value] of Object.entries(fields)) records[index][headers.indexOf(name)] = value;
  return analyze(records);
}
function checked(label = 'PIPPIP', status = 'confirmed') { return { label, status }; }
function reference(source, label = 'PIPPIP', status = 'confirmed') {
  const first = A.classify(source, {}).groups.find(group => group.kind === 'species');
  return { [first.anchorId]: checked(label, status) };
}
function finishSample(source, reviews = {}, policy = {}, selections = {}) {
  const result = A.classify(source, reviews, policy, {}, selections);
  for (const group of result.groups) for (const id of group.selectedIds) if (!reviews[id] && !source.rows.find(row => row.id === id).manualId) reviews[id] = checked(group.autoId, group.kind === 'noise' ? 'noise' : group.kind === 'species' ? 'confirmed' : 'corrected');
  return reviews;
}
function conservation(result) {
  assert.equal(result.metrics.manual + result.metrics.inferred + result.metrics.ignored + result.metrics.pending, result.metrics.total);
  assert.equal(result.metrics.required + result.metrics.waiting, result.metrics.pending);
  assert.equal(result.summary.reduce((sum, item) => sum + item.total, 0), result.metrics.total);
  assert.equal(result.assignments.length, result.byId.size);
  for (const item of result.summary) assert.equal(item.manual + item.inferred + item.ignored + item.pending, item.total);
}

test('uses the new adjustable sample rule and retires old cautious settings', () => {
  assert.deepEqual(A.normalizePolicy(), { version: 2, samplePercent: 20, ignoreNoise: true });
  assert.deepEqual(A.normalizePolicy({ samplePercent: 35 }), { version: 2, samplePercent: 35, ignoreNoise: true });
  assert.deepEqual(A.normalizePolicy({ version: 1, auditPercent: 90, preset: 'faster' }), { version: 2, samplePercent: 20, ignoreNoise: true });
  assert.deepEqual(A.normalizePolicy({ preset: 'cautious' }), { version: 2, samplePercent: 20, ignoreNoise: true });
  assert.deepEqual(A.normalizePolicy({ ignoreNoise: false }), { version: 2, samplePercent: 20, ignoreNoise: false });
  assert.deepEqual(A.normalizePolicy({ version: 2, samplePercent: 20 }), { version: 2, samplePercent: 20, ignoreNoise: true }, 'Existing policies adopt the new default without changing their version.');
  for (const bad of [{ samplePercent: -1 }, { samplePercent: 101 }, { samplePercent: '20' }, { samplePercent: NaN }, { ignoreNoise: 'false' }, { ignoreNoise: 0 }, { version: 3 }, [], 'cautious']) assert.throws(() => A.normalizePolicy(bad));
});

test('initially requests only the best reference, with a representative sample ready if needed', () => {
  const source = data();
  const result = A.classify(source, {});
  const group = result.groups[0];
  assert.equal(group.mode, 'reference');
  assert.equal(group.anchorId, 'contact-1');
  assert.equal(group.sampleTarget, 10);
  assert.equal(group.recommendedIds.length, 10);
  assert.ok(group.recommendedIds.includes(group.anchorId));
  assert.equal(result.metrics.required, 1);
  assert.equal(result.metrics.waiting, 49);
  assert.equal(result.metrics.inferred, 0);
  assert.equal(result.byId.get(group.anchorId).role, 'reference');
  conservation(result);
});

test('the reference and ranking are global across nights and folders, with stable numeric tie breaks', () => {
  let source = data(8, index => ({ FOLDER: index < 4 ? 'A' : 'B', 'DATE-12': index < 4 ? '2026-09-01' : '2026-09-03', MATCHING: '40', 'MATCH RATIO': '0.8', MARGIN: '0.1' }));
  source = change(source, 6, { MATCHING: '80', 'MATCH RATIO': '0.9' });
  source = change(source, 7, { MATCHING: '80', 'MATCH RATIO': '0.9', MARGIN: '0.2' });
  assert.equal(source.groups.length, 2, 'Core still retains source folder/night groups.');
  const result = A.classify(source, {});
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].key, 'species:PIPPIP');
  assert.equal(result.groups[0].anchorId, source.rows[7].id);
  assert.equal(result.byId.get(source.rows[7].id).rank, 1);
  assert.equal(result.assignments.filter(row => row.isAnchor).length, 1);
  const tied = A.classify(change(source, 6, { MARGIN: '0.2' }), {});
  assert.equal(tied.groups[0].anchorId, source.rows[6].id);
});

test('strictly more than half and strictly above 0.6 are required for direct Auto-ID validation', () => {
  const source = data(4, index => ({ 'MATCH RATIO': ['0.9', '0.8', '0.6', '0.2'][index] }));
  const reviews = reference(source);
  const half = A.classify(source, reviews);
  assert.equal(half.groups[0].ratioAboveThresholdCount, 2);
  assert.equal(half.groups[0].majorityPass, false);
  assert.equal(half.groups[0].mode, 'proportion');
  const majority = A.classify(change(source, 2, { 'MATCH RATIO': '0.600001' }), reviews);
  assert.equal(majority.groups[0].majorityPass, true);
  assert.equal(majority.groups[0].mode, 'autoid');
  assert.ok(majority.assignments.filter(item => item.origin === 'inferred').every(item => item.method === 'autoid'));
  const boundary = A.classify(data(5, { 'MATCH RATIO': '0.6' }), reference(data(5, { 'MATCH RATIO': '0.6' })));
  assert.equal(boundary.groups[0].ratioAboveThresholdCount, 0);
});

test('missing and invalid ratios remain in the majority denominator', () => {
  const source = data(5, index => ({ 'MATCH RATIO': index < 2 ? '0.9' : 'invalid' }));
  const result = A.classify(source, reference(source));
  assert.equal(result.groups[0].ratioAboveThresholdCount, 2);
  assert.equal(result.groups[0].ratioAboveThresholdShare, 0.4);
  assert.equal(result.groups[0].mode, 'proportion');
  assert.equal(result.groups[0].strata.find(bin => bin.key === 'missing').total, 3);
});

test('direct validation fills SEMIMANUAL ID for every row and preserves actual manual overrides', () => {
  const source = data(10, { 'AUTO ID': ' pippip ', 'MATCH RATIO': '0.9', 'ALTERNATE 1': 'MYODAU', DATE: 'invalid', OFFSET: '-1' });
  const reviews = { 'contact-1': checked('PIPPIP'), 'contact-2': checked('MYODAU', 'corrected') };
  const result = A.classify(source, reviews);
  assert.equal(result.groups[0].mode, 'autoid');
  assert.equal(result.metrics.manual, 2);
  assert.equal(result.metrics.inferred, 8);
  assert.equal(result.byId.get('contact-2').label, 'MYODAU');
  assert.equal(result.byId.get('contact-2').method, 'manual');
  assert.equal(result.byId.get('contact-2').semimanualMethod, 'autoid');
  assert.ok(result.assignments.every(item => item.semimanualLabel === ' pippip '));
  assert.ok(result.assignments.filter(item => item.origin === 'inferred').every(item => item.label === 'pippip'));
  assert.equal(result.summary.find(item => item.label === 'MYODAU').total, 1);
  conservation(result);
});

test('all nine excluded codes require sampling, with exact scientific-name aliases', () => {
  for (const code of A.EXCLUDED_SPECIES) {
    for (const label of [code, code.toLowerCase(), ...A.EXCLUDED_ALIASES[code]]) {
      const source = data(10, { 'AUTO ID': label, 'MATCH RATIO': '0.9' });
      const result = A.classify(source, reference(source, label));
      assert.equal(result.groups[0].excluded, true, label);
      assert.equal(result.groups[0].mode, 'proportion', label);
      assert.equal(result.metrics.inferred, 0, 'A second mandatory sample is still missing.');
    }
  }
  const ordinary = data(10, { 'AUTO ID': 'PIPNAT', 'MATCH RATIO': '0.9' });
  assert.equal(A.classify(ordinary, reference(ordinary, 'PIPNAT')).groups[0].excluded, false);
});

test('an existing MANUAL ID can confirm the reference, and submitted decisions override imported labels', () => {
  const source = data(10, index => ({ 'MATCH RATIO': '0.9', 'MANUAL ID': index === 0 ? 'PIPPIP' : index === 1 ? 'MYODAU' : '' }));
  const imported = A.classify(source, {});
  assert.equal(imported.groups[0].mode, 'autoid');
  assert.equal(imported.groups[0].referenceDecisionSource, 'source');
  assert.equal(imported.metrics.manual, 2);
  assert.equal(imported.metrics.inferred, 8);
  assert.equal(imported.byId.get('contact-1').status, 'imported');
  assert.equal(imported.byId.get('contact-2').label, 'MYODAU');
  const corrected = A.classify(source, { 'contact-1': checked('MYODAU', 'corrected') });
  assert.equal(corrected.groups[0].mode, 'proportion');
  assert.equal(corrected.byId.get('contact-1').label, 'MYODAU');
  assert.equal(corrected.byId.get('contact-1').decisionSource, 'project');
  assert.equal(corrected.groups[0].blocked, false);
});

test('the default manual quota is ceil(20% of all species rows), including the reference', () => {
  const source = data(51);
  const result = A.classify(source, reference(source));
  assert.equal(result.groups[0].sampleTarget, 11);
  assert.equal(result.groups[0].selectedIds.length, 11);
  assert.equal(result.metrics.required, 10);
  assert.equal(result.metrics.waiting, 40);
  assert.equal(result.metrics.inferred, 0);
  const completed = A.classify(source, finishSample(source, reference(source)));
  assert.equal(completed.metrics.manual, 11);
  assert.equal(completed.metrics.inferred, 40);
  assert.equal(completed.groups[0].mode, 'proportion');
  assert.ok(completed.assignments.filter(item => item.origin === 'manual').every(item => item.semimanualLabel === ''));
  assert.ok(completed.assignments.filter(item => item.origin === 'inferred').every(item => item.semimanualLabel === item.label && item.method === 'proportion'));
  conservation(completed);
});

test('representative quotas use all ratio classes and largest remainders with reference included', () => {
  const ratios = [...Array(10).fill('0.1'), ...Array(20).fill('0.3'), ...Array(30).fill('0.5'), ...Array(20).fill('0.7'), ...Array(10).fill('0.9'), ...Array(10).fill('invalid')];
  const source = data(100, index => ({ 'MATCH RATIO': ratios[index] }));
  const result = A.classify(source, {});
  assert.deepEqual(result.groups[0].strata.map(bin => bin.total), [10, 20, 30, 20, 10, 10]);
  assert.deepEqual(result.groups[0].strata.map(bin => bin.selectedCount), [2, 4, 6, 4, 2, 2]);
  assert.equal(result.groups[0].recommendedIds.length, 20);
  assert.ok(result.groups[0].recommendedIds.includes('contact-1'));
  assert.deepEqual(result.groups[0].recommendedIds, A.classify(source, {}).groups[0].recommendedIds);
  const lower = A.classify(source, {}, { samplePercent: 3 });
  assert.equal(lower.groups[0].recommendedIds.length, 3);
  assert.ok(lower.groups[0].recommendedIds.includes('contact-1'));
});

test('ratio bin boundary values are closed on the right and invalid values separate', () => {
  const source = data(7, index => ({ 'MATCH RATIO': ['0', '0.2', '0.4', '0.6', '0.8', '1', 'bad'][index] }));
  const result = A.classify(source, {});
  assert.deepEqual(result.assignments.map(item => item.ratioClass), ['0-0.2', '0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1', 'missing']);
});

test('explicit contacts can replace suggestions, while the reference and declared minimum remain required', () => {
  const source = data(50);
  const selections = { 'species:PIPPIP': { selectedIds: source.rows.slice(30, 39).map(row => row.id) } };
  const initial = A.classify(source, reference(source), {}, {}, selections);
  assert.equal(initial.groups[0].selectedIds.length, 10);
  assert.ok(initial.groups[0].selectedIds.includes('contact-1'));
  assert.ok(initial.groups[0].selectedIds.includes('contact-31'));
  const reviews = finishSample(source, reference(source), {}, selections);
  const result = A.classify(source, reviews, {}, {}, selections);
  assert.equal(result.metrics.inferred, 40);
  const undersized = A.classify(source, reference(source), {}, {}, { 'species:PIPPIP': { selectedIds: [] } });
  assert.equal(undersized.groups[0].selectedIds.length, 1, 'The reference remains mandatory, but other suggestions can be removed.');
  assert.equal(undersized.groups[0].sampleTarget, 10);
  assert.equal(undersized.groups[0].selectionDeficit, 9);
  assert.equal(undersized.groups[0].selectionMeetsTarget, false);
  assert.equal(undersized.metrics.inferred, 0, 'Deselecting contacts does not silently lower the quota.');
  const adapted = A.classify(source, reference(source), {}, {}, { 'species:PIPPIP': { sampleTarget: 1, selectedIds: [] } });
  assert.equal(adapted.metrics.inferred, 49, 'Explicitly lowering the quota allows completion.');
  assert.equal(adapted.groups[0].selectionDeficit, 0);
  assert.throws(() => A.classify(source, {}, {}, {}, { 'species:PIPPIP': { selectedIds: ['wrong-species'] } }));
  conservation(result);
});

test('the user can deliberately lower or raise the species target with an exact integer override', () => {
  const source = data(51);
  const low = { 'species:PIPPIP': { sampleTarget: 3, selectedIds: ['contact-4', 'contact-5'] } };
  const result = A.classify(source, finishSample(source, reference(source), {}, low), {}, {}, low);
  assert.equal(result.groups[0].sampleTarget, 3);
  assert.equal(result.groups[0].explicitTarget, true);
  assert.equal(result.metrics.manual, 3);
  assert.equal(result.metrics.inferred, 48);
  const high = A.classify(source, reference(source), {}, {}, { 'species:PIPPIP': { sampleTarget: 51 } });
  assert.equal(high.metrics.required, 50);
  assert.equal(high.metrics.waiting, 0);
  for (const target of [0, 52, 1.5, '3']) assert.throws(() => A.classify(source, {}, {}, {}, { 'species:PIPPIP': { sampleTarget: target } }));
  const percent = A.classify(source, reference(source), {}, {}, { 'species:PIPPIP': { samplePercent: 10 } });
  assert.equal(percent.groups[0].sampleTarget, 6);
  conservation(result);
});

test('additional manual decisions count but do not waive uncompleted explicitly selected contacts', () => {
  const source = data(50);
  const initial = A.classify(source, reference(source));
  const selected = new Set(initial.groups[0].selectedIds);
  const reviews = reference(source);
  for (const row of source.rows.filter(row => !selected.has(row.id)).slice(0, 10)) reviews[row.id] = checked('MYODAU', 'corrected');
  const result = A.classify(source, reviews);
  assert.equal(result.metrics.manual, 11);
  assert.equal(result.groups[0].targetMet, true);
  assert.equal(result.metrics.inferred, 0);
  assert.equal(result.metrics.required, 9);
  const next = A.classify(source, finishSample(source, reviews));
  assert.equal(next.metrics.manual, 20);
  assert.equal(next.metrics.inferred, 30);
  assert.equal(next.groups[0].distribution.find(entry => entry.label === 'MYODAU').manualCount, 10);
  conservation(next);
});

test('remaining contacts follow the observed 10/80/10 distribution rather than the original Auto-ID', () => {
  const source = data(50);
  const initial = A.classify(source, reference(source));
  const selected = initial.groups[0].selectedIds;
  const reviews = {};
  selected.forEach((id, index) => { reviews[id] = checked(index === 0 ? 'Species A' : index === 9 ? 'Species C' : 'Species B', 'corrected'); });
  const result = A.classify(source, reviews);
  assert.equal(result.groups[0].mode, 'proportion');
  assert.equal(result.metrics.manual, 10);
  assert.equal(result.metrics.inferred, 40);
  assert.deepEqual(result.groups[0].distribution.map(entry => [entry.label, entry.manualCount, entry.inferredCount]), [['Species A', 1, 4], ['Species B', 8, 32], ['Species C', 1, 4]]);
  assert.deepEqual(result.summary.map(item => [item.label, item.total]), [['Species A', 5], ['Species B', 40], ['Species C', 5]]);
  assert.deepEqual(result.assignments.map(item => item.label), A.classify(source, reviews).assignments.map(item => item.label));
  assert.equal(result.groups[0].blocked, false);
  conservation(result);
});

test('largest remainders conserve integer totals when the observed proportions cannot be exact', () => {
  const source = data(10);
  const selections = { 'species:PIPPIP': { sampleTarget: 3, selectedIds: ['contact-1', 'contact-2', 'contact-3'] } };
  const reviews = { 'contact-1': checked('A', 'corrected'), 'contact-2': checked('B', 'corrected'), 'contact-3': checked('C', 'corrected') };
  const result = A.classify(source, reviews, {}, {}, selections);
  assert.deepEqual(result.groups[0].distribution.map(entry => entry.inferredCount), [3, 2, 2]);
  assert.deepEqual(result.summary.map(item => item.total), [4, 3, 3]);
  assert.equal(result.metrics.inferred, 7);
  conservation(result);
});

test('all additional and imported manual labels influence proportional allocations', () => {
  const base = data(50);
  const selected = new Set(A.classify(base, {}).groups[0].selectedIds);
  const extra = base.rows.find(row => !selected.has(row.id));
  const source = change(base, extra.index, { 'MANUAL ID': 'MYODAU' });
  const reviews = finishSample(source, reference(source));
  const result = A.classify(source, reviews);
  assert.equal(result.metrics.manual, 11);
  assert.equal(result.metrics.inferred, 39);
  const corrected = result.groups[0].distribution.find(entry => entry.label === 'MYODAU');
  assert.equal(corrected.manualCount, 1);
  assert.equal(corrected.inferredCount, 4);
  assert.equal(result.byId.get(extra.id).origin, 'manual');
  assert.equal(result.byId.get(extra.id).label, 'MYODAU');
  conservation(result);
});

test('manually uncertain outcomes propagate an unresolved bucket, never a falsely confirmed species', () => {
  const source = data(20);
  const selections = { 'species:PIPPIP': { sampleTarget: 4, selectedIds: ['contact-1', 'contact-2', 'contact-3', 'contact-4'] } };
  const reviews = { 'contact-1': checked('MYODAU', 'corrected'), 'contact-2': checked('MYODAU', 'corrected'), 'contact-3': checked('PIPPIP', 'uncertain'), 'contact-4': checked('Noise', 'noise') };
  const result = A.classify(source, reviews, {}, {}, selections);
  assert.equal(result.metrics.manual, 4);
  assert.equal(result.metrics.inferred, 16);
  assert.equal(result.metrics.uncertain, 5);
  assert.equal(result.metrics.unresolved, 5);
  assert.equal(result.metrics.noise, 5);
  assert.equal(result.metrics.taxon, 10);
  assert.equal(result.metrics.complete, false);
  assert.equal(result.assignments.filter(item => item.status === 'inferred-uncertain').length, 4);
  assert.ok(result.assignments.filter(item => item.status === 'inferred-uncertain').every(item => item.label === 'Chauve-souris non identifiée' && item.semimanualLabel === item.label));
  conservation(result);
});

test('NoID and unclassified contacts stay mandatory while Noise is ignored by default', () => {
  const records = [contact(0, { 'AUTO ID': 'NoID' }), contact(1, { 'AUTO ID': 'Noise', PULSES: '0', MATCHING: '0', 'MATCH RATIO': '0' }), contact(2, { 'AUTO ID': '' })];
  const source = analyze(records);
  const first = A.classify(source, {});
  assert.equal(first.metrics.required, 2);
  assert.equal(first.metrics.ignored, 1);
  assert.equal(first.metrics.noise, 1);
  assert.equal(first.metrics.pending, 2);
  assert.equal(first.metrics.unresolved, 2);
  assert.equal(first.metrics.inferred, 0);
  assert.ok(first.groups.every(group => group.mode === 'manual' && group.anchorId === null));
  assert.equal(first.byId.get('contact-2').origin, 'ignored');
  assert.equal(first.byId.get('contact-2').status, 'ignored-noise');
  assert.equal(first.byId.get('contact-2').method, 'ignored-noise');
  assert.equal(first.byId.get('contact-2').semimanualLabel, '');
  assert.equal(first.groups.find(group => group.kind === 'noise').ignoredCount, 1);
  assert.equal(first.groups.find(group => group.kind === 'noise').requiredCount, 0);
  conservation(first);
  const reviews = { 'contact-1': checked('MYODAU', 'corrected'), 'contact-2': checked('Noise', 'noise'), 'contact-3': checked('Chauve-souris non identifiée', 'corrected') };
  const completed = A.classify(source, reviews);
  assert.equal(completed.metrics.manual, 3);
  assert.equal(completed.metrics.inferred, 0);
  assert.equal(completed.metrics.noise, 1);
  assert.equal(completed.metrics.unresolved, 1);
  assert.ok(completed.assignments.every(item => item.semimanualLabel === ''));
  conservation(completed);
});

test('ignoring Noise retains every source row and never creates manual or semimanual labels', () => {
  const source = data(4, { 'AUTO ID': 'Noise' });
  const sourceBefore = JSON.stringify(source);
  const result = A.classify(source, {});
  assert.equal(result.metrics.ignored, 4);
  assert.equal(result.metrics.noise, 4);
  assert.equal(result.metrics.manual, 0);
  assert.equal(result.metrics.inferred, 0);
  assert.equal(result.metrics.required, 0);
  assert.equal(result.metrics.pending, 0);
  assert.equal(result.metrics.unresolved, 0);
  assert.equal(result.metrics.complete, true);
  assert.equal(result.groups[0].state, 'ignored');
  assert.equal(result.groups[0].sampleTarget, 0);
  assert.deepEqual(result.groups[0].selectedIds, []);
  assert.deepEqual(result.summary.map(item => [item.category, item.total, item.ignored]), [['noise', 4, 4]]);
  assert.ok(result.assignments.every(item => item.origin === 'ignored' && item.role === 'ignored' && !item.requiresReview && item.label === 'Noise' && item.semimanualLabel === '' && item.semimanualMethod === ''));
  assert.deepEqual(result.assignments.map(item => item.id), source.rows.map(row => row.id));
  assert.equal(JSON.stringify(source), sourceBefore);
  for (const item of result.assignments) assert.equal(item.row, source.rows.find(row => row.id === item.id));
  conservation(result);
});

test('disabling Noise exclusion restores individual checks without altering saved decisions', () => {
  const source = data(3, { 'AUTO ID': 'Noise' });
  const reviews = { 'contact-1': checked('MYODAU', 'corrected') };
  const ignored = A.classify(source, reviews);
  const active = A.classify(source, reviews, { ignoreNoise: false });
  assert.equal(ignored.metrics.ignored, 2);
  assert.equal(active.policy.ignoreNoise, false);
  assert.equal(active.metrics.ignored, 0);
  assert.equal(active.metrics.required, 2);
  assert.equal(active.metrics.pending, 2);
  assert.equal(active.groups[0].sampleTarget, 3);
  assert.equal(active.byId.get('contact-1').origin, 'manual');
  assert.equal(active.byId.get('contact-1').label, 'MYODAU');
  assert.ok(active.assignments.slice(1).every(item => item.origin === 'pending' && item.requiresReview));
  assert.equal(A.classify(source, reviews).metrics.ignored, 2, 'Switching back to the default omits unchecked Noise again.');
  conservation(ignored); conservation(active);
});

test('human corrections and confirmations take priority over the Noise default', () => {
  const source = data(5, index => ({ 'AUTO ID': 'Noise', 'MANUAL ID': index === 0 ? 'EPTSER' : index === 1 ? 'Noise' : '' }));
  const reviews = { 'contact-3': checked('MYODAS', 'corrected'), 'contact-4': checked('Noise', 'noise') };
  const result = A.classify(source, reviews);
  assert.equal(result.metrics.manual, 4);
  assert.equal(result.metrics.ignored, 1);
  assert.equal(result.metrics.noise, 3);
  assert.equal(result.metrics.taxon, 2);
  assert.equal(result.byId.get('contact-1').decisionSource, 'source');
  assert.equal(result.byId.get('contact-1').label, 'EPTSER');
  assert.equal(result.byId.get('contact-2').origin, 'manual');
  assert.equal(result.byId.get('contact-3').label, 'MYODAS');
  assert.equal(result.byId.get('contact-4').status, 'noise');
  assert.equal(result.groups[0].manualCount, 4);
  assert.equal(result.groups[0].ignoredCount, 1);
  assert.equal(result.metrics.required, 0);
  assert.ok(result.assignments.every(item => item.semimanualLabel === ''));
  conservation(result);
});

test('deliberate Noise drafts and invalid reviews require action while saved human decisions stay active', () => {
  const source = data(4, index => ({ 'AUTO ID': 'Noise', 'MANUAL ID': index === 1 ? 'EPTSER' : '' }));
  const reviews = { 'contact-2': { status: 'corrected', label: '' }, 'contact-3': checked('MYODAU', 'corrected') };
  const drafts = { 'contact-1': checked('EPTSER', 'corrected'), 'contact-3': checked('Noise', 'noise') };
  const result = A.classify(source, reviews, {}, drafts);
  assert.equal(result.metrics.ignored, 1);
  assert.equal(result.metrics.required, 2);
  assert.equal(result.metrics.pending, 2);
  assert.equal(result.metrics.manual, 1);
  assert.equal(result.byId.get('contact-1').status, 'draft');
  assert.equal(result.byId.get('contact-1').requiresReview, true);
  assert.equal(result.byId.get('contact-2').origin, 'pending', 'Invalid submitted review does not revive an imported manual label.');
  assert.equal(result.byId.get('contact-2').requiresReview, true);
  assert.equal(result.byId.get('contact-3').origin, 'manual');
  assert.equal(result.byId.get('contact-3').label, 'MYODAU');
  assert.equal(result.byId.get('contact-4').origin, 'ignored');
  assert.equal(result.groups[0].requiredCount, 2);
  assert.equal(result.groups[0].ignoredCount, 1);
  assert.equal(result.groups[0].sampleTarget, 3);
  conservation(result);
});

test('a draft cannot become an inferred outcome, but an existing saved manual decision stays active', () => {
  const source = data(10, { 'MATCH RATIO': '0.9' });
  const reviews = reference(source);
  const drafts = { 'contact-2': checked('MYODAU', 'corrected'), 'contact-1': checked('MYODAU', 'uncertain') };
  const result = A.classify(source, reviews, {}, drafts);
  assert.equal(result.byId.get('contact-2').origin, 'pending');
  assert.equal(result.byId.get('contact-2').status, 'draft');
  assert.equal(result.byId.get('contact-2').requiresReview, true);
  assert.equal(result.byId.get('contact-1').label, 'PIPPIP');
  assert.equal(result.metrics.inferred, 8);
  conservation(result);
});

test('changing the sample percentage recalculates inference while keeping every manual decision intact', () => {
  const source = data(50);
  const reviews = finishSample(source, reference(source));
  const before = JSON.stringify(reviews);
  const loose = A.classify(source, reviews);
  const strict = A.classify(source, reviews, { samplePercent: 50 });
  assert.equal(loose.metrics.inferred, 40);
  assert.equal(strict.metrics.inferred, 0);
  assert.equal(strict.metrics.manual, 10);
  assert.equal(strict.groups[0].sampleTarget, 25);
  assert.equal(JSON.stringify(reviews), before);
  assert.equal(A.classify(source, reviews).metrics.inferred, 40);
  conservation(strict);
});

test('samples never ask for more contacts than available, and a zero percentage still requires the reference', () => {
  const source = data(3);
  const all = A.classify(source, reference(source), { samplePercent: 100 });
  assert.equal(all.groups[0].sampleTarget, 3);
  assert.equal(all.metrics.required, 2);
  const completed = A.classify(source, finishSample(source, reference(source), { samplePercent: 100 }), { samplePercent: 100 });
  assert.equal(completed.metrics.manual, 3);
  assert.equal(completed.metrics.inferred, 0);
  const minimum = A.classify(source, reference(source), { samplePercent: 0 });
  assert.equal(minimum.groups[0].sampleTarget, 1);
  assert.equal(minimum.metrics.inferred, 2);
  conservation(completed); conservation(minimum);
});

test('malformed submitted decisions cannot turn into either imported confirmation or automatic labels', () => {
  const source = data(10, index => ({ 'MATCH RATIO': '0.9', 'MANUAL ID': index === 0 ? 'PIPPIP' : '' }));
  const reviews = { 'contact-1': { status: 'confirmed', label: '' }, 'contact-2': { status: 'noise', label: 'MYODAU' } };
  const result = A.classify(source, reviews);
  assert.equal(result.groups[0].mode, 'reference');
  assert.equal(result.byId.get('contact-1').origin, 'pending');
  assert.equal(result.byId.get('contact-1').requiresReview, true);
  const validReference = { ...reviews, 'contact-1': checked() };
  const next = A.classify(source, validReference);
  assert.equal(next.groups[0].mode, 'autoid');
  assert.equal(next.byId.get('contact-2').origin, 'pending');
  assert.equal(next.byId.get('contact-2').requiresReview, true);
  conservation(next);
});

test('classification is pure, stable after reopening, accepts Maps, and preserves all raw source cells', () => {
  const source = data(50);
  const reviews = new Map(Object.entries(finishSample(source, reference(source))));
  const selections = new Map();
  const before = JSON.stringify(source), decisions = JSON.stringify([...reviews]);
  const result = A.classify(source, reviews, {}, new Map(), selections);
  assert.equal(JSON.stringify(source), before);
  assert.equal(JSON.stringify([...reviews]), decisions);
  assert.deepEqual(result.assignments.map(item => item.id), source.rows.map(row => row.id));
  assert.deepEqual(result.assignments.map(item => item.semimanualLabel), A.classify(JSON.parse(before), Object.fromEntries(reviews)).assignments.map(item => item.semimanualLabel));
  for (const item of result.assignments) assert.equal(item.row, source.rows.find(row => row.id === item.id));
  conservation(result);
});
