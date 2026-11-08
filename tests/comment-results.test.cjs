const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Import = require('../file-import.js');
const Workflow = require('../manual-workflow.js');
const Results = require('../results-file.js');
const Decisions = require('../contact-decisions.js');
const { webcrypto } = require('node:crypto');

const COMMENT_HEADER = 'COMMENTAIRE PLECOTUS';
async function read(text, name = 'contacts.csv') {
  const bytes = Buffer.from(text, 'utf8');
  return Import.read({ name, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
}
async function source(extraHeaders = [], extraCells = []) {
  return read(Core.stringifyCSV(['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'NOTES', ...extraHeaders],
    Array.from({ length: 4 }, (_, index) => ['contact-' + index + '.wav', 'NYCNOC', '.9', String(10 - index),
      'Note source ' + index, ...(extraCells[index] || [])]), ';'));
}
const cell = (file, index, header) => file.records[index][file.headers.indexOf(header)];

test('CSV comments survive multiline quoting independently of validated, corrected, unresolved and untouched contacts', async () => {
  const imported = await source();
  const before = structuredClone(imported);
  const snapshot = { version: 1, decisions: [
    { recordIndex: 0, status: 'validated', manualId: 'NYCNOC' },
    { recordIndex: 1, status: 'invalidated', manualId: 'MYODAU' },
    { recordIndex: 2, status: 'unresolved', manualId: null }
  ], comments: [
    { recordIndex: 0, text: 'Contact confirmé : plusieurs séquences.' },
    { recordIndex: 1, text: 'Autre espèce; "écoute"\nSeconde ligne é.' },
    { recordIndex: 2, text: 'À reprendre après comparaison.' },
    { recordIndex: 3, text: '=texte libre, sans décision' }
  ] };
  const plan = Workflow.build(imported, snapshot);
  const saved = Results.build(imported, plan, snapshot);
  const loaded = await read(saved.text, saved.fileName);

  assert.ok(loaded.headers.includes(COMMENT_HEADER));
  assert.deepEqual(loaded.records.map((_, index) => cell(loaded, index, COMMENT_HEADER)),
    ['Contact confirmé : plusieurs séquences.', 'Autre espèce; "écoute"\nSeconde ligne é.',
      'À reprendre après comparaison.', '=texte libre, sans décision']);
  assert.deepEqual(loaded.records.map((_, index) => cell(loaded, index, 'NOTES')),
    ['Note source 0', 'Note source 1', 'Note source 2', 'Note source 3']);
  assert.equal(cell(loaded, 2, 'MANUAL ID'), '');
  assert.equal(cell(loaded, 2, 'SEMIMANUAL ID'), '');
  assert.equal(cell(loaded, 2, Results.ORIGIN_HEADER), Results.ORIGINS.unresolved);
  assert.equal(cell(loaded, 3, 'MANUAL ID'), '', 'a comment alone does not create a manual decision');
  assert.equal(cell(loaded, 3, Results.ORIGIN_HEADER), Results.ORIGINS.unassigned);
  assert.deepEqual(imported, before);
});

test('an authoritative comment snapshot clears imported comments omitted from the snapshot', async () => {
  const imported = await source([COMMENT_HEADER], [['à effacer'], ['ancien texte'], [''], ['']]);
  const before = structuredClone(imported);
  const snapshot = { decisions: [], comments: [{ recordIndex: 1, text: 'texte corrigé' }] };
  const saved = Results.build(imported, Workflow.build(imported, snapshot), snapshot);
  assert.deepEqual(saved.records.map((_, index) => cell(saved, index, COMMENT_HEADER)), ['', 'texte corrigé', '', '']);
  assert.deepEqual(imported, before);
});

test('legacy snapshots preserve source comments and old comment-free files keep their headers', async () => {
  const imported = await source([COMMENT_HEADER], [['ancien\ncommentaire'], [''], ['deuxième'], ['']]);
  const legacy = { version: 1, decisions: [] };
  const saved = Results.build(imported, Workflow.build(imported, legacy), legacy);
  assert.deepEqual(saved.records.map((_, index) => cell(saved, index, COMMENT_HEADER)), ['ancien\ncommentaire', '', 'deuxième', '']);
  const oldSource = await source();
  const oldExport = Results.build(oldSource, Workflow.build(oldSource, legacy), legacy);
  assert.equal(oldExport.headers.includes(COMMENT_HEADER), false);
  const emptyComments = { decisions: [], comments: [] };
  assert.equal(Results.build(oldSource, Workflow.build(oldSource, emptyComments), emptyComments)
    .headers.includes(COMMENT_HEADER), false);
});

test('repeated result exports reuse the comment column and prepareResume keeps its cells intact', async () => {
  const imported = await source(['Commentaire Plecotus'], [['original'], [''], [''], ['']]);
  const snapshot = { decisions: [], comments: [{ recordIndex: 0, text: 'nouveau\ncommentaire' }] };
  const first = Results.build(imported, Workflow.build(imported, snapshot), snapshot);
  const loaded = await read(first.text, first.fileName);
  const resume = Results.prepareResume(loaded);
  const second = Results.build(resume.imported, Workflow.build(resume.imported, snapshot), snapshot);
  assert.equal(second.headers.filter(header => header.toUpperCase().replace(/[^A-Z0-9]/g, '') === 'COMMENTAIREPLECOTUS').length, 1);
  const index = second.headers.findIndex(header => header.toUpperCase().replace(/[^A-Z0-9]/g, '') === 'COMMENTAIREPLECOTUS');
  assert.equal(resume.imported.records[0][index], 'nouveau\ncommentaire');
  assert.equal(second.records[0][index], 'nouveau\ncommentaire');
});

test('comments and their decision states round-trip through the actual contact model', async () => {
  const imported = await source();
  const choices = await Decisions.create(imported, { storage: null, crypto: webcrypto });
  choices.set(0, 'validated');
  choices.setManualId(1, 'MYODAU');
  choices.set(2, 'unresolved');
  choices.setComment(0, '  Note confirmée\t ');
  choices.setComment(1, 'Autre espèce; "écoute"\r\nÀ comparer.');
  choices.setComment(2, 'À revoir.');
  choices.setComment(3, 'Commentaire sans décision.');
  const saved = Results.build(imported, Workflow.build(imported, choices), choices.snapshot());
  const resume = Results.prepareResume(await read(saved.text, saved.fileName));
  const restored = await Decisions.create(resume.imported, { storage: null, crypto: webcrypto });
  Results.applyResume(restored, resume);
  assert.deepEqual([0, 1, 2, 3].map(index => restored.getComment(index)),
    ['  Note confirmée\t ', 'Autre espèce; "écoute"\r\nÀ comparer.', 'À revoir.', 'Commentaire sans décision.']);
  assert.deepEqual([0, 1, 2, 3].map(index => restored.get(index)?.status || null),
    ['validated', 'invalidated', 'unresolved', null]);
  assert.equal(restored.get(1).manualId, 'MYODAU');
});

test('CSV decision restoration preserves newer comments when the browser has no decisions yet', async () => {
  const imported = await source();
  const snapshot = { decisions: [{ recordIndex: 0, status: 'validated', manualId: 'NYCNOC' }],
    comments: [{ recordIndex: 0, text: 'ancien commentaire' }] };
  const saved = Results.build(imported, Workflow.build(imported, snapshot), snapshot);
  const resume = Results.prepareResume(await read(saved.text, saved.fileName));
  const restored = await Decisions.create(resume.imported, { storage: null, crypto: webcrypto });
  assert.deepEqual(restored.snapshot().decisions, []);
  restored.setComment(0, 'commentaire plus récent');
  restored.setComment(3, 'note supplémentaire');
  Results.applyResume(restored, resume);
  assert.equal(restored.get(0).status, 'validated');
  assert.equal(restored.getComment(0), 'commentaire plus récent');
  assert.equal(restored.getComment(3), 'note supplémentaire');
});

test('clearing an imported comment through the model is retained on subsequent export', async () => {
  const imported = await source([COMMENT_HEADER], [['commentaire à effacer'], [''], [''], ['']]);
  const choices = await Decisions.create(imported, { storage: null, crypto: webcrypto });
  assert.equal(choices.getComment(0), 'commentaire à effacer');
  choices.setComment(0, '');
  const saved = Results.build(imported, Workflow.build(imported, choices), choices.snapshot());
  const loaded = await read(saved.text, saved.fileName);
  assert.equal(cell(loaded, 0, COMMENT_HEADER), '');
  assert.equal(imported.records[0].at(-1), 'commentaire à effacer');
});

test('adding multiline comments does not reshuffle a completed sample on CSV reload', async () => {
  const imported = await read('\n\n' + Core.stringifyCSV(['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'NOTES'],
    Array.from({ length: 20 }, (_, index) => ['sample-' + index + '.wav', 'NYCNOC', '.9', String(100 - index), 'source ' + index])));
  const choices = await Decisions.create(imported, { storage: null, crypto: webcrypto });
  choices.set(0, 'validated');
  choices.setMany(Workflow.build(imported, choices).requiredIndices, 'validated');
  const before = Workflow.build(imported, choices);
  assert.equal(before.assignmentReady, true);
  choices.setComment(0, 'Première ligne\nDeuxième ligne.');
  choices.setComment(19, 'Dernière note.');
  const saved = Results.build(imported, Workflow.build(imported, choices), choices.snapshot());
  const resume = Results.prepareResume(await read(saved.text, saved.fileName));
  const restored = await Decisions.create(resume.imported, { storage: null, crypto: webcrypto });
  Results.applyResume(restored, resume);
  const after = Workflow.build(resume.imported, restored);
  assert.deepEqual(after.requiredIndices, before.requiredIndices);
  assert.equal(after.assignmentReady, true);
  assert.equal(after.remaining, 0);
  assert.equal(restored.getComment(0), 'Première ligne\nDeuxième ligne.');
  assert.equal(restored.getComment(19), 'Dernière note.');
});
