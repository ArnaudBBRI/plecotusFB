const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../core.js');
const Timeline = require('../timeline-data.js');
const Names = require('../species.js');
const Results = require('../results-file.js');
let Context;
try { Context = require('../contact-context-data.js'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

function source(count = 25) {
  return { fileName: 'context.csv', headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'PULSES', 'DATE', 'TIME', 'MANUAL ID', 'SEMIMANUAL ID'],
    records: Array.from({ length: count }, (_, index) => ['same.wav', index % 2 ? 'MYODAU' : 'Noise', ' 0,80 ', '0012',
      '2026-01-01', '22:00:00.' + String(count - 1 - index).padStart(3, '0'), '', 'CALCULATED']),
    sourceRows: Array.from({ length: count }, (_, index) => index + 40) };
}

test('chronological context selects ten contacts on each side by exact timestamps and includes every source species and Noise', () => {
  assert.equal(typeof Context?.create, 'function', 'the context data index must be available');
  const imported = source();
  const before = structuredClone(imported);
  const data = Context.create(imported).get(12);
  assert.deepEqual(data.rows.map(row => row.recordIndex), [22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  assert.equal(data.beforeCount, 10);
  assert.equal(data.afterCount, 10);
  assert.equal(data.undatedCount, 0);
  assert.equal(data.referenceDated, true);
  assert.deepEqual(data.missingColumns, []);
  assert.equal(data.rows[10].isReference, true);
  assert.equal(data.rows.filter(row => row.isReference).length, 1);
  assert.equal(data.rows[10].lineNumber, 52);
  assert.equal(data.rows[10].timestamp, Date.UTC(2026, 0, 1, 22, 0, 0, 12));
  assert.equal(data.rows[0].timestamp, Date.UTC(2026, 0, 1, 22, 0, 0, 2));
  assert.equal(data.rows[10].fileName, 'same.wav');
  assert.equal(data.rows[10].autoId, 'Noise');
  assert.equal(data.rows[10].ratio, ' 0,80 ');
  assert.equal(data.rows[10].pulses, '0012');
  assert(data.rows.some(row => row.autoId === 'MYODAU'));
  assert.deepEqual(imported, before);
});

test('file boundaries return fewer neighbors and equal timestamps use source record identity rather than shared WAV names', () => {
  const imported = source(30);
  imported.records.forEach(record => { record[5] = '22:00:00.125'; });
  const model = Context.create(imported);
  const middle = model.get(15);
  assert.deepEqual(middle.rows.map(row => row.recordIndex), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]);
  assert(middle.rows.every(row => row.timestamp === Date.UTC(2026, 0, 1, 22, 0, 0, 125)));
  const first = model.get(0), last = model.get(29);
  assert.equal(first.beforeCount, 0);
  assert.equal(first.afterCount, 10);
  assert.deepEqual(first.rows.map(row => row.recordIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(last.beforeCount, 10);
  assert.equal(last.afterCount, 0);
  assert.equal(last.rows.at(-1).recordIndex, 29);
  assert.equal(last.rows.at(-1).isReference, true);
});

test('undated contacts cannot enter chronological neighbors and an undated reference stays visible alone', () => {
  const imported = source(4);
  imported.records[1][4] = '';
  imported.records[2][5] = '24:00';
  const model = Context.create(imported);
  const dated = model.get(0);
  assert.deepEqual(dated.rows.map(row => row.recordIndex), [3, 0]);
  assert.equal(dated.undatedCount, 2);
  const undated = model.get(1);
  assert.equal(undated.referenceDated, false);
  assert.equal(undated.beforeCount, 0);
  assert.equal(undated.afterCount, 0);
  assert.equal(undated.undatedCount, 2);
  assert.equal(undated.rows.length, 1);
  assert.equal(undated.rows[0].recordIndex, 1);
  assert.equal(undated.rows[0].timestamp, null);
  assert.equal(undated.rows[0].isReference, true);
  const noClock = Context.create({ headers: ['IN FILE', 'DATE-12'], records: [['2026-01-01_220000.wav', '2026-01-01']] }).get(0);
  assert.deepEqual(noClock.missingColumns, ['DATE', 'TIME']);
  assert.equal(noClock.referenceDated, false);
  assert.equal(noClock.rows[0].timestamp, null);
});

test('manual IDs are read fresh and local invalidation or deferral cannot resurrect an old source identification', () => {
  const imported = source(3);
  imported.records[0][6] = 'Identification source';
  imported.records[1][6] = 'Ancienne identification';
  const model = Context.create(imported);
  const decisions = new Map();
  const getDecision = index => decisions.get(index) || null;
  const rowAt = index => model.get(1, getDecision).rows.find(row => row.recordIndex === index);
  assert.equal(rowAt(0).manualId, 'Identification source');
  assert.equal(rowAt(0).manualStatus, 'identified');
  assert.equal(rowAt(2).manualId, '');
  assert.equal(rowAt(2).manualStatus, 'unreviewed');
  decisions.set(1, { status: 'invalidated', manualId: null });
  assert.equal(rowAt(1).manualId, '');
  assert.equal(rowAt(1).manualStatus, 'pending');
  decisions.set(0, { status: 'unresolved', manualId: null });
  assert.equal(rowAt(0).manualId, '');
  assert.equal(rowAt(0).manualStatus, 'unresolved');
  decisions.set(2, { status: 'invalidated', manualId: 'NoID' });
  assert.equal(rowAt(2).manualId, 'NoID');
  assert.equal(rowAt(2).manualStatus, 'identified');
  decisions.set(1, { status: 'validated', manualId: 'PIPPIP' });
  assert.equal(rowAt(1).manualId, 'PIPPIP');
  assert.equal(rowAt(1).manualStatus, 'identified');
  assert.equal(imported.records[1][6], 'Ancienne identification');
  assert.equal(imported.records[2][7], 'CALCULATED');
});

test('legacy confirmation may use AUTO-ID only if manualId is absent while imported uncertainty stays explicitly unresolved', () => {
  const imported = source(3);
  imported.records[0][6] = 'Uncertain';
  imported.records[1][6] = 'ancienne valeur';
  const model = Context.create(imported);
  let rows = model.get(1).rows;
  assert.equal(rows.find(row => row.recordIndex === 0).manualStatus, 'unresolved');
  assert.equal(rows.find(row => row.recordIndex === 0).manualId, '');
  rows = model.get(1, index => index === 1 ? { status: 'validated' } : null).rows;
  assert.equal(rows.find(row => row.recordIndex === 1).manualId, 'MYODAU');
  rows = model.get(1, index => index === 1 ? { status: 'validated', manualId: null } : null).rows;
  assert.equal(rows.find(row => row.recordIndex === 1).manualId, '');
  assert.equal(rows.find(row => row.recordIndex === 1).manualStatus, 'pending');
  rows = model.get(1, index => index === 1 ? { status: 'invalidated', manualId: 'Identification incertaine/non résolue' } : null).rows;
  assert.equal(rows.find(row => row.recordIndex === 1).manualStatus, 'unresolved');
  assert.equal(rows.find(row => row.recordIndex === 1).manualId, '');
});

test('context reuses European and both Excel calendars, including explicitly marked results CSVs', () => {
  const european = { headers: ['FILE', 'RECORDINGDATE', 'RECORDINGTIME'],
    records: [['later.wav', '24-07-25', '00:00:00'], ['earlier.wav', '23/07/2025', '23:59:59.999']] };
  const dated = Context.create(european).get(0);
  assert.deepEqual(dated.rows.map(row => row.recordIndex), [1, 0]);
  assert.equal(dated.rows[0].timestamp, Date.UTC(2025, 6, 23, 23, 59, 59, 999));
  for (const [date1904, serial, expected] of [[false, '46023', Date.UTC(2026, 0, 1, 6)], [true, '0', Date.UTC(1904, 0, 1, 6)]]) {
    const imported = { fileName: 'contacts.xlsx', sheetName: 'Contacts', excelDate1904: date1904,
      headers: ['IN FILE', 'DATE', 'TIME'], records: [['later.wav', serial, '.5'], ['earlier.wav', serial, '.25']] };
    const rows = Context.create(imported).get(0).rows;
    assert.deepEqual(rows.map(row => row.recordIndex), [1, 0]);
    assert.equal(rows[0].timestamp, expected);
  }
  const resumed = Results.prepareResume({ fileName: 'contacts_resultats.csv',
    headers: ['IN FILE', 'DATE', 'TIME', Results.ORIGIN_HEADER, Results.CALENDAR_HEADER],
    records: [['later.wav', '0', '.5', Results.ORIGINS.unassigned, '1904'],
      ['earlier.wav', '0', '.25', Results.ORIGINS.unassigned, '1904']] });
  assert.equal(Context.create(resumed.imported).get(0).rows[0].timestamp, Date.UTC(1904, 0, 1, 6));
});

test('context results are detached and invalid anchors or callback types fail without altering the source', () => {
  const imported = source(2), before = structuredClone(imported);
  const model = Context.create(imported);
  const first = model.get(0);
  first.rows[0].autoId = 'modifié';
  first.missingColumns.push('inventé');
  const second = model.get(0);
  assert.equal(second.rows[0].autoId, 'MYODAU');
  assert.deepEqual(second.missingColumns, []);
  assert.deepEqual(imported, before);
  for (const index of [-1, 2, .5, '0', null]) assert.throws(() => model.get(index), /contact|numéro/i);
  assert.throws(() => model.get(0, 'invalid'), /décision|fonction/i);
  assert.throws(() => Context.create(null), /import|tableau|en-têtes/i);
});

test('browser modules expose the shared timestamp reader and context API without Node or network dependencies', () => {
  const browser = { BatReviewCore: Core, BatSpeciesNames: Names };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'timeline-data.js'), 'utf8'), browser);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'contact-context-data.js'), 'utf8'), browser);
  assert.equal(typeof browser.PlecotusTimelineData.createTimestampReader, 'function');
  const data = browser.PlecotusContactContextData.create(source(1)).get(0);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].recordIndex, 0);
  assert.equal(data.rows[0].isReference, true);
});
