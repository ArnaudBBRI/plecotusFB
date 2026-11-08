const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../core.js');
let Timeline;
try { Timeline = require('../timeline-data.js'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const TEN_MINUTES = 600000;
function input(records, extra = {}) {
  return { fileName: 'contacts.csv', headers: ['IN FILE', 'DATE', 'TIME', 'AUTO-ID', 'DATE-12'],
    records: records.map(([date, time, auto = 'PIPPIP', date12 = '1999-01-01'], index) =>
      ['contact-' + index + '.wav', date, time, auto, date12]), ...extra };
}

test('timeline uses each real source date and time across midnight, with fixed contiguous ten-minute bins', () => {
  assert.equal(typeof Timeline?.build, 'function', 'the chronological source-data module must be available');
  const source = input([['2026-09-19', '00:00:00'], ['2026-09-18', '23:59:59'],
    ['2026-09-19', '02:30:00'], ['2026-09-19', '00:01:00']]);
  const before = structuredClone(source);
  const data = Timeline.build(source);
  const start = Date.UTC(2026, 8, 18, 23, 50);
  assert.deepEqual(data.bins, Array.from({ length: 17 }, (_, index) => ({
    start: start + index * TEN_MINUTES, end: start + (index + 1) * TEN_MINUTES,
    contacts: index === 0 || index === 16 ? 1 : index === 1 ? 2 : 0
  })));
  assert.equal(data.intervalMs, TEN_MINUTES);
  assert.equal(data.binCount, 17);
  assert.equal(data.sparse, false);
  assert.equal(data.total, 4);
  assert.equal(data.sourceContacts, 4);
  assert.equal(data.noiseCount, 0);
  assert.equal(data.invalidDateTimeCount, 0);
  assert.equal(data.hasAutoId, true);
  assert.deepEqual(data.missingColumns, []);
  assert.equal(data.start, start);
  assert.equal(data.end, Date.UTC(2026, 8, 19, 2, 40));
  assert.deepEqual(source, before);
  assert.deepEqual(Timeline.build({ ...source, records: source.records.slice().reverse() }), data);
});

test('each ten-minute boundary is half open, including milliseconds, midnight and dates before the epoch', () => {
  for (const date of ['2026-11-08', '1969-12-31']) {
    const data = Timeline.build(input([[date, '00:00:00'], [date, '00:09:59.9999'],
      [date, '00:10:00'], [date, '00:19:59.999'], [date, '00:20:00']]));
    assert.equal(data.intervalMs, TEN_MINUTES);
    assert.deepEqual(data.bins.map(bin => bin.contacts), [2, 2, 1]);
    assert(data.bins.every(bin => bin.end - bin.start === TEN_MINUTES));
    assert.equal(Math.abs(data.start % TEN_MINUTES), 0);
  }
  const midnight = Timeline.build(input([['2026-11-08', '23:59:59.999'], ['2026-11-09', '00:00:00']]));
  assert.deepEqual(midnight.bins.map(bin => bin.contacts), [1, 1]);
});

test('the shared timestamp reader preserves millisecond identity and includes Noise without aggregation', () => {
  assert.equal(typeof Timeline.createTimestampReader, 'function');
  const source = input([['24-07-25', '00:42:20.125', 'Noise'], ['24-07-25', '00:42:20.126', 'PIPPIP']]);
  const reader = Timeline.createTimestampReader(source);
  assert.equal(reader.timestampFor(0), Date.UTC(2025, 6, 24, 0, 42, 20, 125));
  assert.equal(reader.timestampFor(1), Date.UTC(2025, 6, 24, 0, 42, 20, 126));
  assert.deepEqual(reader.missingColumns, []);
  assert.equal(Timeline.build(source).total, 1, 'the existing chart keeps its independent Noise exclusion');
  for (const index of [-1, 2, .5, '0']) assert.throws(() => reader.timestampFor(index), /contact|numéro/i);
  const missing = Timeline.createTimestampReader({ headers: ['IN FILE', 'DATE-12'], records: [['x.wav', '2025-07-24']] });
  assert.deepEqual(missing.missingColumns, ['DATE', 'TIME']);
  assert.equal(missing.timestampFor(0), null);
});

test('European dates are day first with an explicit 70 pivot, while all accepted clocks preserve source hours', () => {
  for (const [date, time, expected] of [
    ['24-07-25', '00:42:20', Date.UTC(2025, 6, 24, 0, 40)],
    ['24/07/2025', '12:34', Date.UTC(2025, 6, 24, 12, 30)],
    ['1-2-2025', '1:05:00.125', Date.UTC(2025, 1, 1, 1)],
    ['01/01/69', '07:00:00,5', Date.UTC(2069, 0, 1, 7)],
    ['01-01-70', '07:00:00', Date.UTC(1970, 0, 1, 7)],
    ['2024-02-29', '23:59:59.9999', Date.UTC(2024, 1, 29, 23, 50)]
  ]) {
    const data = Timeline.build(input([[date, time]]));
    assert.equal(data.start, expected, date + ' ' + time);
    assert.equal(data.bins[0].contacts, 1);
  }
});

test('source wall clocks are timezone independent, including repeated and skipped daylight-saving hours', () => {
  const originalTimezone = process.env.TZ;
  try {
    const expected = Timeline.build(input([['2026-10-25', '02:30'], ['2026-10-25', '02:30'], ['2026-03-29', '02:30']]));
    for (const timezone of ['UTC', 'Europe/Brussels', 'America/New_York']) {
      process.env.TZ = timezone;
      assert.deepEqual(Timeline.build(input([['2026-10-25', '02:30'], ['2026-10-25', '02:30'], ['2026-03-29', '02:30']])), expected);
    }
    assert.equal(Timeline.build(input([['2026-03-29', '02:30']])).start, Date.UTC(2026, 2, 29, 2, 30));
    assert.equal(Timeline.build(input([['2026-10-25', '02:30'], ['2026-10-25', '02:30']])).bins[0].contacts, 2);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('source Noise is excluded before timestamp validation; NoID and blank AUTO-ID contacts remain included', () => {
  const source = input([['2026-01-01', '22:00', 'NoID'], ['2026-01-01', '22:01', ''],
    ['invalid', 'bad', ' n-o_i s e '], ['2026-01-01', '22:02', 'Noise'], ['invalid', 'bad', 'MYODAU']]);
  const data = Timeline.build(source);
  assert.equal(data.sourceContacts, 5);
  assert.equal(data.total, 2);
  assert.equal(data.noiseCount, 2);
  assert.equal(data.invalidDateTimeCount, 1);
  assert.deepEqual(data.bins.map(bin => bin.contacts), [2]);
  const withoutAuto = { headers: ['IN FILE', 'RECORDINGDATE', 'RECORDINGTIME'], records: [['x.wav', '2026-01-01', '22:00']] };
  const unknownNoise = Timeline.build(withoutAuto);
  assert.equal(unknownNoise.hasAutoId, false);
  assert.equal(unknownNoise.noiseCount, null);
  assert.equal(unknownNoise.total, 1);
});

test('missing DATE or TIME never falls back to DATE-12, the filename or midnight', () => {
  const data = Timeline.build({ fileName: '2026-01-01_230000.csv', headers: ['IN FILE', 'DATE-12', 'AUTO-ID'],
    records: [['2026-01-01_230000.wav', '2026-01-01', 'NoID'], ['noise.wav', '2026-01-01', 'Noise']] });
  assert.deepEqual(data.missingColumns, ['DATE', 'TIME']);
  assert.equal(data.total, 0);
  assert.equal(data.invalidDateTimeCount, 1);
  assert.equal(data.noiseCount, 1);
  assert.deepEqual(data.bins, []);
  assert.equal(data.start, null);
  assert.equal(data.end, null);
  assert.equal(data.intervalMs, TEN_MINUTES);
  assert.equal(data.binCount, 0);
  assert.equal(data.sparse, false);
  const noTime = Timeline.build({ headers: ['IN FILE', 'DATE'], records: [['x.wav', '2026-01-01']] });
  assert.deepEqual(noTime.missingColumns, ['TIME']);
  assert.equal(noTime.invalidDateTimeCount, 1);
});

test('invalid dates and clock values are reported without calendar rollover or locale guessing', () => {
  const invalid = [
    ['2025-02-29', '00:00'], ['31/04/25', '00:00'], ['2026-13-01', '00:00'], ['', '00:00'],
    ['2026-01-01', ''], ['2026-01-01', '24:00'], ['2026-01-01', '23:60'], ['2026-01-01', '23:59:60'],
    ['2026-01-01', '-1:00'], ['2026-01-01', '12:3'], ['2026-01-01', '12:00Z'], ['2026/01/01', '12:00'],
    ['46023', '.25'], ['2026-01-01', '.25']
  ];
  const data = Timeline.build(input(invalid));
  assert.equal(data.total, 0);
  assert.equal(data.invalidDateTimeCount, invalid.length);
  assert.deepEqual(data.bins, []);
});

test('Excel metadata enables numeric dates and fractional times for both 1900 and 1904 calendars', () => {
  for (const [metadata, date, time, expected] of [
    [{ fileName: 'contacts.xlsx', sheetName: 'Contacts' }, '46023', '.25', Date.UTC(2026, 0, 1, 6)],
    [{ fileName: 'contacts.xls' }, '0', '0', Date.UTC(1899, 11, 31)],
    [{ fileName: 'contacts.xlsx', excelDate1904: true }, '0', '.5', Date.UTC(1904, 0, 1, 12)],
    [{ fileName: 'contacts_resultats.csv', excelDates: true, excelDate1904: true }, '0', '0,25', Date.UTC(1904, 0, 1, 6)],
    [{ excelDates: true }, '46023', String(1 / 24), Date.UTC(2026, 0, 1, 1)],
    [{ excelDates: true }, '46023', '.9999999999999999', Date.UTC(2026, 0, 1, 23, 50)]
  ]) {
    const data = Timeline.build(input([[date, time]], metadata));
    assert.equal(data.total, 1, JSON.stringify(metadata));
    assert.equal(data.start, expected);
  }
  const leapBug = Timeline.build(input([['59', '.5'], ['60', '.5'], ['61', '.5']], { excelDates: true }));
  assert.equal(leapBug.total, 2);
  assert.equal(leapBug.invalidDateTimeCount, 1);
  assert.equal(leapBug.start, Date.UTC(1900, 1, 28, 12));
  assert.equal(leapBug.end, Date.UTC(1900, 2, 1, 12, 10));
});

test('Excel times outside one day and invalid serial dates are rejected rather than used as durations', () => {
  const data = Timeline.build(input([['46023', '1'], ['46023', '-.1'], ['-1', '.5'], ['Infinity', '.5'],
    ['46023', '1.5'], ['2958466', '.5']], { excelDates: true }));
  assert.equal(data.total, 0);
  assert.equal(data.invalidDateTimeCount, 6);
});

test('dense zero bins stop at 720 while longer gaps compress only zero interiors at the same ten-minute resolution', () => {
  function atBin(index) {
    const stamp = new Date(index * TEN_MINUTES).toISOString();
    return [stamp.slice(0, 10), stamp.slice(11, 23)];
  }
  const dense = Timeline.build(input([atBin(0), atBin(719)]));
  assert.equal(dense.bins.length, 720);
  assert.equal(dense.binCount, 720);
  assert.equal(dense.sparse, false);
  assert(dense.bins.slice(1, -1).every(bin => bin.contacts === 0));
  const sparse = Timeline.build(input([atBin(0), atBin(720)]));
  assert.equal(sparse.intervalMs, TEN_MINUTES);
  assert.equal(sparse.binCount, 721);
  assert.equal(sparse.sparse, true);
  assert.deepEqual(sparse.bins.map(bin => [bin.start / TEN_MINUTES, bin.contacts]), [[0, 1], [1, 0], [719, 0], [720, 1]]);
  const mixed = Timeline.build(input([0, 1, 4, 4, 6, 720, 721].map(atBin)));
  assert.equal(mixed.total, 7);
  assert.deepEqual(mixed.bins.map(bin => [bin.start / TEN_MINUTES, bin.contacts]),
    [[0, 1], [1, 1], [2, 0], [3, 0], [4, 2], [5, 0], [6, 1], [7, 0], [719, 0], [720, 1], [721, 1]]);
  for (const data of [dense, sparse, mixed]) {
    assert.equal(data.intervalMs, TEN_MINUTES);
    assert(data.bins.every(bin => bin.end - bin.start === TEN_MINUTES));
    assert.equal(data.bins.reduce((sum, bin) => sum + bin.contacts, 0), data.total);
  }
});

test('extreme date spans keep bounded zero anchors instead of allocating centuries of empty bins', () => {
  const extreme = Timeline.build(input([['1800-01-01', '00:00'], ['9999-12-31', '23:59:59']]));
  assert.equal(extreme.intervalMs, TEN_MINUTES);
  assert.equal(extreme.sparse, true);
  assert(extreme.binCount > 400000000);
  assert.equal(extreme.bins.length, 4);
  assert(extreme.bins.every(bin => bin.end - bin.start === TEN_MINUTES));
  assert.equal(extreme.bins[1].contacts, 0);
  assert.equal(extreme.bins[2].contacts, 0);
  assert.equal(extreme.bins[1].start, extreme.start + TEN_MINUTES);
  assert.equal(extreme.bins[2].end, extreme.bins[3].start);
  assert.equal(extreme.bins.reduce((sum, bin) => sum + bin.contacts, 0), 2);
  assert.equal(extreme.end, extreme.bins.at(-1).end);
});

test('occupied ten-minute bins are never merged or discarded beyond the dense threshold', () => {
  const contacts = Array.from({ length: 2500 }, (_, index) => {
    const stamp = new Date(index * TEN_MINUTES).toISOString();
    return [stamp.slice(0, 10), stamp.slice(11, 23)];
  });
  const data = Timeline.build(input(contacts));
  assert.equal(data.intervalMs, TEN_MINUTES);
  assert.equal(data.binCount, 2500);
  assert.equal(data.bins.length, 2500);
  assert.equal(data.total, 2500);
  assert(data.bins.every(bin => bin.contacts === 1 && bin.end - bin.start === TEN_MINUTES));
});

test('header-only and all-Noise exports have explicit empty results and malformed table shapes fail clearly', () => {
  const empty = Timeline.build(input([]));
  assert.equal(empty.total, 0);
  assert.equal(empty.sourceContacts, 0);
  assert.equal(empty.start, null);
  assert.equal(empty.end, null);
  const noise = Timeline.build(input([['bad', 'bad', 'Noise']]));
  assert.equal(noise.noiseCount, 1);
  assert.equal(noise.invalidDateTimeCount, 0);
  for (const value of [null, {}, { headers: [], records: [null] }, { headers: ['DATE'], records: [[]] }]) {
    assert.throws(() => Timeline.build(value), /tableau|import|ligne|contact|en-têtes/i);
  }
});

test('the browser UMD module uses the same chronological source-data contract', () => {
  const context = { BatReviewCore: Core };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'timeline-data.js'), 'utf8'), context);
  assert.equal(typeof context.PlecotusTimelineData.build, 'function');
  const data = context.PlecotusTimelineData.build(input([['24-07-25', '00:42:20']]));
  assert.equal(data.total, 1);
  assert.equal(data.start, Date.UTC(2025, 6, 24, 0, 40));
});

const realExport = path.join(__dirname, '..', 'test-inputs', 'id_bievres.csv');
test('the local real contact export accepts its European dates without exposing source rows', { skip: !fs.existsSync(realExport) }, () => {
  const parsed = Core.parseCSV(fs.readFileSync(realExport, 'utf8'));
  const data = Timeline.build({ ...parsed, fileName: 'contacts.csv' });
  assert.equal(data.sourceContacts, 26070);
  assert.equal(data.total, 15840);
  assert.equal(data.noiseCount, 10230);
  assert.equal(data.invalidDateTimeCount, 0);
  assert.equal(data.intervalMs, TEN_MINUTES);
  assert.equal(data.binCount, 61);
  assert.equal(data.bins.reduce((sum, bin) => sum + bin.contacts, 0), 15840);
  assert(data.bins.length <= 720);
});
