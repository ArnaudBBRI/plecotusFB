const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const Import = require('../file-import.js');
const Best = require('../best-contacts.js');
const Workflow = require('../manual-workflow.js');
const Decisions = require('../contact-decisions.js');
const Results = require('../results-file.js');

async function read(text, name = 'contacts_resultats.csv') {
  const bytes = Buffer.from(text, 'utf8');
  return Import.read({ name, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
}
const model = imported => Decisions.create(imported, { storage: null, crypto: webcrypto });
const options = { settings: { ranking: [{ key: 'dateValue', direction: 'asc' }, { key: 'timeValue', direction: 'asc' }] } };

for (const [calendar, serial, expectedDate] of [['1900', 46023, '2026-01-01'], ['1904', 0, '1904-01-01']]) {
  test('Excel ' + calendar + ' date/time ranking and completed samples survive portable CSV results without altering source cells', async () => {
    const source = { fileName: 'contacts.xlsx', sheetName: 'Contacts', excelDate1904: calendar === '1904',
      headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'DATE', 'TIME', 'MANUAL ID'],
      records: Array.from({ length: 20 }, (_, index) => [
        'contact-' + index + '.wav', 'NYCNOC', '.9', '5',
        String(index === 1 || index === 2 ? serial : serial + 1), index === 2 ? '.25' : '.75', ''
      ]), sourceRows: Array.from({ length: 20 }, (_, index) => index + 8) };
    const original = structuredClone(source);
    const choices = await model(source);
    const first = Workflow.build(source, choices, options);
    assert.equal(first.groups[0].best.recordIndex, 2);
    assert.equal(first.groups[0].best.date, expectedDate);
    assert.equal(first.groups[0].best.time, '06:00:00');
    choices.set(2, 'validated');
    choices.setMany(first.requiredIndices, 'validated');
    choices.setManualId(first.requiredIndices[0], 'MYODAU');
    const completed = Workflow.build(source, choices, options);
    assert.equal(completed.ready, true);
    assert.equal(completed.assignmentReady, true);
    const saved = Results.build(source, completed, choices.snapshot());
    const loaded = await read(saved.text, saved.fileName);
    const calendarIndex = loaded.headers.indexOf(Results.CALENDAR_HEADER);
    assert(calendarIndex >= 0);
    assert(loaded.records.every(record => record[calendarIndex] === calendar));
    assert.notDeepEqual(loaded.sourceRows, source.sourceRows);
    for (let index = 0; index < source.records.length; index++) {
      assert.equal(loaded.records[index][4], source.records[index][4], 'DATE serial stays intact');
      assert.equal(loaded.records[index][5], source.records[index][5], 'TIME serial stays intact');
    }

    const loadedOriginal = structuredClone(loaded);
    const resume = Results.prepareResume(loaded);
    assert.equal(resume.imported.excelDates, true);
    assert.equal(resume.imported.excelDate1904, calendar === '1904');
    const restored = await model(resume.imported);
    Results.applyResume(restored, resume);
    const after = Workflow.build(resume.imported, restored, options);
    assert.equal(after.groups[0].best.recordIndex, 2);
    assert.equal(after.groups[0].best.date, expectedDate);
    assert.equal(after.groups[0].best.time, '06:00:00');
    assert.equal(after.ready, true);
    assert.equal(after.remaining, 0);
    assert.equal(after.assignmentReady, true);
    assert.deepEqual(after.requiredIndices, completed.requiredIndices);
    assert.deepEqual(after.groups[0].contacts.map(contact => [contact.date, contact.time]),
      completed.groups[0].contacts.map(contact => [contact.date, contact.time]));
    assert.deepEqual(after.proportionalAssignments, completed.proportionalAssignments);
    const savedAgain = Results.build(resume.imported, after, restored.snapshot());
    assert.equal(savedAgain.headers.filter(header => header === Results.CALENDAR_HEADER).length, 1);
    assert(savedAgain.records.every(record => record[savedAgain.headers.indexOf(Results.CALENDAR_HEADER)] === calendar));
    assert.deepEqual(source, original);
    assert.deepEqual(loaded, loadedOriginal);
  });
}

test('ordinary CSV serial-like dates and times stay invalid, including results without explicit Excel metadata', async () => {
  const source = await read('IN FILE,AUTO-ID,MATCH RATIO,DATE,TIME\na.wav,NYCNOC,.9,46001,.75\nb.wav,NYCNOC,.9,46000,.25\n', 'contacts.csv');
  const choices = await model(source);
  choices.set(0, 'validated');
  const first = Workflow.build(source, choices, options);
  assert.equal(first.groups[0].best.recordIndex, 0, 'source order breaks ties between missing date/time values');
  assert.equal(first.groups[0].best.dateValue, null);
  assert.equal(first.groups[0].best.timeValue, null);
  const saved = Results.build(source, first, choices.snapshot());
  assert.equal(saved.headers.includes(Results.CALENDAR_HEADER), false);
  const resume = Results.prepareResume(await read(saved.text));
  assert.notEqual(resume.imported.excelDates, true);
  const selected = Best.build(resume.imported, options.settings).groups[0].best;
  assert.equal(selected.recordIndex, 0);
  assert.equal(selected.dateValue, null);
  assert.equal(selected.timeValue, null);
});

test('Excel interpretation requires a results file and rejects unknown, empty, inconsistent or ambiguous calendar metadata', () => {
  const source = { headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'DATE', Results.ORIGIN_HEADER, Results.CALENDAR_HEADER],
    records: [['a.wav', 'NYCNOC', '.9', '46000', Results.ORIGINS.unassigned, '1900'],
      ['b.wav', 'NYCNOC', '.9', '46001', Results.ORIGINS.unassigned, '1900']] };
  for (const value of ['2000', '', 'Excel 1900', null]) {
    const bad = structuredClone(source);
    bad.records[0][5] = value;
    assert.throws(() => Results.prepareResume(bad), /doit contenir 1900 ou 1904/);
  }
  const mixed = structuredClone(source);
  mixed.records[1][5] = '1904';
  assert.throws(() => Results.prepareResume(mixed), /même calendrier/);
  const duplicate = structuredClone(source);
  duplicate.headers.push('CALENDRIER_EXCEL_PLECOTUS');
  duplicate.records.forEach(record => record.push('1900'));
  assert.throws(() => Results.prepareResume(duplicate), /Plusieurs colonnes CALENDRIER/);
  const ordinary = { fileName: 'contacts.csv', headers: source.headers.filter(header => header !== Results.ORIGIN_HEADER),
    records: source.records.map(record => record.filter((_, index) => index !== 4)) };
  assert.equal(Results.prepareResume(ordinary), null);
  assert.equal(Best.build(ordinary, options.settings).groups[0].best.dateValue, null);
});

test('explicit Excel metadata on an already resumed CSV is retained on repeated results saves', async () => {
  const source = { fileName: 'restored.csv', excelDates: true, excelDate1904: true,
    headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'DATE', 'TIME'],
    records: [['a.wav', 'NYCNOC', '.9', '0', '.25']] };
  const choices = await model(source);
  choices.set(0, 'validated');
  const saved = Results.build(source, Workflow.build(source, choices, options), choices.snapshot());
  const resumed = Results.prepareResume(await read(saved.text));
  assert.equal(resumed.imported.excelDate1904, true);
  assert.equal(Best.build(resumed.imported, options.settings).groups[0].best.date, '1904-01-01');
});
