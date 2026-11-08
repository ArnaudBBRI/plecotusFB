const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../core.js');
const Chart = require('../activity-chart.js');
const Visuals = require('../final-summary-visuals.js');

const rows = [
  { scientificName: 'Myotis daubentonii', frenchName: 'Murin de Daubenton', isSpecies: true },
  { scientificName: 'Myotis sp.', frenchName: 'Murin indéterminé', isSpecies: false },
  { scientificName: 'NoID', frenchName: 'Chauve-souris non identifiée', isSpecies: false }
];
const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const visibleText = svg => [...svg.matchAll(/<text\b[^>]*>(.*?)<\/text>/gs)].map(match => decode(match[1]));

test('step-one CSV has exactly two spreadsheet-safe name columns with UTF-8 BOM and CRLF', () => {
  const input = [...rows,
    { scientificName: 'Libellé; "inconnu"', frenchName: 'Nom avec\nretour' },
    { scientificName: '=HYPERLINK("x")', frenchName: ' @libellé', contacts: 987654 },
    { scientificName: '\t+formule', frenchName: '-autre formule' }
  ];
  const original = structuredClone(input);
  const result = Visuals.namesCsv(input);
  assert.ok(result.startsWith('\ufeffNom scientifique;Nom vernaculaire\r\n'));
  assert.ok(result.endsWith('\r\n'));
  const parsed = Core.parseCSV(result, ';');
  assert.deepEqual(parsed.headers, ['Nom scientifique', 'Nom vernaculaire']);
  assert.deepEqual(parsed.records, [
    ['Myotis daubentonii', 'Murin de Daubenton'],
    ['Myotis sp.', 'Murin indéterminé'],
    ['NoID', 'Chauve-souris non identifiée'],
    ['Libellé; "inconnu"', 'Nom avec\nretour'],
    ['\'=HYPERLINK("x")', "' @libellé"],
    ["'\t+formule", "'-autre formule"]
  ]);
  assert.doesNotMatch(result, /Nombre de contacts|987654/);
  assert.deepEqual(input, original);
});

test('step-one SVG contains two name columns and provisional context without counts or final claims', () => {
  const input = rows.map(row => ({ ...row, contacts: 987654 }));
  const original = structuredClone(input);
  const result = Visuals.namesTableSvg(input, { fileName: 'sortie & étude.csv' });
  assert.equal(result.width, 1200);
  assert.ok(result.height > 200);
  assert.match(result.svg, /Espèces et catégories identifiées après l’étape 1/);
  assert.match(result.svg, /[Pp]rovisoire/);
  assert.match(result.svg, /meilleurs contacts/);
  assert.match(result.svg, /avant les contrôles complémentaires/);
  assert.match(result.svg, /sortie &amp; étude.csv/);
  assert.match(result.svg, /<rect width="1200" height="\d+" fill="#fff"/);
  const body = [...result.svg.matchAll(/<g data-table-row="\d+">(.*?)<\/g>/gs)];
  assert.deepEqual(body.map(match => visibleText(match[1])), [
    ['Myotis daubentonii', 'Murin de Daubenton'],
    ['Myotis sp.', 'Murin indéterminé'],
    ['NoID', 'Chauve-souris non identifiée']
  ]);
  assert.equal((result.svg.match(/font-style="italic"/g) || []).length, 1);
  assert.doesNotMatch(result.svg, /Nombre de contacts|987654|\btotal\b|effectifs|identifications finales|attributions calculées/i);
  assert.deepEqual(input, original);
});

test('step-one SVG wraps long Unicode names completely and grows to contain every row', () => {
  const scientificName = 'MyotisSansEspace'.repeat(28);
  const frenchName = 'Dénomination française très longue avec accents é à et 界 '.repeat(18);
  const input = [...rows, { scientificName, frenchName, isSpecies: true }];
  const result = Visuals.namesTableSvg(input);
  assert.ok(result.height > Visuals.namesTableSvg(rows).height + 200);
  const last = [...result.svg.matchAll(/<g data-table-row="\d+">(.*?)<\/g>/gs)].at(-1)[1];
  const printed = visibleText(last).join('').replace(/\s/g, '');
  assert.ok(printed.includes(scientificName));
  assert.ok(printed.includes(frenchName.replace(/\s/g, '')));
  const positions = [...result.svg.matchAll(/\by="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.ok(Math.max(...positions) < result.height);
  assert.doesNotMatch(result.svg, /…|\.\.\.|NaN|Infinity|foreignObject/);
});

test('step-one SVG escapes untrusted titles, source names and labels without adding markup', () => {
  const result = Visuals.namesTableSvg([
    { scientificName: '<script>&"bad"</script>', frenchName: "<img onerror='bad'>" }
  ], { title: '<image href="https://invalid.example"/>', fileName: 'source <svg>\u0001.csv' });
  assert.match(result.svg, /&lt;script&gt;&amp;&quot;bad&quot;&lt;\/script&gt;/);
  assert.match(result.svg, /&lt;img onerror=&#39;bad&#39;&gt;/);
  assert.match(result.svg, /&lt;image href=&quot;https:\/\/invalid\.example&quot;\/&gt;/);
  assert.match(result.svg, /source &lt;svg&gt;.csv/);
  assert.doesNotMatch(result.svg, /<script|<img|<image|<foreignObject|\u0001/);
});

test('empty step-one exports keep headings and explain the absence without displaying a zero total', async () => {
  assert.equal(Visuals.namesCsv([]), '\ufeffNom scientifique;Nom vernaculaire\r\n');
  const result = await Visuals.exportNamesTable([], 'svg');
  assert.equal(result.mimeType, 'image/svg+xml');
  const svg = await result.blob.text();
  assert.match(svg, /Nom scientifique/);
  assert.match(svg, /Nom vernaculaire/);
  assert.match(svg, /Aucune espèce ou catégorie identifiée/);
  assert.doesNotMatch(svg, /Nombre de contacts|0 contacts|\btotal\b|effectifs/i);
});

test('step-one exports reject malformed rows without requiring any contact counts', () => {
  for (const invalid of [null, {}, [null], [[]], new Array(1)]) {
    assert.throws(() => Visuals.namesCsv(invalid), TypeError);
    assert.throws(() => Visuals.namesTableSvg(invalid), TypeError);
  }
  assert.match(Visuals.namesTableSvg(rows).svg, /Myotis daubentonii/);
});

test('JPEG conversion rasterizes the same two-column step-one SVG with white background', async () => {
  const sources = [], canvasOperations = [];
  const browser = { BatReviewCore: Core, BatActivityChart: Chart, Intl, Blob, setTimeout, clearTimeout,
    URL: { createObjectURL(blob) { sources.push(blob); return 'blob:step-one'; }, revokeObjectURL() {} },
    Image: class { set src(value) { if (value) this.onload(); } },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      const context = { fillStyle: '', fillRect() { canvasOperations.push(['fill', this.fillStyle]); }, drawImage() { canvasOperations.push(['draw']); } };
      return { getContext: () => context,
        toBlob(callback, type) { callback(new Blob(['pixels'], { type })); } };
    } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../activity-export.js'), 'utf8'), browser);
  vm.runInNewContext(fs.readFileSync(require.resolve('../final-summary-visuals.js'), 'utf8'), browser);
  const output = await browser.PlecotusFinalSummaryVisuals.exportNamesTable(rows, 'jpeg', { fileName: 'source.csv' });
  assert.equal(output.mimeType, 'image/jpeg');
  assert.equal(output.extension, 'jpeg');
  const source = await sources[0].text();
  assert.match(source, /source.csv/);
  assert.match(source, /meilleurs contacts/);
  assert.equal((source.match(/data-table-row=/g) || []).length, 3);
  assert.doesNotMatch(source, /Nombre de contacts|\btotal\b|effectifs/i);
  assert.deepEqual(canvasOperations, [['fill', '#fff'], ['draw']]);
});

test('new names exports leave final three-column CSV and SVG semantics unchanged', () => {
  const final = [{ ...rows[0], contacts: 7 }];
  Visuals.namesCsv(rows);
  Visuals.namesTableSvg(rows);
  const csv = Core.parseCSV(Visuals.csv(final), ';');
  assert.deepEqual(csv.headers, ['Nom scientifique', 'Nom vernaculaire', 'Nombre de contacts']);
  assert.deepEqual(csv.records, [['Myotis daubentonii', 'Murin de Daubenton', '7']]);
  const svg = Visuals.tableSvg(final).svg;
  assert.match(svg, /Nombre de contacts/);
  assert.match(svg, /7 contacts hors bruit/);
  assert.match(svg, /identifications finales, y compris les attributions calculées/);
});
