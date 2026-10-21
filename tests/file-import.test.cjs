const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Import = require('../file-import.js');
const XLSX = require('../vendor/sheetjs/xlsx.full.min.js');

function file(name, bytes) {
  const content = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { name, size: content.length, arrayBuffer: async () => content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) };
}

function workbookFile(name, sheets, bookType = 'xlsx') {
  const workbook = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return file(name, XLSX.write(workbook, { type: 'buffer', bookType }));
}

test('counts every CSV contact, includes blank AUTO-ID, excludes source Noise and detects no manual entries', async () => {
  const source = '\uFEFF# Export Kaleidoscope\r\nIN FILE;AUTO-ID;MANUAL ID\r\n"a;one.wav";PIPPIP; \r\nnoise.wav; nOiSe ;\r\nempty.wav;;\r\n\r\n';
  const imported = await Import.read(file('contacts.CSV', source));
  assert.equal(imported.records[0][0], 'a;one.wav');
  assert.deepEqual(imported.summary, { totalContacts: 3, noiseContacts: 1, contactsExcludingNoise: 2, manualIdCount: 0, vanilla: true, hasManualIdColumn: true, hasAutoIdColumn: true });
});

test('any nonblank manual cell counts, including source Noise rows, NoID, zero and multiline notes', async () => {
  const records = [['a.wav', 'Noise', 'NoID'], ['b.wav', 'PIPPIP', '0'], ['c.wav', '', 'À revoir\nplus tard'], ['d.wav', 'Noise', ' \t ']];
  const imported = await Import.read(file('manual.csv', Core.stringifyCSV(['IN FILE', 'AUTO-ID', 'MANUAL ID'], records)));
  assert.equal(imported.summary.manualIdCount, 3);
  assert.equal(imported.summary.vanilla, false);
  assert.equal(imported.summary.noiseContacts, 2);
  assert.equal(imported.summary.totalContacts, 4);
});

test('uses canonical aliases and rejects duplicate or ambiguous manual headers', async () => {
  const aliases = await Import.read(file('alias.csv', 'File\tSpecies Auto-ID\tManual identification\na.wav\tNoise\tPIPPIP'));
  assert.equal(aliases.summary.manualIdCount, 1);
  for (const headers of ['IN FILE,AUTO-ID,MANUAL ID,MANUAL ID', 'IN FILE,AUTO-ID,MANUAL ID,Manual identification']) {
    await assert.rejects(Import.read(file('bad.csv', headers + '\na.wav,Noise,,PIPPIP')), /double|ambiguïté/);
  }
});

test('missing manual column is explicit; missing AUTO-ID leaves noise-excluded count unknown', async () => {
  const imported = await Import.read(file('manual-only.csv', 'IN FILE,MANUAL ID\na.wav,\nb.wav,PIPPIP'));
  assert.equal(imported.summary.contactsExcludingNoise, null);
  assert.equal(imported.summary.noiseContacts, null);
  assert.equal(imported.summary.manualIdCount, 1);
  const absentManual = await Import.read(file('no-manual.csv', 'IN FILE,AUTO-ID\na.wav,Noise'));
  assert.equal(absentManual.summary.vanilla, true);
  assert.equal(absentManual.summary.hasManualIdColumn, false);
  assert.match(absentManual.warnings.join(' '), /MANUAL ID absente/);
});

test('rejects unrelated files and malformed CSV instead of labeling them vanilla', async () => {
  await assert.rejects(Import.read(file('unknown.csv', 'Name,Value\none,two')), /IN FILE/);
  await assert.rejects(Import.read(file('unknown.txt', 'IN FILE,AUTO-ID\na.wav,Noise')), /Format/);
  await assert.rejects(Import.read(file('bad.csv', 'IN FILE,AUTO-ID\n"a.wav,Noise')), /non refermés/);
  await assert.rejects(Import.read(file('empty.csv', '')), /vide/);
  await assert.rejects(Import.read({ name: 'huge.csv', size: Import.MAX_FILE_SIZE + 1, arrayBuffer() { throw new Error('must not read'); } }), /50 Mo/);
});

test('header-only exports remain explicit zero-contact summaries', async () => {
  const imported = await Import.read(file('empty-contacts.csv', 'IN FILE,AUTO-ID,MANUAL ID\n'));
  assert.equal(imported.summary.totalContacts, 0);
  assert.equal(imported.summary.contactsExcludingNoise, 0);
  assert.equal(imported.summary.vanilla, true);
});

test('CSV import exposes physical source lines including preambles, blank rows and multiline fields', async () => {
  const source = '\n# Export\n\nIN FILE,AUTO-ID,MANUAL ID,NOTES\nfirst.wav,PIPPIP,,"two\nlines"\n\nsecond.wav,PIPNAT,,ok';
  const imported = await Import.read(file('source-lines.csv', source));
  assert.deepEqual(imported.sourceRows, [5, 8]);
  assert.equal(imported.summary.totalContacts, 2);
  assert.equal(imported.records[0][3], 'two\nlines');
});

test('Excel import retains worksheet rows across offset ranges, preambles, blanks and multiline cells', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = {};
  XLSX.utils.sheet_add_aoa(sheet, [
    ['Préambule'],
    [],
    ['IN FILE', 'AUTO-ID', 'MANUAL ID', 'NOTES'],
    ['first.wav', 'PIPPIP', '', 'two\nlines'],
    [],
    ['second.wav', 'PIPNAT', '', 'ok']
  ], { origin: 'C4' });
  sheet['!ref'] = 'C4:F9';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Contacts');
  workbook.Workbook = { WBProps: { date1904: true } };
  const imported = await Import.read(file('offset-rows.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })), { xlsx: XLSX });
  assert.deepEqual(imported.sourceRows, [7, 9]);
  assert.equal(imported.excelDate1904, true);
  assert.equal(imported.summary.totalContacts, 2);
  assert.equal(imported.records[0][3], 'two\nlines');
  assert.equal(sheet.F7.v, 'two\nlines');
});

test('decodes UTF-16 and falls back to Windows-1252 with a warning', async () => {
  const source = 'IN FILE,AUTO-ID,MANUAL ID\na.wav,PIPPIP,À revoir';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')]);
  assert.equal((await Import.read(file('utf16.csv', utf16))).summary.manualIdCount, 1);
  const cp1252 = Buffer.from(source.replace('À', '\xc0'), 'latin1');
  const imported = await Import.read(file('old.csv', cp1252));
  assert.equal(imported.records[0][2], 'À revoir');
  assert.match(imported.warnings.join(' '), /Windows-1252/);
});

test('decodes big-endian UTF-16 BOM and rejects NUL bytes instead of miscounting manual cells', async () => {
  const source = 'IN FILE,AUTO-ID,MANUAL ID\na.wav,Noise,';
  const bigEndian = Buffer.from(source, 'utf16le').swap16();
  const imported = await Import.read(file('big-endian.csv', Buffer.concat([Buffer.from([0xfe, 0xff]), bigEndian])));
  assert.equal(imported.summary.manualIdCount, 0);
  assert.equal(imported.summary.totalContacts, 1);
  await assert.rejects(Import.read(file('no-bom.csv', Buffer.from(source, 'utf16le'))), /caractères nuls/);
  await assert.rejects(Import.read(file('null.csv', source + '\u0000')), /caractères nuls/);
});

for (const [extension, bookType] of [['xlsx', 'xlsx'], ['xls', 'biff8']]) {
  test('reads real .' + extension + ' workbooks and preserves manual text and source noise counts', async () => {
    const source = workbookFile('contacts.' + extension, { Contacts: [['IN FILE', 'AUTO-ID', 'MANUAL ID'], ['a.wav', 'Noise', 'PIPPIP'], ['b.wav', '', 0], ['c.wav', 'PIPNAT', '']] }, bookType);
    const imported = await Import.read(source, { xlsx: XLSX });
    assert.equal(imported.sheetName, 'Contacts');
    assert.equal(imported.summary.totalContacts, 3);
    assert.equal(imported.summary.contactsExcludingNoise, 2);
    assert.equal(imported.summary.manualIdCount, 2);
    assert.equal(imported.summary.vanilla, false);
  });
}

test('ignores cover sheets but requires choosing between multiple compatible contact sheets', async () => {
  const rows = [['IN FILE', 'AUTO-ID', 'MANUAL ID'], ['a.wav', 'Noise', '']];
  const one = workbookFile('one.xlsx', { Introduction: [['Notes'], ['Un export de contacts']], Contacts: rows });
  const imported = await Import.read(one, { xlsx: XLSX });
  assert.equal(imported.sheetName, 'Contacts');
  assert.match(imported.warnings.join(' '), /Introduction/);
  const two = workbookFile('two.xlsx', { Premier: rows, Second: [['IN FILE', 'AUTO-ID', 'MANUAL ID'], ['b.wav', 'PIPPIP', 'NoID']] });
  await assert.rejects(Import.read(two, { xlsx: XLSX }), error => {
    assert.equal(error.code, 'SHEET_SELECTION_REQUIRED');
    assert.deepEqual(error.sheets, ['Premier', 'Second']);
    return true;
  });
  const selected = await Import.read(two, { xlsx: XLSX, sheetName: 'Second' });
  assert.equal(selected.summary.manualIdCount, 1);
  assert.equal(selected.summary.totalContacts, 1);
});

test('Excel applies the same ambiguous manual-header validation', async () => {
  const source = workbookFile('ambiguous.xlsx', { Contacts: [['IN FILE', 'AUTO-ID', 'MANUAL ID', 'Manual identification'], ['a.wav', 'Noise', '', 'PIPPIP']] });
  await assert.rejects(Import.read(source, { xlsx: XLSX }), /ambiguïté/);
});

test('Excel display formatting cannot hide entered manual IDs, including numeric zero', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['IN FILE', 'AUTO-ID', 'MANUAL ID'],
    ['zero.wav', 'Noise', 0],
    ['text.wav', 'PIPPIP', 'PIPNAT'],
    ['blank.wav', 'PIPNAT', '']
  ]);
  sheet.C2.z = ';;;';
  sheet.C3.z = ';;;';
  XLSX.utils.book_append_sheet(workbook, sheet, 'Contacts');
  const imported = await Import.read(file('hidden-identifications.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })), { xlsx: XLSX });
  assert.equal(imported.summary.manualIdCount, 2);
  assert.equal(imported.summary.vanilla, false);
  assert.deepEqual(imported.records.map(row => row[2]), ['0', 'PIPNAT', '']);
});

test('a stored Excel error in MANUAL ID is not silently treated as an empty cell', async () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['IN FILE', 'AUTO-ID', 'MANUAL ID'], ['a.wav', 'PIPPIP', '']]);
  sheet.C2 = { t: 'e', v: 42 };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Contacts');
  const imported = await Import.read(file('error.xlsx', XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })), { xlsx: XLSX });
  assert.equal(imported.summary.vanilla, false);
  assert.equal(imported.summary.manualIdCount, 1);
  assert.equal(imported.records[0][2], '#N/A');
  assert.match(imported.warnings.join(' '), /cellules Excel.*erreurs/);
});
