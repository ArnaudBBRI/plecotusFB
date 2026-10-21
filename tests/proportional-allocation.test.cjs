const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const Allocation = require('../proportional-allocation.js');

const indices = count => Array.from({ length: count }, (_, index) => index + 100);
const observations = entries => entries.flatMap(([label, count]) => Array.from({ length: count }, () => ({ label })));
const manual = observations([['A', 2], ['B', 16], ['C', 2]]);

test('manual species proportions allocate all remaining contacts with exact integer totals', () => {
  const remaining = indices(80);
  const before = structuredClone({ remaining, manual });
  const result = Allocation.allocate(remaining, manual);
  assert.deepEqual(result.distribution, [
    { label: 'A', manualCount: 2, share: .1, assignedCount: 8 },
    { label: 'B', manualCount: 16, share: .8, assignedCount: 64 },
    { label: 'C', manualCount: 2, share: .1, assignedCount: 8 }
  ]);
  assert.equal(result.total, 80);
  assert.equal(result.complete, true);
  assert.deepEqual(result.unassignedIndices, []);
  assert.deepEqual(result.assignments.map(item => item.recordIndex), remaining);
  assert.equal(new Set(result.assignments.map(item => item.recordIndex)).size, 80);
  assert.deepEqual({ remaining, manual }, before);
});

test('largest remainders preserve the total when seven contacts cannot follow exact percentages', () => {
  const result = Allocation.allocate(indices(7), manual);
  assert.deepEqual(result.distribution.map(item => [item.label, item.assignedCount]), [['A', 1], ['B', 5], ['C', 1]]);
  assert.equal(result.assignments.length, 7);
  assert.equal(result.assignments.filter(item => item.label === 'B').length, 5);
});

test('ties use stable French label order and label mappings do not depend on input order', () => {
  const remaining = [14, 9, 20, 3];
  const first = Allocation.allocate(remaining, [{ label: 'B' }, { label: 'A' }, { label: 'C' }]);
  const second = Allocation.allocate([...remaining].reverse(), [{ label: 'C' }, { label: 'B' }, { label: 'A' }]);
  assert.deepEqual(first.distribution.map(item => [item.label, item.assignedCount]), [['A', 2], ['B', 1], ['C', 1]]);
  assert.deepEqual(first.assignments.map(item => item.recordIndex), remaining, 'the caller’s source order is retained');
  const mapping = result => [...result.assignments].sort((a, b) => a.recordIndex - b.recordIndex);
  assert.deepEqual(mapping(first), mapping(second));
  assert.deepEqual(first.distribution, second.distribution);
});

test('labels keep their exact identity after trimming, including NoID and Noise', () => {
  const result = Allocation.allocate(indices(4), [{ label: ' A ' }, { label: 'a' }, { label: 'NoID' }, { label: 'Noise' }]);
  assert.equal(result.distribution.length, 4);
  assert.equal(result.distribution.find(item => item.label === 'A').manualCount, 1);
  assert.equal(result.distribution.find(item => item.label === 'a').manualCount, 1);
  assert.deepEqual(new Set(result.assignments.map(item => item.label)), new Set(['A', 'a', 'NoID', 'Noise']));
});

test('contacts without manual observations remain explicitly unassigned', () => {
  const remaining = [4, 2];
  assert.deepEqual(Allocation.allocate(remaining, []), {
    assignments: [], distribution: [], total: 0, complete: false, unassignedIndices: remaining
  });
  assert.deepEqual(Allocation.allocate([], []), {
    assignments: [], distribution: [], total: 0, complete: true, unassignedIndices: []
  });
  const observed = Allocation.allocate([], manual);
  assert.equal(observed.complete, true);
  assert.equal(observed.total, 0);
  assert.deepEqual(observed.distribution.map(item => item.assignedCount), [0, 0, 0]);
});

test('actual manual contacts are never candidates for reassignment when their indices are supplied', () => {
  const result = Allocation.allocate([4, 5], [{ recordIndex: 1, label: 'A' }, { recordIndex: 2, label: 'B' }]);
  assert.deepEqual(result.assignments.map(item => item.recordIndex), [4, 5]);
  assert.throws(() => Allocation.allocate([1], [{ recordIndex: 1, label: 'A' }]), /manuel.*réattribué/);
  assert.throws(() => Allocation.allocate([4], [{ recordIndex: 1, label: 'A' }, { recordIndex: 1, label: 'B' }]), /numéro unique/);
});

test('malformed inputs cannot silently change the denominator or drop a contact', () => {
  for (const remaining of [null, {}, new Array(2), [1, 1], [-1], [1.5], ['1'], [Infinity], [Number.MAX_SAFE_INTEGER + 1]]) {
    assert.throws(() => Allocation.allocate(remaining, [{ label: 'A' }]), /listes|numéro/);
  }
  for (const source of [null, {}, new Array(1), [null], ['A'], [{}], [{ label: 3 }], [{ label: '' }], [{ label: '   ' }], [{ label: 'A', recordIndex: -1 }]]) {
    assert.throws(() => Allocation.allocate([4], source), /listes|identification|numéro/);
  }
});

test('the same allocator is available in the standalone browser global', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../proportional-allocation.js'), 'utf8'), context);
  const result = context.PlecotusProportionalAllocation.allocate([2, 3], [{ label: 'A' }]);
  assert.equal(result.total, 2);
  assert.equal(result.assignments[0].label, 'A');
  assert.equal(result.assignments[1].label, 'A');
});
