const test = require('node:test');
const assert = require('node:assert/strict');
const Best = require('../best-contacts.js');
const Core = require('../core.js');
const Import = require('../file-import.js');
const fs = require('node:fs');
const path = require('node:path');

test('the review fixture selects the R-order winners and preserves original source lines', async () => {
  const content = fs.readFileSync(path.join(__dirname, 'fixtures', 'best-contacts-review.csv'));
  const imported = await Import.read({ name: 'best-contacts-review.csv', size: content.length,
    arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) });
  const result = Best.build(imported);
  const pip = result.groups.find(group => group.label === 'PIPPIP');
  const myo = result.groups.find(group => group.label === 'MYODAS');
  assert.equal(imported.summary.totalContacts, 10);
  assert.equal(result.excludedNoiseCount, 1);
  assert.equal(result.groups.length, 3);
  assert.equal(pip.best.fileName, 'pip-best.wav');
  assert.equal(pip.best.lineNumber, 8);
  assert.equal(myo.best.fileName, 'myo-best.wav');
  assert.equal(myo.best.lineNumber, 10);
  assert.equal(result.groups.find(group => group.kind === 'noid').best, null);
});

const headers = ['IN FILE', 'AUTO ID*', 'MATCH RATIO', 'Qual', 'PULSES', 'DATE', 'TIME', 'MATCHING'];
function row(name, overrides = {}) {
  const values = { 'IN FILE': name, 'AUTO ID*': 'PIPPIP', 'MATCH RATIO': '.8', Qual: '5', PULSES: '10', DATE: '2026-01-01', TIME: '22:00:00', MATCHING: '2', ...overrides };
  return headers.map(header => values[header]);
}
function input(records, extra = {}) { return { headers, records, ...extra }; }
function winner(records) { return Best.build(input(records)).groups[0].best.fileName; }

test('MATCH RATIO outranks all later criteria without deriving a replacement score', () => {
  assert.equal(winner([
    row('low.wav', { 'MATCH RATIO': '.7', Qual: '100', PULSES: '1000', DATE: '2025-01-01', MATCHING: '999' }),
    row('best.wav', { 'MATCH RATIO': '.9', Qual: '0', PULSES: '0', DATE: '2026-12-01', MATCHING: '0' })
  ]), 'best.wav');
});

test('Qual then PULSES break ties in that exact priority order', () => {
  assert.equal(winner([row('many.wav', { Qual: '4', PULSES: '1000' }), row('quality.wav', { Qual: '5', PULSES: '1' })]), 'quality.wav');
  assert.equal(winner([row('few.wav', { PULSES: '2', MATCHING: '100' }), row('many.wav', { PULSES: '3', MATCHING: '0' })]), 'many.wav');
});

test('earliest date then earliest time decide otherwise equal candidates', () => {
  assert.equal(winner([row('late.wav', { DATE: '2026-02-01', TIME: '01:00:00' }), row('early.wav', { DATE: '2026-01-01', TIME: '23:00:00' })]), 'early.wav');
  assert.equal(winner([row('late.wav', { TIME: '22:01:00' }), row('early.wav', { TIME: '22:00:59' })]), 'early.wav');
});

test('MATCHING never ranks contacts and exact ties retain source order', () => {
  const first = row('first.wav', { MATCHING: '0' });
  const second = row('second.wav', { MATCHING: '10000' });
  assert.equal(winner([first, second]), 'first.wav');
  assert.equal(winner([second, first]), 'second.wav');
});

test('numeric zero and decimal commas stay numeric while missing values sort last', () => {
  const records = [
    row('missing.wav', { 'MATCH RATIO': '', Qual: '999' }),
    row('zero.wav', { 'MATCH RATIO': '0', Qual: '0' }),
    row('comma.wav', { 'MATCH RATIO': '0,9', Qual: '0' })
  ];
  const selected = Best.build(input(records)).groups[0].best;
  assert.equal(selected.fileName, 'comma.wav');
  assert.equal(selected.ratio, .9);
  assert.equal(selected.qual, 0);
  assert.equal(winner(records.slice(0, 2)), 'zero.wav');
});

test('invalid calendar dates and times sort after valid values without changing the source', () => {
  assert.equal(winner([row('invalid.wav', { DATE: '2026-02-30' }), row('valid.wav', { DATE: '2026-03-01' })]), 'valid.wav');
  assert.equal(winner([row('invalid.wav', { TIME: '24:00:00' }), row('valid.wav', { TIME: '23:00:00' })]), 'valid.wav');
});

test('the R eligibility rule excludes a pulses-only contact but retains its group and original totals', () => {
  const missing = { 'MATCH RATIO': '', Qual: 'NA', MATCHING: '', PULSES: '999' };
  const imported = input([row('missing.wav', missing), row('eligible.wav', { 'MATCH RATIO': '', Qual: '', MATCHING: '0', PULSES: '1' })]);
  const original = structuredClone(imported);
  const result = Best.build(imported);
  assert.equal(result.groups[0].count, 2);
  assert.equal(result.groups[0].eligibleCount, 1);
  assert.equal(result.groups[0].best.fileName, 'eligible.wav');
  assert.equal(result.excludedCandidateCount, 1);
  assert.deepEqual(imported, original);
  const allMissing = Best.build(input([row('none.wav', missing)]));
  assert.equal(allMissing.groups[0].best, null);
  assert.equal(allMissing.groups[0].count, 1);
});

test('source AUTO-ID groups stay separate and Noise is excluded including manual corrections', () => {
  const imported = input([
    row('one.wav'), row('two.wav', { 'AUTO ID*': 'PIPNAT' }),
    row('alias.wav', { 'AUTO ID*': 'Pipistrellus pipistrellus' }),
    row('noise.wav', { 'AUTO ID*': ' n-o_i s e ' }),
    row('blank.wav', { 'AUTO ID*': '' }), row('noid.wav', { 'AUTO ID*': 'NoID' })
  ]);
  imported.headers = [...headers, 'MANUAL ID'];
  imported.records = imported.records.map((record, index) => [...record, index === 3 ? 'PIPPIP' : index === 0 ? 'NYCNOC' : '']);
  const result = Best.build(imported);
  assert.equal(result.excludedNoiseCount, 1);
  assert.equal(result.groups.length, 5);
  assert.equal(result.groups.reduce((sum, group) => sum + group.count, 0), 5);
  assert(result.groups.some(group => group.label === 'Sans identification automatique'));
  assert(result.groups.every(group => group.kind !== 'noise'));
});

test('a winning contact keeps its physical source row and record index after ranking', () => {
  const selected = Best.build(input([row('low.wav', { 'MATCH RATIO': '.1' }), row('high.wav', { 'MATCH RATIO': '.9' })], { sourceRows: [7, 13] })).groups[0].best;
  assert.equal(selected.recordIndex, 1);
  assert.equal(selected.lineNumber, 13);
  assert.equal(Best.build(input([row('low.wav', { 'MATCH RATIO': '.1' }), row('high.wav')])).groups[0].best.lineNumber, 3);
});

test('missing ranking columns are explicit and do not invent zero-valued criteria', () => {
  const imported = { headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO'], records: [['one.wav', 'PIPPIP', '.7']] };
  const result = Best.build(imported);
  assert.deepEqual(result.missingColumns, ['Qual', 'PULSES', 'DATE', 'TIME']);
  assert.equal(result.groups[0].best.qual, null);
  assert.equal(result.groups[0].best.pulses, null);
});

test('Excel DATE and TIME serials display and rank by the corresponding calendar values', () => {
  const imported = input([
    row('late.wav', { DATE: '46023', TIME: '.5' }),
    row('early.wav', { DATE: '46023', TIME: '.25' })
  ], { fileName: 'contacts.xlsx', sheetName: 'Contacts', sourceRows: [3, 5] });
  const selected = Best.build(imported).groups[0].best;
  assert.equal(selected.fileName, 'early.wav');
  assert.equal(selected.date, '2026-01-01');
  assert.equal(selected.time, '06:00:00');
  assert.equal(selected.lineNumber, 5);
  const date1904 = Best.build(input([row('one.wav', { DATE: '0', TIME: '0' })], { fileName: 'old.xls', excelDate1904: true })).groups[0].best;
  assert.equal(date1904.date, '1904-01-01');
  assert.equal(date1904.time, '00:00:00');
});

test('Qual spelling is normalized but ambiguous Qual columns fail clearly', () => {
  const imported = { headers: ['IN FILE', 'AUTO-ID', 'QUAL*', 'MATCHING'], records: [['one.wav', 'PIPPIP', '5', '0']] };
  assert.equal(Best.build(imported).groups[0].best.qual, 5);
  assert.throws(() => Best.build({ headers: ['IN FILE', 'AUTO-ID', 'Qual', 'QUAL*'], records: [] }), /ambiguïté/);
});

test('CSV parsing retains ranking values and tie rules for decimal-comma exports', () => {
  const parsed = Core.parseCSV('IN FILE;AUTO ID*;MATCH RATIO;Qual;PULSES;DATE;TIME;MATCHING\r\na.wav;PIPPIP;0,8;3;10;2026-10-01;23:00:00;10\r\nb.wav;PIPPIP;0,8;4;2;2026-10-02;23:00:00;1');
  assert.equal(Best.build(parsed).groups[0].best.fileName, 'b.wav');
});

test('unrelated and malformed input fail instead of silently selecting a row', () => {
  assert.throws(() => Best.build(null), TypeError);
  assert.throws(() => Best.build({ headers, records: [null] }), TypeError);
});
