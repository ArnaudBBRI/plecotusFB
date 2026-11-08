const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const XLSX = require('../vendor/sheetjs/xlsx.full.min.js');
const Import = require('../file-import.js');
const Timeline = require('../timeline-data.js');
const Workflow = require('../manual-workflow.js');
const Results = require('../results-file.js');
const UI = require('../timeline-ui.js');

const hour = 3600000, tenMinutes = 600000;
function file(name, bytes) {
  return { name, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
}

// Ten-minute vectors were counted independently from literal source DATE/TIME
// columns, without timeline-data or its timestamp reader. Hash the comma-joined
// counts to check every bin without copying private contact rows into tests.
for (const [name, sourceContacts, noiseCount, start, binCount, first, last, peakStart, peakContacts, zeroCount, hash] of [
  ['chiro_jardin_030524.csv', 473, 168, Date.UTC(2024, 4, 3, 21, 20), 50,
    [1, 3, 18], [1, 1, 15], Date.UTC(2024, 4, 3, 22, 40), 35, 21,
    'ff232db2eefe9cc97368848a4851d71cbbcc210e782797ad3c6fe77788133d23'],
  ['chiro_jardin_040524.csv', 2963, 2488, Date.UTC(2024, 4, 4, 21, 20), 50,
    [3, 0, 2], [1, 0, 7], Date.UTC(2024, 4, 4, 22, 30), 79, 29,
    'ce695079177cf59e2cf1b4edd85a594e8844a0e1e574d6321088c9943b10c867'],
  ['chiro_jardin_061224.csv', 410, 368, Date.UTC(2024, 5, 11, 22), 16,
    [1, 5, 8], [0, 0, 1], Date.UTC(2024, 5, 11, 22, 30), 11, 8,
    'c2050a37792fd551ce7f2b1d9841a6f4f6af010da2582ea235826e8105221464'],
  ['id_bievres.csv', 26070, 10230, Date.UTC(2025, 6, 23, 20, 40), 61,
    [1, 0, 13], [1, 15, 2], Date.UTC(2025, 6, 23, 23), 462, 3,
    '7398c4e5b813ef4102df330a050fa60422a047fe229289ffb03f31761e7df21b']
]) {
  const location = path.join(__dirname, '..', 'test-inputs', name);
  test('real chronology matches every independently counted ten-minute bin for ' + name,
    { skip: !fs.existsSync(location) }, async () => {
      const imported = await Import.read(file(name, fs.readFileSync(location)));
      const before = structuredClone(imported);
      const data = Timeline.build(imported);
      assert.equal(data.sourceContacts, sourceContacts);
      assert.equal(data.noiseCount, noiseCount);
      assert.equal(data.invalidDateTimeCount, 0);
      assert.equal(data.total, sourceContacts - noiseCount);
      assert.equal(data.start, start);
      assert.equal(data.end, start + binCount * tenMinutes);
      assert.equal(data.intervalMs, tenMinutes);
      assert.equal(data.binCount, binCount);
      assert.equal(data.sparse, false);
      const counts = data.bins.map(bin => bin.contacts);
      assert.equal(counts.length, binCount);
      assert.equal(counts.reduce((sum, count) => sum + count, 0), sourceContacts - noiseCount);
      assert.deepEqual(counts.slice(0, 3), first);
      assert.deepEqual(counts.slice(-3), last);
      assert.equal(counts.filter(count => count === 0).length, zeroCount);
      assert.equal(Math.max(...counts), peakContacts);
      assert.deepEqual(data.bins.find(bin => bin.contacts === peakContacts),
        { start: peakStart, end: peakStart + tenMinutes, contacts: peakContacts });
      assert.equal(createHash('sha256').update(counts.join(',')).digest('hex'), hash);
      data.bins.forEach((bin, index) => {
        assert.equal(bin.start, start + index * tenMinutes);
        assert.equal(bin.end, start + (index + 1) * tenMinutes);
      });
      assert.deepEqual(imported, before);
    });
}

const absent = path.join(__dirname, '..', 'test-inputs', 'anomalies-hors-noise.csv');
test('the DATE-12-only example has no invented chronology and accounts for every excluded contact',
  { skip: !fs.existsSync(absent) }, async () => {
    const data = Timeline.build(await Import.read(file('anomalies-hors-noise.csv', fs.readFileSync(absent))));
    assert.equal(data.sourceContacts, 4);
    assert.equal(data.total, 0);
    assert.equal(data.noiseCount, 2);
    assert.equal(data.invalidDateTimeCount, 2);
    assert.deepEqual(data.missingColumns, ['DATE', 'TIME']);
    assert.deepEqual(data.bins, []);
    assert.equal(data.start, null);
    assert.equal(data.end, null);
  });

for (const [date1904, dateSerial, expectedDay] of [
  [false, 46023, Date.UTC(2026, 0, 1)],
  [true, 0, Date.UTC(1904, 0, 1)]
]) {
  test('actual Excel import and resumed results CSV preserve the ' + (date1904 ? '1904' : '1900') + ' chronology', async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['IN FILE', 'AUTO-ID', 'DATE', 'TIME', 'DATE-12', 'MATCH RATIO', 'Qual'],
      ['same.wav', 'PIPPIP', dateSerial, 1 / 24, '1999-01-01', .9, 2],
      ['same.wav', 'NoID', dateSerial, .25, '1999-01-01', .8, 1],
      ['noise.wav', 'Noise', dateSerial, .5, '1999-01-01', .8, 1]
    ]), 'Contacts');
    workbook.Workbook = { WBProps: { date1904 } };
    const imported = await Import.read(file('calendar.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })), { xlsx: XLSX });
    const snapshot = { decisions: [], comments: [] };
    const original = Timeline.build(imported);
    assert.equal(original.start, expectedDay + hour);
    assert.equal(original.end, expectedDay + 6 * hour + tenMinutes);
    assert.equal(original.intervalMs, tenMinutes);
    assert.equal(original.binCount, 31);
    assert.equal(original.sparse, false);
    assert.deepEqual(original.bins.map(bin => bin.contacts), [1, ...Array(29).fill(0), 1]);
    assert.equal(original.noiseCount, 1);
    const saved = Results.build(imported, Workflow.build(imported, snapshot), snapshot);
    const loaded = await Import.read(file(saved.fileName, Buffer.from(saved.text)));
    const resumed = Results.prepareResume(loaded).imported;
    assert.equal(resumed.excelDates, true);
    assert.equal(resumed.excelDate1904, date1904);
    assert.deepEqual(Timeline.build(resumed), original);
    assert.equal(resumed.records[0][resumed.headers.indexOf('DATE')], String(dateSerial));
  });
}

test('a failed replacement import clears a pending timeline export and preserves its own error state', async () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', innerHTML: '', hidden: false, listeners: new Map(),
      replaceChildren() { this.innerHTML = ''; },
      addEventListener(name, callback) { this.listeners.set(name, callback); } });
    return nodes.get(id);
  };
  const button = { dataset: { timelineExport: 'png' }, addEventListener(name, callback) { this[name] = callback; } };
  const downloads = [];
  let finish;
  const ui = UI.init({ document: { getElementById: node, querySelectorAll: () => [button] },
    images: { rasterize: () => new Promise(resolve => { finish = resolve; }) },
    download: image => downloads.push(image) });
  ui.show({ fileName: 'first.csv', headers: ['IN FILE', 'DATE', 'TIME'], records: [['one.wav', '2026-01-01', '23:00']] });
  const exporting = button.click();
  ui.reset();
  ui.show({ fileName: 'malformed.csv', headers: ['IN FILE', 'DATE', 'TIME'], records: [[]] });
  assert.match(node('timeline-caption').textContent, /Impossible de construire la chronologie/);
  assert.equal(node('timeline-chart').innerHTML, '');
  assert.equal(button.disabled, true);
  finish({ blob: new Blob(['old image']), extension: 'png' });
  await exporting;
  assert.deepEqual(downloads, []);
  assert.equal(node('timeline-export-status').textContent, '');
  assert.equal(button.disabled, true);
  assert.match(node('timeline-caption').textContent, /Impossible de construire la chronologie/);
});
