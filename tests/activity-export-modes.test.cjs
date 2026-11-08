const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Chart = require('../activity-chart.js');
const Images = require('../activity-export.js');
const Visuals = require('../final-summary-visuals.js');

const rows = [
  { scientificName: 'Pipistrellus pipistrellus', frenchName: 'Pipistrelle commune', isSpecies: true, contacts: 60 },
  { scientificName: 'Myotis daubentonii', frenchName: 'Murin de Daubenton', isSpecies: true, contacts: 30 },
  { scientificName: 'NoID', frenchName: 'Chauve-souris non identifiée', contacts: 10 }
];
const attributes = tag => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const columnRects = svg => [...svg.matchAll(/<rect\b[^>]*>/g)].map(match => attributes(match[0]))
  .filter(item => /^\d+$/.test(item['data-series'] || ''));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, actual + ' differs from ' + expected);

test('obsolete histogram export requests fall back to pie without exposing the removed mode', () => {
  assert.equal(Images.svg(rows, 'histogram').svg, Images.svg(rows, 'pie').svg);
  assert.doesNotMatch(Images.svg(rows, 'histogram').svg, /Histogramme|Barres verticales/);
});

test('vertical SVG exports draw columns proportional to counts from the same zero baseline', () => {
  const before = structuredClone(rows);
  for (const mode of ['vertical']) {
    const output = Images.svg(rows, mode);
    const columns = columnRects(output.svg);
    assert.equal(columns.length, 3, mode + ' must export columns rather than a pie');
    assert.match(output.svg, /Contacts/);
    assert.match(output.svg, /<text[^>]*>0<\/text>/);
    assert.match(output.svg, /Barres verticales/);
    const baseline = Number(columns[0].y) + Number(columns[0].height);
    columns.forEach(column => near(Number(column.y) + Number(column.height), baseline));
    near(Number(columns[0].height), Number(columns[1].height) * 2);
    near(Number(columns[0].height), Number(columns[2].height) * 6);
    assert.ok(columns.every(column => Number(column.width) > 0 && Number(column.height) > 0));
    const gap = Number(columns[1].x) - Number(columns[0].x) - Number(columns[0].width);
    assert.ok(gap > 0, 'vertical columns must be separated');
    assert.doesNotMatch(output.svg, /<circle|<path|NaN|Infinity/);
  }
  assert.deepEqual(rows, before);
});

test('column exports preserve full legends, selected denominators and palette after legend filtering', () => {
  const prepared = Chart.prepare(rows);
  const selected = Chart.select(rows, new Set([Chart.rowKey(prepared.rows[0])]));
  for (const mode of ['vertical']) {
    const output = Images.svg(selected.rows, mode, { hiddenCategories: 1, hiddenContacts: 60 });
    const columns = columnRects(output.svg);
    assert.equal(columns.length, 2);
    assert.equal((output.svg.match(/data-legend=/g) || []).length, 2);
    assert.match(output.svg, /40 contacts représentés/);
    assert.match(output.svg, /30 contacts \(75 %\)/);
    assert.match(output.svg, /10 contacts \(25 %\)/);
    assert.match(output.svg, /1 catégorie masquée · 60 contacts masqués/);
    assert.ok(output.svg.includes('Murin de Daubenton'));
    assert.ok(output.svg.includes('Chauve-souris non identifiée'));
    assert.equal(columns[0].fill, prepared.rows[1].color);
    assert.equal(columns[1].fill, prepared.rows[2].color);
    assert.doesNotMatch(output.svg, /data-legend="Pipistrellus pipistrellus"/);
  }
});

test('large column legends retain every category and empty column exports remain finite', () => {
  const many = Array.from({ length: 65 }, (_, index) => ({ scientificName: 'Taxon' + index + ' ' + 'W'.repeat(70),
    frenchName: 'Description française complète ' + index, contacts: index + 1 }));
  for (const mode of ['vertical']) {
    const output = Images.svg(many, mode);
    assert.equal(columnRects(output.svg).length, 65);
    assert.equal((output.svg.match(/data-legend=/g) || []).length, 65);
    for (let index = 0; index < 65; index++) assert.ok(output.svg.includes('Taxon' + index + ' '));
    assert.ok(output.height > 1500);
    const positions = [...output.svg.matchAll(/\by="([0-9.]+)"/g)].map(match => Number(match[1]));
    assert.ok(Math.max(...positions) < output.height);
    for (const empty of [[], [{ scientificName: 'Noise', contacts: 40 }]]) {
      const output = Images.svg(empty, mode);
      assert.match(output.svg, /Aucun contact attribué à une espèce/);
      assert.equal(columnRects(output.svg).length, 0);
      assert.doesNotMatch(output.svg, /NaN|Infinity/);
    }
  }
});

test('vertical mode escapes imported labels and SVG blob exports retain the selected column geometry', async () => {
  const unsafe = [{ scientificName: '<script>&"', frenchName: '<image href="https://invalid.example"/>', contacts: 1 }];
  for (const mode of ['vertical']) {
    const output = await Images.exportBlob(unsafe, mode, 'svg');
    const svg = await output.blob.text();
    assert.equal(columnRects(svg).length, 1);
    assert.match(svg, /&lt;script&gt;&amp;&quot;/);
    assert.doesNotMatch(svg, /<script|<image|<circle|NaN|Infinity/);
  }
});

test('PNG and JPEG conversion receive the requested column SVG instead of silently rasterizing a pie', async () => {
  const sources = [];
  const browser = { BatActivityChart: Chart, Intl, Blob, setTimeout, clearTimeout,
    URL: { createObjectURL(blob) { sources.push(blob); return 'blob:chart'; }, revokeObjectURL() {} },
    Image: class { set src(value) { if (value) this.onload(); } },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      return { getContext: () => ({ fillRect() {}, drawImage() {} }),
        toBlob(callback, type) { callback(new Blob(['pixels'], { type })); } };
    } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../activity-export.js'), 'utf8'), browser);
  for (const [mode, format] of [['vertical', 'png'], ['vertical', 'jpeg']]) {
    const output = await browser.BatActivityExport.exportBlob(rows, mode, format);
    assert.equal(output.mimeType, 'image/' + format);
    const svg = await sources.at(-1).text();
    assert.equal(columnRects(svg).length, 3);
    assert.match(svg, /Barres verticales/);
    assert.doesNotMatch(svg, /<circle|<path/);
  }
});

test('comparison bars and species labels expose escaped hover identities with separate before and after denominators', () => {
  const input = [
    { key: 'A', scientificName: 'Nyctalus noctula', frenchName: 'Noctule commune', before: 30, after: 10 },
    { key: 'B', scientificName: 'Myotis daubentonii', frenchName: 'Murin de Daubenton', before: 10, after: 40 }
  ];
  const output = Visuals.comparisonSvg(input).svg;
  const bars = [...output.matchAll(/<rect\b[^>]*>/g)].map(match => attributes(match[0]))
    .filter(item => item['data-species-tooltip'] === 'true');
  assert.equal(bars.length, 4);
  assert.deepEqual(bars.map(item => Number(item['data-contacts'])), [30, 10, 10, 40]);
  assert.deepEqual(bars.map(item => Number(item['data-percentage'])), [75, 20, 25, 80]);
  assert.deepEqual(bars.map(item => item['data-series-label']),
    ['Avant · AUTO-ID', 'Après · vérification manuelle', 'Avant · AUTO-ID', 'Après · vérification manuelle']);
  assert.equal(bars[0]['data-species-name'], 'Nyctalus noctula');
  assert.equal(bars[0]['data-french-name'], 'Noctule commune');
  const labels = [...output.matchAll(/<g\b[^>]*>/g)].map(match => attributes(match[0]))
    .filter(item => item['data-species-tooltip'] === 'true');
  assert.equal(labels.length, 2);
  assert.deepEqual(labels.map(item => Number(item['data-contacts'])), [10, 40]);
  assert.deepEqual(labels.map(item => Number(item['data-percentage'])), [20, 80]);
  const unsafe = Visuals.comparisonSvg([{ scientificName: '<img " onerror="x>', frenchName: 'A&B', before: 0, after: 0 }]).svg;
  assert.match(unsafe, /data-species-name="&lt;img &quot; onerror=&quot;x&gt;"/);
  assert.match(unsafe, /data-french-name="A&amp;B"/);
  assert.doesNotMatch(unsafe, /NaN|Infinity|<img|<image/);
});
