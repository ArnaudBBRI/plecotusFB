const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const Core = require('../core.js');
const Import = require('../file-import.js');
const Decisions = require('../contact-decisions.js');
const Workflow = require('../manual-workflow.js');
const Results = require('../results-file.js');

async function read(text, name = 'contacts.csv') {
  const bytes = Buffer.from(text, 'utf8');
  return Import.read({ name, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
}
const model = source => Decisions.create(source, { storage: null, crypto: webcrypto });
const cell = (file, index, name) => file.records[index][file.headers.indexOf(name)];

test('results CSV keeps every source row and column and distinguishes human, automatic, noise and pending outcomes', async () => {
  const headers = ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'MANUAL ID', 'NOTES'];
  const source = await read(Core.stringifyCSV(headers, [
    ['best.wav', 'PIPPIP', '.9', '10', '', 'accent é; "citation"\net seconde ligne'],
    ['automatic.wav', 'PIPPIP', '.8', '1', '', '=texte source'],
    ['imported.wav', 'PIPPIP', '.7', '1', 'PIPPIP', 'identification importée'],
    ['noise.wav', 'Noise', '1', '1', '', 'bruit'],
    ['unknown.wav', 'NoID', '.5', '1', '', 'en attente']
  ], ';'));
  const before = structuredClone(source);
  const choices = await model(source);
  choices.set(0, 'validated');
  const saved = Results.build(source, Workflow.build(source, choices), choices.snapshot());
  const reloaded = await read(saved.text, saved.fileName);

  assert.equal(saved.fileName, 'contacts_resultats.csv');
  assert.equal(saved.text.charCodeAt(0), 0xfeff);
  assert.equal(reloaded.delimiter, ';');
  assert.deepEqual(reloaded.headers.slice(0, headers.length), headers);
  assert.equal(reloaded.records.length, source.records.length);
  for (let index = 0; index < source.records.length; index++) {
    for (let column = 0; column < headers.length; column++) {
      if (index === 0 && headers[column] === 'MANUAL ID') continue;
      assert.equal(reloaded.records[index][column], source.records[index][column]);
    }
  }
  assert.equal(cell(reloaded, 0, 'MANUAL ID'), 'PIPPIP');
  assert.deepEqual(reloaded.records.map((_, index) => cell(reloaded, index, Results.ORIGIN_HEADER)),
    ['reviewed', 'direct', 'sourceManual', 'noise', 'unassigned'].map(key => Results.ORIGINS[key]));
  assert.equal(saved.counts.reviewed, 1);
  assert.equal(saved.counts.direct, 1);
  assert.equal(saved.counts.sourceManual, 1);
  assert.deepEqual(source, before, 'saving must leave imported source cells intact');
});

test('portable results restore reviewed contacts while calculated IDs are cleared and recomputed', async () => {
  const source = await read(Core.stringifyCSV(['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'MANUAL ID'], [
    ['best.wav', 'PIPPIP', '.9', '10', ''],
    ['other.wav', 'PIPPIP', '.8', '1', ''],
    ['source-manual.wav', 'PIPPIP', '.7', '1', 'PIPPIP']
  ]));
  const choices = await model(source);
  choices.set(0, 'validated');
  const saved = Results.build(source, Workflow.build(source, choices), choices.snapshot());
  const loaded = await read(saved.text, saved.fileName);
  const before = structuredClone(loaded);
  const resume = Results.prepareResume(loaded);
  const restored = await model(resume.imported);

  assert.deepEqual(resume.entries, [{ recordIndex: 0, manualId: 'PIPPIP' }]);
  assert.equal(cell(resume.imported, 0, 'MANUAL ID'), '');
  assert.equal(cell(resume.imported, 2, 'MANUAL ID'), 'PIPPIP', 'original manual IDs remain source IDs');
  assert.ok(resume.imported.records.every((_, index) => cell(resume.imported, index, 'SEMIMANUAL ID') === ''));
  assert.deepEqual(Results.applyResume(restored, resume), { restored: 1, fromBrowser: false });
  assert.equal(restored.get(0).status, 'validated');
  assert.equal(restored.get(1), null, 'calculated labels must never become human decisions');
  const rebuilt = Workflow.build(resume.imported, restored);
  assert.equal(rebuilt.groups[0].mode, 'auto');
  assert.deepEqual(rebuilt.processed.records.map((_, index) => cell(rebuilt.processed, index, 'SEMIMANUAL ID')),
    ['PIPPIP', 'PIPPIP', 'PIPPIP']);
  assert.deepEqual(loaded, before);
});

test('a pending invalidation and a corrected identification survive CSV save and reload separately', async () => {
  const source = await read(Core.stringifyCSV(['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual'], [
    ['pending.wav', 'NYCNOC', '.9', '10'],
    ['corrected.wav', 'PIPPIP', '.8', '1']
  ], '\t'));
  const choices = await model(source);
  choices.set(0, 'invalidated');
  choices.setManualId(1, 'MYODAU');
  const saved = Results.build(source, Workflow.build(source, choices), choices.snapshot());
  const loaded = await read(saved.text, saved.fileName);
  const resume = Results.prepareResume(loaded);
  const restored = await model(resume.imported);

  assert.equal(loaded.delimiter, '\t');
  assert.equal(cell(loaded, 0, Results.ORIGIN_HEADER), Results.ORIGINS.pendingIdentification);
  assert.equal(cell(loaded, 1, Results.ORIGIN_HEADER), Results.ORIGINS.reviewed);
  assert.deepEqual(resume.pending, [0]);
  assert.deepEqual(resume.entries, [{ recordIndex: 1, manualId: 'MYODAU' }]);
  assert.deepEqual(Results.applyResume(restored, resume), { restored: 2, fromBrowser: false });
  assert.equal(restored.get(0).status, 'invalidated');
  assert.equal(restored.get(0).manualId, null);
  assert.equal(restored.get(1).status, 'invalidated');
  assert.equal(restored.get(1).manualId, 'MYODAU');
  assert.equal(Workflow.build(resume.imported, restored).ready, false, 'the pending identification remains incomplete');
});

test('a result file never overwrites more recent decisions already stored in this browser', async () => {
  const source = await read('IN FILE,AUTO-ID,MATCH RATIO\na.wav,PIPPIP,.9\n');
  const choices = await model(source);
  choices.set(0, 'validated');
  const saved = Results.build(source, Workflow.build(source, choices), choices.snapshot());
  const resume = Results.prepareResume(await read(saved.text, saved.fileName));
  const continued = await model(resume.imported);
  continued.setManualId(0, 'MYODAU');
  assert.deepEqual(Results.applyResume(continued, resume), { restored: 0, fromBrowser: true });
  assert.equal(continued.get(0).manualId, 'MYODAU');
});

test('saving and resuming a completed sample preserves required contacts and its proportional allocation', async () => {
  const source = await read('\n\n' + Core.stringifyCSV(['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'MANUAL ID'],
    Array.from({ length: 20 }, (_, index) => ['contact-' + index + '.wav', 'NYCNOC', '.9', String(100 - index), ''])));
  const choices = await model(source);
  choices.set(0, 'validated');
  const initial = Workflow.build(source, choices);
  choices.setMany(initial.requiredIndices, 'validated');
  choices.setManualId(initial.requiredIndices[0], 'MYODAU');
  const completed = Workflow.build(source, choices);
  assert.equal(completed.assignmentReady, true);
  assert.equal(completed.proportionalAssignments.length, 16);

  const saved = Results.build(source, completed, choices.snapshot());
  const resume = Results.prepareResume(await read(saved.text, saved.fileName));
  assert.notDeepEqual(resume.imported.sourceRows, source.sourceRows,
    'CSV export removes the initial empty lines, changing physical source rows');
  const restored = await model(resume.imported);
  Results.applyResume(restored, resume);
  const rebuilt = Workflow.build(resume.imported, restored);

  assert.deepEqual(rebuilt.requiredIndices, completed.requiredIndices,
    'CSV-generated columns must not reshuffle the mandatory sample');
  assert.equal(rebuilt.remaining, 0);
  assert.equal(rebuilt.assignmentReady, true);
  assert.deepEqual(rebuilt.proportionalAssignments.map(item => item.label).sort(),
    completed.proportionalAssignments.map(item => item.label).sort());
});

test('resuming with custom ranking retains the chosen reference and completed verification gate', async () => {
  const source = await read(Core.stringifyCSV(['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'MANUAL ID'],
    Array.from({ length: 6 }, (_, index) => ['contact-' + index + '.wav', 'NYCNOC',
      index === 0 ? '.9' : '.8', index === 1 ? '100' : String(10 - index), ''])));
  const options = { settings: { ranking: [{ key: 'qual', direction: 'desc' }] } };
  const choices = await model(source);
  const initial = Workflow.build(source, choices, options);
  assert.equal(initial.groups[0].best.recordIndex, 1);
  choices.set(1, 'validated');
  choices.setMany(initial.requiredIndices, 'validated');
  const completed = Workflow.build(source, choices, options);
  assert.equal(completed.ready, true);
  assert.equal(completed.assignmentReady, true);

  const saved = Results.build(source, completed, choices.snapshot());
  const resume = Results.prepareResume(await read(saved.text, saved.fileName));
  const restored = await model(resume.imported);
  Results.applyResume(restored, resume);
  const rebuilt = Workflow.build(resume.imported, restored, options);
  assert.equal(rebuilt.groups[0].best.recordIndex, 1);
  assert.deepEqual(rebuilt.requiredIndices, completed.requiredIndices);
  assert.deepEqual(rebuilt.pendingBestIndices, []);
  assert.equal(rebuilt.ready, true);
  assert.equal(rebuilt.assignmentReady, true);
});
