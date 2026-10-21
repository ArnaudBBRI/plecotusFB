const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const Decisions = require('../contact-decisions.js');
const Workflow = require('../manual-workflow.js');

function imported(overrides = {}) {
  return { fileName: 'contacts.csv', sheetName: null,
    headers: ['IN FILE', 'AUTO-ID', 'OFFSET', 'MANUAL ID'],
    records: [['same.wav', 'PIPPIP', '0', ''], ['same.wav', 'MYODAS', '15', 'note source']],
    sourceRows: [5, 8], ...overrides };
}
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value) };
}
const options = storage => ({ storage, crypto: webcrypto });

test('the latest choice replaces the previous one; clicking the selected choice does not undo it', async () => {
  const source = imported();
  const before = structuredClone(source);
  const model = await Decisions.create(source, options(memoryStorage()));
  assert.equal(model.get(0), null);
  const validated = model.set(0, 'validated');
  assert.equal(validated.validated, true);
  assert.equal(validated.suggestedId, 'PIPPIP');
  assert.equal(validated.manualId, 'PIPPIP');
  assert.equal(validated.sourceAutoId, 'PIPPIP');
  assert.equal(validated.sourceRow, 5);
  assert.equal(model.set(0, 'validated'), validated);
  const invalidated = model.set(0, 'invalidated');
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.validated, false);
  assert.equal(invalidated.suggestedId, null);
  assert.equal(invalidated.manualId, null);
  assert.equal(model.get(0), invalidated);
  assert.equal(model.snapshot().decisions.length, 1);
  assert.deepEqual(source, before);
  assert.equal(model.set(0, 'validated').status, 'validated');
});

test('contacts sharing a WAV keep independent decisions by original record and physical row', async () => {
  const model = await Decisions.create(imported(), options(memoryStorage()));
  model.setManualId(1, 'MYODAU');
  model.set(0, 'validated');
  assert.equal(model.get(0).status, 'validated');
  assert.equal(model.get(1).status, 'invalidated');
  assert.equal(model.get(1).sourceRow, 8);
  assert.equal(model.get(0).manualId, 'PIPPIP');
  assert.equal(model.get(1).manualId, 'MYODAU');
  assert.deepEqual(model.snapshot().decisions.map(item => item.recordIndex), [0, 1]);
});

test('manual identification preserves the actual species without changing imported MANUAL ID cells', async () => {
  const source = imported();
  const before = structuredClone(source);
  const model = await Decisions.create(source, options(memoryStorage()));
  const corrected = model.setManualId(1, '  Murin de Daubenton  ');
  assert.equal(Object.isFrozen(corrected), true);
  assert.equal(corrected.status, 'invalidated');
  assert.equal(corrected.validated, false);
  assert.equal(corrected.manualId, 'Murin de Daubenton');
  assert.equal(corrected.suggestedId, null);
  assert.equal(corrected.sourceAutoId, 'MYODAS');
  assert.equal(model.setManualId(1, 'Murin de Daubenton'), corrected);
  assert.equal(model.set(1, 'invalidated'), corrected);
  assert.equal(model.setMany([1, 1], 'invalidated')[0], corrected);
  assert.deepEqual(source, before);
  const accepted = model.set(1, 'validated');
  assert.equal(accepted.manualId, 'MYODAS');
  assert.equal(accepted.suggestedId, 'MYODAS');
  assert.equal(model.set(1, 'invalidated').manualId, null);
});

test('known scientific names, French names, codes, and normalized unknown IDs derive matching status', async () => {
  const model = await Decisions.create(imported(), options(memoryStorage()));
  for (const label of ['Pipistrellus pipistrellus', 'Pipistrelle commune', 'pippip']) {
    const decision = model.setManualId(0, label);
    assert.equal(decision.status, 'validated');
    assert.equal(decision.manualId, label);
    assert.equal(decision.suggestedId, 'PIPPIP');
    assert.equal(model.set(0, 'validated'), decision);
  }
  for (const label of ['MYODAU', 'NoID', 'Noise', 'Espèce à préciser / groupe inconnu']) {
    assert.equal(model.setManualId(0, label).status, 'invalidated');
    assert.equal(model.get(0).manualId, label);
  }
  const unknown = await Decisions.create(imported({ records: [['x.wav', ' CUSTOM-TAXON ', '0', '']], sourceRows: [5] }), options(memoryStorage()));
  assert.equal(unknown.setManualId(0, ' custom-taxon ').status, 'validated');
  assert.equal(unknown.get(0).manualId, 'custom-taxon');
  assert.equal(unknown.get(0).suggestedId, 'CUSTOM-TAXON');
});

test('bulk validation replaces corrections while repeated invalidation retains them', async () => {
  const model = await Decisions.create(imported(), options(memoryStorage()));
  const corrected = model.setManualId(0, 'MYODAU');
  const accepted = model.setManualId(1, 'Myotis dasycneme');
  const invalidated = model.setMany([0, 1], 'invalidated');
  assert.equal(invalidated[0], corrected);
  assert.notEqual(invalidated[1], accepted);
  assert.equal(invalidated[1].manualId, null);
  model.setManualId(1, 'Noise');
  model.setMany([0, 1], 'validated');
  assert.deepEqual(model.snapshot().decisions.map(item => item.manualId), ['PIPPIP', 'MYODAS']);
});

test('invalid manual labels and indices cannot overwrite or persist a partial correction', async () => {
  let writes = 0;
  const model = await Decisions.create(imported(), options({ getItem() { return null; }, setItem() { writes++; } }));
  const first = model.setManualId(0, 'MYODAU');
  for (const label of [null, undefined, false, 0, {}, [], '', '   ', '\tPIPPIP', 'PIP\nPIP', 'MYO\rDAS', 'x\u0000y', 'x\u007fy', 'x\u0085y', 'x\u2028y', 'x\u2029y']) {
    assert.throws(() => model.setManualId(0, label), /identification manuelle/);
    assert.equal(model.get(0), first);
  }
  for (const index of [-1, 2, 0.5, '0', null]) {
    assert.throws(() => model.setManualId(index, 'MYODAU'), /numéro du contact/);
  }
  assert.equal(writes, 1);
});

test('batch decisions replace opposite choices, deduplicate indices, and persist one complete snapshot', async () => {
  const storage = memoryStorage();
  const writes = [];
  const write = storage.setItem;
  storage.setItem = (key, value) => { writes.push(JSON.parse(value)); write(key, value); };
  const model = await Decisions.create(imported(), options(storage));
  model.set(0, 'invalidated');
  writes.length = 0;
  const result = model.setMany([1, 0, 1, 0], 'validated');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.every(Object.isFrozen), true);
  assert.deepEqual(result.map(item => item.recordIndex), [1, 0]);
  assert.equal(model.get(0).status, 'validated');
  assert.equal(model.get(1).status, 'validated');
  assert.equal(result[0].updatedAt, result[1].updatedAt);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], model.snapshot());
  const restored = await Decisions.create(imported(), options(storage));
  assert.deepEqual(restored.snapshot(), model.snapshot());
});

test('a malformed batch or status cannot partially replace choices or write persistence', async () => {
  let writes = 0;
  const model = await Decisions.create(imported(), options({ getItem() { return null; }, setItem() { writes++; } }));
  model.set(0, 'invalidated');
  const before = model.snapshot();
  writes = 0;
  for (const indices of [null, {}, new Set([0, 1]), '0,1', [0, 2], [1, -1], [0, '1'], [0, 0.5], [0, null], Array(2), [0, , 1]]) {
    assert.throws(() => model.setMany(indices, 'validated'), /liste complète|numéro du contact/);
    assert.deepEqual(model.snapshot(), before);
  }
  for (const status of [null, true, 'pending', 'VALIDATED']) {
    assert.throws(() => model.setMany([1, 0], status), /valider ou d’invalider/);
    assert.deepEqual(model.snapshot(), before);
  }
  assert.equal(writes, 0);
});

test('empty and unchanged batches keep selections and timestamps without extra writes', async () => {
  let writes = 0;
  const model = await Decisions.create(imported(), options({ getItem() { return null; }, setItem() { writes++; } }));
  const first = model.setMany([0, 1], 'validated');
  assert.equal(writes, 1);
  const repeated = model.setMany([1, 0, 1], 'validated');
  assert.equal(repeated[0], first[1]);
  assert.equal(repeated[1], first[0]);
  assert.deepEqual(model.setMany([], 'invalidated'), []);
  assert.equal(Object.isFrozen(model.setMany([], 'validated')), true);
  assert.equal(writes, 1);
});

test('a failed batch persistence write still applies all session decisions once', async () => {
  let writes = 0;
  const model = await Decisions.create(imported(), options({ getItem() { return null; }, setItem() { writes++; throw Error('quota'); } }));
  const result = model.setMany([1, 0], 'invalidated');
  assert.equal(writes, 1);
  assert.equal(model.persistenceAvailable, false);
  assert.equal(result.length, 2);
  assert.equal(model.get(0).status, 'invalidated');
  assert.equal(model.get(1).status, 'invalidated');
  model.setMany([0, 1], 'validated');
  assert.equal(writes, 1);
  assert.equal(model.snapshot().decisions.every(item => item.validated), true);
});

test('identical source files restore decisions after a new model is created', async () => {
  const storage = memoryStorage();
  const first = await Decisions.create(imported(), options(storage));
  first.set(0, 'validated');
  first.set(1, 'invalidated');
  assert.equal(first.persistenceAvailable, true);
  const second = await Decisions.create(imported(), options(storage));
  assert.deepEqual(second.snapshot(), first.snapshot());
  assert.match(second.snapshot().fileId, /^[a-f0-9]{64}$/);
});

test('manual corrections and accepted aliases are restored as immutable decisions', async () => {
  const storage = memoryStorage();
  const first = await Decisions.create(imported(), options(storage));
  first.setManualId(0, 'Pipistrelle commune');
  first.setManualId(1, 'Noise');
  const second = await Decisions.create(imported(), options(storage));
  assert.deepEqual(second.snapshot(), first.snapshot());
  assert.equal(second.get(0).manualId, 'Pipistrelle commune');
  assert.equal(second.get(1).manualId, 'Noise');
  assert.equal(Object.isFrozen(second.get(1)), true);
  const copy = second.snapshot();
  copy.decisions[1].manualId = 'MYODAS';
  assert.equal(second.get(1).manualId, 'Noise');
});

test('version 1 binary reviews migrate accepted AUTO IDs and retain unresolved rejections', async () => {
  const storage = memoryStorage();
  const first = await Decisions.create(imported(), options(storage));
  first.set(0, 'validated');
  first.set(1, 'invalidated');
  const key = [...storage.values.keys()][0];
  const legacy = first.snapshot();
  for (const item of legacy.decisions) delete item.manualId;
  storage.values.set(key, JSON.stringify(legacy));
  const second = await Decisions.create(imported(), options(storage));
  assert.equal(second.get(0).manualId, 'PIPPIP');
  assert.equal(second.get(1).manualId, null);
  assert.equal(second.get(1).status, 'invalidated');
  assert.deepEqual(second.snapshot(), first.snapshot());
});

test('multiline AUTO names produce usable manual IDs without changing source or suggested labels', async () => {
  const storage = memoryStorage();
  const source = { fileName: 'multiline.csv', headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO'],
    records: [['x.wav', '  Pipistrellus\n\tpipistrellus  ', '.9']] };
  const before = structuredClone(source);
  const first = await Decisions.create(source, options(storage));
  const accepted = first.set(0, 'validated');
  assert.equal(accepted.manualId, 'Pipistrellus pipistrellus');
  assert.equal(accepted.sourceAutoId, source.records[0][1]);
  assert.equal(accepted.suggestedId, 'Pipistrellus\n\tpipistrellus');
  const plan = Workflow.build(source, first);
  assert.equal(plan.ready, true);
  assert.equal(plan.assignmentReady, true);
  assert.equal(plan.groups[0].mode, 'auto');
  const second = await Decisions.create(source, options(storage));
  assert.deepEqual(second.snapshot(), first.snapshot());
  assert.equal(Workflow.build(source, second).assignmentReady, true);
  assert.deepEqual(source, before);
  const key = [...storage.values.keys()][0];
  const legacy = first.snapshot();
  delete legacy.decisions[0].manualId;
  storage.values.set(key, JSON.stringify(legacy));
  const migrated = await Decisions.create(source, options(storage));
  assert.equal(migrated.get(0).manualId, 'Pipistrellus pipistrellus');
  assert.equal(Workflow.build(source, migrated).assignmentReady, true);
  const unknown = await Decisions.create({ ...source, records: [['x.wav', 'CUSTOM\n\tTAXON', '.9']] }, options(memoryStorage()));
  assert.equal(unknown.setManualId(0, 'custom  taxon').status, 'validated');
});

test('non-whitespace source controls remain unresolved and cannot restore forged manual labels', async () => {
  const storage = memoryStorage();
  const source = { fileName: 'control.csv', headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO'],
    records: [['x.wav', 'PIP\u0000PIP', '.9']] };
  const first = await Decisions.create(source, options(storage));
  const accepted = first.set(0, 'validated');
  assert.equal(accepted.manualId, null);
  assert.equal(accepted.sourceAutoId, 'PIP\u0000PIP');
  assert.equal(accepted.suggestedId, 'PIP\u0000PIP');
  assert.equal(Workflow.build(source, first).ready, false);
  const restored = await Decisions.create(source, options(storage));
  assert.deepEqual(restored.snapshot(), first.snapshot());
  const key = [...storage.values.keys()][0];
  const legacy = first.snapshot();
  delete legacy.decisions[0].manualId;
  storage.values.set(key, JSON.stringify(legacy));
  const migrated = await Decisions.create(source, options(storage));
  assert.equal(migrated.get(0).manualId, null);
  assert.equal(Workflow.build(source, migrated).ready, false);
  const forged = first.snapshot();
  forged.decisions[0].manualId = 'PIP\u0000PIP';
  storage.values.set(key, JSON.stringify(forged));
  assert.deepEqual((await Decisions.create(source, options(storage))).snapshot().decisions, []);
  assert.throws(() => first.setManualId(0, 'PIP\u0000PIP'), /identification manuelle/);
  first.setManualId(0, 'NoID');
  assert.equal(Workflow.build(source, first).ready, true);
});

test('changed data, order, source rows, headers, filename, or sheet cannot inherit a review', async () => {
  const storage = memoryStorage();
  const first = await Decisions.create(imported(), options(storage));
  first.set(0, 'validated');
  const variants = [
    imported({ fileName: 'other.csv' }), imported({ sheetName: 'Autre feuille' }),
    imported({ sourceRows: [6, 8] }),
    imported({ records: [['same.wav', 'PIPPIP', '1', ''], imported().records[1]] }),
    imported({ records: imported().records.reverse() }),
    imported({ headers: ['File', 'AUTO-ID', 'OFFSET', 'MANUAL ID'] })
  ];
  for (const source of variants) {
    const model = await Decisions.create(source, options(storage));
    assert.equal(model.get(0), null);
    assert.notEqual(model.snapshot().fileId, first.snapshot().fileId);
  }
});

test('invalid or forged persisted records are rejected together without partially restoring a review', async () => {
  const storage = memoryStorage();
  const first = await Decisions.create(imported(), options(storage));
  first.set(0, 'validated');
  const key = [...storage.values.keys()][0];
  const original = first.snapshot();
  const invalid = [
    '{broken', null, { ...original, version: 99 }, { ...original, fileId: 'other' },
    { ...original, decisions: [{ ...original.decisions[0], sourceRow: 999 }] },
    { ...original, decisions: [{ ...original.decisions[0], sourceAutoId: 'OTHER' }] },
    { ...original, decisions: [{ ...original.decisions[0], suggestedId: 'OTHER' }] },
    { ...original, decisions: [{ ...original.decisions[0], validated: false }] },
    { ...original, decisions: [{ ...original.decisions[0], status: 'pending' }] },
    { ...original, decisions: [{ ...original.decisions[0], updatedAt: 'bad' }] },
    { ...original, decisions: [{ ...original.decisions[0], manualId: null }] },
    { ...original, decisions: [{ ...original.decisions[0], manualId: 'MYODAU' }] },
    { ...original, decisions: [{ ...original.decisions[0], manualId: '' }] },
    { ...original, decisions: [{ ...original.decisions[0], manualId: ' PIPPIP ' }] },
    { ...original, decisions: [{ ...original.decisions[0], manualId: 'PIP\nPIP' }] },
    { ...original, decisions: [{ ...original.decisions[0], manualId: 123 }] },
    { ...original, decisions: [{ ...original.decisions[0], status: 'invalidated', validated: false,
      suggestedId: null, manualId: 'Pipistrelle commune' }] },
    { ...original, decisions: [original.decisions[0], { ...original.decisions[0], recordIndex: 99 }] },
    { ...original, decisions: [original.decisions[0], original.decisions[0]] }
  ];
  for (const saved of invalid) {
    storage.values.set(key, typeof saved === 'string' ? saved : JSON.stringify(saved));
    const model = await Decisions.create(imported(), options(storage));
    assert.deepEqual(model.snapshot().decisions, []);
    model.set(1, 'invalidated');
    assert.equal(model.get(1).status, 'invalidated');
  }
});

test('read or write storage failures retain session decisions and expose unavailable persistence', async () => {
  const readFailure = await Decisions.create(imported(), options({ getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } }));
  assert.equal(readFailure.persistenceAvailable, false);
  assert.equal(readFailure.set(0, 'validated').status, 'validated');
  const writeFailure = await Decisions.create(imported(), options({ getItem() { return null; }, setItem() { throw Error('quota'); } }));
  assert.equal(writeFailure.persistenceAvailable, true);
  writeFailure.set(0, 'validated');
  assert.equal(writeFailure.persistenceAvailable, false);
  assert.equal(writeFailure.set(0, 'invalidated').status, 'invalidated');
  assert.equal(writeFailure.snapshot().decisions.length, 1);
});

test('without SHA-256 or storage, no unsafe shared key is used and review remains functional', async () => {
  const storage = memoryStorage();
  for (const crypto of [null, {}, { subtle: { digest: async () => { throw Error('disabled'); } } },
    { subtle: { digest: async () => new ArrayBuffer(0) } }]) {
    const model = await Decisions.create(imported(), { storage, crypto });
    assert.equal(model.persistenceAvailable, false);
    assert.equal(model.snapshot().fileId, null);
    assert.equal(model.set(0, 'validated').validated, true);
  }
  assert.equal(storage.values.size, 0);
  assert.equal((await Decisions.create(imported(), options(null))).persistenceAvailable, false);
});

test('snapshots and returned decisions cannot mutate the background model or imported cells', async () => {
  const source = imported();
  const model = await Decisions.create(source, options(memoryStorage()));
  model.set(0, 'validated');
  const copy = model.snapshot();
  copy.decisions[0].status = 'invalidated';
  copy.decisions.push({ recordIndex: 1 });
  source.records[0][1] = 'MUTATED';
  assert.equal(Object.isFrozen(model.get(0)), true);
  assert.equal(model.get(0).status, 'validated');
  assert.equal(model.get(0).sourceAutoId, 'PIPPIP');
  assert.equal(model.snapshot().decisions.length, 1);
});

test('absent AUTO-ID and source row metadata stay explicit without inventing an identification', async () => {
  const model = await Decisions.create({ headers: ['File'], records: [['contact.wav']] }, options(memoryStorage()));
  assert.equal(model.set(0, 'validated').suggestedId, null);
  assert.equal(model.get(0).sourceAutoId, '');
  assert.equal(model.get(0).sourceRow, 2);
  assert.equal(model.get(0).manualId, null);
  const manual = model.setManualId(0, 'NoID');
  assert.equal(manual.status, 'invalidated');
  assert.equal(manual.manualId, 'NoID');
});

test('invalid contacts, row indices, and statuses fail clearly without saving a partial choice', async () => {
  for (const source of [null, {}, imported({ headers: [] }), imported({ records: [[]] }),
    imported({ records: [['x.wav', 'PIPPIP', undefined, '']] }), imported({ records: [Array(4)] }),
    imported({ sourceRows: [5] }), imported({ sourceRows: [0, 8] }), imported({ sourceRows: Array(2) })]) {
    await assert.rejects(Decisions.create(source, options(memoryStorage())), /contact|ligne|en-têtes|cellules/);
  }
  await assert.rejects(Decisions.create(imported(), null), /options/);
  const model = await Decisions.create(imported(), options(memoryStorage()));
  for (const index of [-1, 2, 0.5, '0', null]) {
    assert.throws(() => model.get(index), /numéro du contact/);
    assert.throws(() => model.set(index, 'validated'), /numéro du contact/);
  }
  for (const status of [null, true, 'valid', 'pending', 'VALIDATED', {}]) assert.throws(() => model.set(0, status), /valider ou d’invalider/);
  assert.deepEqual(model.snapshot().decisions, []);
});
