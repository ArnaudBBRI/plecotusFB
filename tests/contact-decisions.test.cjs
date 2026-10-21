const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const Decisions = require('../contact-decisions.js');

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
  assert.equal(validated.sourceAutoId, 'PIPPIP');
  assert.equal(validated.sourceRow, 5);
  assert.equal(model.set(0, 'validated'), validated);
  const invalidated = model.set(0, 'invalidated');
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.validated, false);
  assert.equal(invalidated.suggestedId, null);
  assert.equal(model.get(0), invalidated);
  assert.equal(model.snapshot().decisions.length, 1);
  assert.deepEqual(source, before);
  assert.equal(model.set(0, 'validated').status, 'validated');
});

test('contacts sharing a WAV keep independent decisions by original record and physical row', async () => {
  const model = await Decisions.create(imported(), options(memoryStorage()));
  model.set(1, 'invalidated');
  model.set(0, 'validated');
  assert.equal(model.get(0).status, 'validated');
  assert.equal(model.get(1).status, 'invalidated');
  assert.equal(model.get(1).sourceRow, 8);
  assert.deepEqual(model.snapshot().decisions.map(item => item.recordIndex), [0, 1]);
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
