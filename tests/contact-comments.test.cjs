const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const Decisions = require('../contact-decisions.js');
const Workflow = require('../manual-workflow.js');

function source(comments) {
  const headers = ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual'];
  const records = [['same.wav', 'NYCNOC', '.9', '10'], ['same.wav', 'NYCNOC', '.8', '9'], ['other.wav', 'NYCNOC', '.7', '8']];
  if (comments) {
    headers.push('COMMENTAIRE PLECOTUS');
    records.forEach((record, index) => record.push(comments[index] || ''));
  }
  return { fileName: 'comments.csv', headers, records, sourceRows: [3, 4, 5] };
}
function memoryStorage() {
  const values = new Map();
  let writes = 0;
  return { values, get writes() { return writes; },
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { writes++; values.set(key, value); } };
}
const create = (imported, storage = null) => Decisions.create(imported, { storage, crypto: webcrypto });

test('a comment on an unchecked contact never creates a decision or completes its required check', async () => {
  const imported = source();
  const model = await create(imported);
  assert.equal(typeof model.setComment, 'function', 'optional comments need a separate API from validation');
  assert.equal(typeof model.getComment, 'function');
  const before = Workflow.build(imported, model);
  assert.equal(model.getComment(0), '');
  assert.equal(model.setComment(0, 'Signal à écouter une seconde fois'), 'Signal à écouter une seconde fois');
  assert.equal(model.get(0), null);
  assert.deepEqual(model.snapshot().decisions, []);
  assert.deepEqual(model.snapshot().comments, [{ recordIndex: 0, text: 'Signal à écouter une seconde fois' }]);
  const after = Workflow.build(imported, model);
  assert.equal(after.ready, before.ready);
  assert.equal(after.assignmentReady, before.assignmentReady);
  assert.deepEqual(after.pendingBestIndices, before.pendingBestIndices);
});

test('comments preserve multiline text, whitespace and long observations exactly by source record', async () => {
  const imported = source();
  const before = structuredClone(imported);
  const model = await create(imported);
  const text = '  Écoute : "faible"\r\n\tAutre passage, même WAV.\n' + 'é'.repeat(20000) + '  ';
  model.setComment(1, text);
  model.setComment(0, ' \t ');
  assert.equal(model.getComment(1), text);
  assert.equal(model.getComment(0), ' \t ');
  assert.equal(model.getComment(2), '');
  assert.deepEqual(model.snapshot().comments, [{ recordIndex: 0, text: ' \t ' }, { recordIndex: 1, text }]);
  const snapshot = model.snapshot();
  snapshot.comments[0].text = 'modifié';
  snapshot.comments.push({ recordIndex: 2, text: 'injecté' });
  assert.equal(model.getComment(0), ' \t ');
  assert.equal(model.getComment(2), '');
  assert.deepEqual(imported, before);
});

test('validation, corrections, deferred outcomes and comment clearing leave each other independent', async () => {
  const model = await create(source());
  model.setComment(0, 'Écoute à compléter');
  for (const status of ['validated', 'invalidated', 'unresolved']) {
    model.set(0, status);
    assert.equal(model.getComment(0), 'Écoute à compléter');
  }
  model.setManualId(0, 'MYODAU');
  assert.equal(model.getComment(0), 'Écoute à compléter');
  const corrected = model.get(0);
  model.setComment(0, 'Après seconde écoute');
  assert.equal(model.get(0), corrected);
  assert.equal(model.setComment(0, ''), '');
  assert.equal(model.getComment(0), '');
  assert.deepEqual(model.snapshot().comments, []);
  assert.equal(model.get(0), corrected);
});

test('comments hydrate from one recognized source column without changing source cells', async () => {
  const imported = source(['  commentaire source\nligne 2  ', '', 'autre']);
  imported.headers[4] = 'Commentaire_Plecotus';
  const before = structuredClone(imported);
  const model = await create(imported);
  assert.equal(model.getComment(0), '  commentaire source\nligne 2  ');
  assert.equal(model.getComment(1), '');
  assert.equal(model.getComment(2), 'autre');
  model.setComment(0, 'Remplacé');
  assert.deepEqual(imported, before);
  assert.deepEqual(model.snapshot().decisions, []);
});

test('persisted comments restore with decisions while clearing a source comment remains authoritative after reload', async () => {
  const imported = source(['original', 'second', '']);
  const storage = memoryStorage();
  const first = await create(imported, storage);
  first.setComment(0, '');
  first.setComment(1, 'révisé\navec accents');
  first.set(2, 'validated');
  const restored = await create(imported, storage);
  assert.equal(restored.getComment(0), '');
  assert.equal(restored.getComment(1), 'révisé\navec accents');
  assert.equal(restored.get(2).status, 'validated');
  assert.deepEqual(restored.snapshot(), first.snapshot());
  const emptySource = source(['original', '', '']);
  const onlyClearStorage = memoryStorage();
  const clear = await create(emptySource, onlyClearStorage);
  clear.setComment(0, '');
  assert.equal((await create(emptySource, onlyClearStorage)).getComment(0), '', 'a saved empty map must clear imported comments');
});

test('old v1 snapshots without a comments field retain imported comments and valid decisions', async () => {
  const imported = source(['source conservée', '', '']);
  const storage = memoryStorage();
  const first = await create(imported, storage);
  first.set(0, 'validated');
  const key = [...storage.values.keys()][0];
  const legacy = first.snapshot();
  delete legacy.comments;
  storage.values.set(key, JSON.stringify(legacy));
  const restored = await create(imported, storage);
  assert.equal(restored.snapshot().version, 1);
  assert.equal(restored.get(0).status, 'validated');
  assert.equal(restored.getComment(0), 'source conservée');
});

test('invalid comment payloads do not discard valid saved decisions or partially replace imported comments', async () => {
  const imported = source(['original', 'deuxième', '']);
  const storage = memoryStorage();
  const first = await create(imported, storage);
  first.set(0, 'validated');
  const key = [...storage.values.keys()][0];
  const saved = first.snapshot();
  const invalid = [null, {}, 'commentaire', [null], [{ recordIndex: 1, text: 3 }],
    [{ recordIndex: 3, text: 'hors fichier' }], [{ recordIndex: '1', text: 'mauvais index' }],
    [{ recordIndex: 0, text: 'premier' }, { recordIndex: 0, text: 'doublon' }],
    [{ recordIndex: 0, text: 'révision valide' }, { recordIndex: 1, text: 'nul\u0000' }]];
  for (const comments of invalid) {
    storage.values.set(key, JSON.stringify({ ...saved, comments }));
    const restored = await create(imported, storage);
    assert.equal(restored.get(0).status, 'validated');
    assert.equal(restored.getComment(0), 'original');
    assert.equal(restored.getComment(1), 'deuxième');
  }
});

test('comment validation rejects invalid indices, types and controls without losing the previous text', async () => {
  const storage = memoryStorage();
  const model = await create(source(), storage);
  model.setComment(0, 'Observation conservée');
  const before = model.snapshot();
  const writes = storage.writes;
  for (const value of [null, undefined, 1, true, {}, [], 'a\u0000b', 'a\u0007b', 'a\u000bb', 'a\u001fb', 'a\u007fb', 'a\u0085b']) {
    assert.throws(() => model.setComment(0, value), /commentaire/i);
  }
  for (const index of [-1, 3, .5, '0', null]) {
    assert.throws(() => model.setComment(index, 'texte'), /numéro du contact/);
    assert.throws(() => model.getComment(index), /numéro du contact/);
  }
  assert.deepEqual(model.snapshot(), before);
  assert.equal(storage.writes, writes);
});

test('source comment headers must be unambiguous and invalid imported comment controls are reported', async () => {
  const ambiguous = source(['a', '', '']);
  ambiguous.headers.push('COMMENTAIRE_PLECOTUS');
  ambiguous.records.forEach(record => record.push('b'));
  await assert.rejects(create(ambiguous), /commentaire|colonne/i);
  await assert.rejects(create(source(['nul\u0000', '', ''])), /commentaire/i);
});

test('unchanged comment values do not write again and storage failures retain subsequent session edits', async () => {
  const storage = memoryStorage();
  const model = await create(source(), storage);
  model.setComment(0, '');
  assert.equal(storage.writes, 0);
  model.setComment(0, 'première version');
  model.setComment(0, 'première version');
  assert.equal(storage.writes, 1);
  const blocked = await create(source(), { getItem: () => null, setItem() { throw Error('quota'); } });
  assert.equal(blocked.persistenceAvailable, true);
  blocked.setComment(0, 'Préservé malgré le quota');
  assert.equal(blocked.persistenceAvailable, false);
  blocked.setComment(0, 'Deuxième texte conservé');
  assert.equal(blocked.getComment(0), 'Deuxième texte conservé');
  assert.deepEqual(blocked.snapshot().decisions, []);
});
