const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Import = require('../file-import.js');
const ImportChart = require('../import-chart.js');
const Chart = require('../activity-chart.js');
const Export = require('../activity-export.js');

function imported(records, headers = ['IN FILE', 'AUTO-ID', 'MANUAL ID']) {
  const parsed = Core.parseCSV(Core.stringifyCSV(headers, records));
  return { ...parsed, columns: Core.canonicalColumns(headers), summary: Import.summarize(parsed) };
}

test('source chart reconciles with the imported non-Noise total and retains blank/NoID contacts', () => {
  const source = imported([
    ['a.wav', 'PIPPIP', 'NYCNOC'],
    ['b.wav', 'Pipistrellus pipistrellus', ''],
    ['c.wav', 'Pipistrelle commune', ''],
    ['d.wav', 'Noise', 'PIPNAT'],
    ['e.wav', ' n-o_i s e ', ''],
    ['f.wav', '', 'NYCNOC'],
    ['g.wav', 'NoID', ''],
    ['h.wav', 'Mystère A', ''],
    ['i.wav', 'Mystère B', '']
  ]);
  const original = structuredClone(source);
  const result = ImportChart.build(source);
  assert.equal(result.total, 7);
  assert.equal(result.noiseCount, 2);
  assert.equal(result.total, source.summary.contactsExcludingNoise);
  assert.equal(result.total + result.noiseCount, source.summary.totalContacts);
  assert.equal(result.rows.find(row => row.scientificName === 'Pipistrellus pipistrellus').contacts, 3);
  assert.equal(result.rows.find(row => row.scientificName === 'Sans identification automatique').contacts, 1);
  assert.equal(result.rows.find(row => row.scientificName === 'NoID').contacts, 1);
  assert.equal(Chart.prepare(result.rows).total, 7);
  assert.deepEqual(source, original);
});

test('known group aliases merge without becoming a species; unknown complexes remain distinct', () => {
  const result = ImportChart.build(imported([
    ['a.wav', 'MYO', ''], ['b.wav', 'Myotis spp.', ''],
    ['c.wav', 'EPTSER/PIPPIP', ''], ['d.wav', 'Myotis cf. myotis', '']
  ]));
  const group = result.rows.find(row => row.scientificName === 'Myotis sp.');
  assert.equal(group.contacts, 2);
  assert.equal(group.isSpecies, false);
  assert.equal(group.known, true);
  assert.equal(result.rows.find(row => row.scientificName === 'EPTSER/PIPPIP').known, false);
  assert.equal(result.rows.find(row => row.scientificName === 'Myotis cf. myotis').contacts, 1);
  assert.equal(result.total, 4);
});

test('manual corrections do not replace the source distribution or change its Noise exclusion', () => {
  const result = ImportChart.build(imported([
    ['a.wav', 'PIPPIP', 'Noise'], ['b.wav', 'Noise', 'MYODAS'], ['c.wav', 'Libellé libre', 'PIPPIP']
  ]));
  assert.equal(result.total, 2);
  assert.equal(result.noiseCount, 1);
  assert.deepEqual(result.rows.map(row => row.scientificName).sort(), ['Libellé libre', 'Pipistrellus pipistrellus'].sort());
});

test('missing AUTO-ID groups every contact as unclassified and preserves unknown noise count', () => {
  const result = ImportChart.build(imported([['a.wav', 'Noise'], ['b.wav', 'PIPPIP']], ['IN FILE', 'MANUAL ID']));
  assert.deepEqual(result, { rows: [{ scientificName: 'Sans identification automatique', frenchName: '', isSpecies: false, known: false, contacts: 2 }], total: 2, noiseCount: null });
  assert.equal(Chart.prepare(result.rows).total, 2);
});

test('literal Bruit is retained even though the shared renderer also guards against that label', () => {
  const source = imported([['a.wav', 'Bruit', ''], ['b.wav', 'Noise', ''], ['c.wav', 'Noise possible', '']]);
  const result = ImportChart.build(source);
  assert.equal(result.total, 2);
  assert.equal(result.noiseCount, 1);
  assert.equal(result.total, source.summary.contactsExcludingNoise);
  assert.ok(result.rows.some(row => row.scientificName === 'Bruit (libellé source)'));
  assert.equal(Chart.prepare(result.rows).total, 2);
});

test('all-Noise and header-only files produce explicit empty distributions', () => {
  assert.deepEqual(ImportChart.build(imported([['a.wav', 'Noise', ''], ['b.wav', 'NOISE', '']])), { rows: [], total: 0, noiseCount: 2 });
  assert.deepEqual(ImportChart.build(imported([])), { rows: [], total: 0, noiseCount: 0 });
});

test('raw source labels remain literal data and are escaped by both chart and export renderers', () => {
  const label = '<script>alert("espèce")</script>';
  const result = ImportChart.build(imported([['a.wav', label, '']]));
  assert.equal(result.rows[0].scientificName, label);
  const html = Chart.render(result.rows, 'pie');
  const svg = Export.svg(result.rows, 'pie').svg;
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test('invalid input and ambiguous source headers cannot silently produce a chart', () => {
  assert.throws(() => ImportChart.build(null), /contacts du fichier/);
  assert.throws(() => ImportChart.build({ headers: ['AUTO-ID', 'Auto ID'], records: [] }), /ambiguïté/);
  assert.throws(() => ImportChart.build({ headers: ['AUTO-ID'], records: [null] }), /ligne du fichier/);
});
