const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../core.js');
const Images = require('../activity-export.js');
const Visuals = require('../final-summary-visuals.js');

const comparisons = [
  { key: 'NYCNOC', code: 'NYCNOC', scientificName: 'Nyctalus noctula', frenchName: 'Noctule commune', before: 25, after: 15 },
  { key: 'MYODAU', code: 'MYODAU', scientificName: 'Myotis daubentonii', frenchName: 'Murin de Daubenton', before: 0, after: 10 },
  { key: 'MYODAS', code: 'MYODAS', scientificName: 'Myotis dasycneme', frenchName: 'Murin des marais', before: 8, after: 0 }
];
const table = comparisons.filter(row => row.after).map(row => ({ ...row, contacts: row.after, isSpecies: true }));

test('paired vertical bars keep new and disappeared species on a common zero-based integer count axis', () => {
  const source = structuredClone(comparisons);
  const result = Visuals.comparisonSvg(source);
  assert.ok(result.width >= 900);
  assert.match(result.svg, /axe des effectifs à partir de zéro/);
  assert.match(result.svg, /Avant · AUTO-ID/);
  assert.match(result.svg, /Après · vérification manuelle/);
  assert.equal((result.svg.match(/data-series="before"/g) || []).length, 3);
  assert.equal((result.svg.match(/data-series="after"/g) || []).length, 3);
  for (const row of comparisons) {
    assert.ok(result.svg.includes(row.scientificName));
    assert.ok(result.svg.includes(row.frenchName));
    assert.ok(result.svg.includes(row.code));
    assert.match(result.svg, new RegExp(`avant ${row.before} ; après ${row.after} contacts`));
  }
  assert.match(result.svg, /data-comparison-key="MYODAS" data-series="after"[^]*?height="0"/);
  assert.match(result.svg, /fill="#bf8a4a"/);
  assert.match(result.svg, /fill="#1b7663"/);
  assert.match(result.svg, /font-size="12" fill="#677066">0<\/text>/);
  assert.doesNotMatch(result.svg, /NaN|Infinity|foreignObject|<script|<image/);
  assert.deepEqual(source, comparisons);
});

test('many species retain readable label slots and every full label remains accessible', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ ...comparisons[0], key: String(index), code: 'ESP' + index }));
  const result = Visuals.comparisonSvg(many);
  assert.ok(result.width >= 40 * 100);
  assert.equal((result.svg.match(/data-series="before"/g) || []).length, 40);
  const long = 'Identificationtrèslongue'.repeat(8);
  const wrapped = Visuals.comparisonSvg([{ scientificName: long, frenchName: 'Description', before: 2, after: 1 }]);
  assert.ok(wrapped.height > result.height);
  assert.ok(wrapped.svg.includes(`<title>${long} · Description</title>`));
});

test('single and empty comparisons have finite dimensions and explicit empty text', () => {
  const empty = Visuals.comparisonSvg([]);
  const zero = Visuals.comparisonSvg([{ ...comparisons[0], before: 0, after: 0 }]);
  for (const result of [empty, zero]) {
    assert.ok(Number.isFinite(result.width));
    assert.ok(Number.isFinite(result.height));
    assert.doesNotMatch(result.svg, /NaN|Infinity/);
    assert.match(result.svg, new RegExp(`viewBox="0 0 ${result.width} ${result.height}"`));
  }
  assert.match(empty.svg, /Aucun contact hors bruit à représenter/);
});

test('comparison SVG escapes source labels and rejects corrupt count data', () => {
  const result = Visuals.comparisonSvg([{ key: '" onclick="x', scientificName: '<script>&"', frenchName: "L’espèce > inconnue", before: 1, after: 2 }]);
  assert.doesNotMatch(result.svg, /<script>|onclick="x/);
  assert.match(result.svg, /&lt;script&gt;&amp;&quot;/);
  for (const value of [-1, NaN, Infinity, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => Visuals.comparisonSvg([{ before: value, after: 1 }]), /entier/);
    assert.throws(() => Visuals.tableSvg([{ contacts: value }]), /entier/);
    assert.throws(() => Visuals.csv([{ contacts: value }]), /entier/);
  }
  assert.throws(() => Visuals.comparisonSvg(new Array(1)), /entier/);
});

test('CSV preserves French names and quoted cells with exactly the requested three columns', () => {
  const rows = [
    { scientificName: 'Nyctalus noctula', frenchName: 'Noctule commune', contacts: 15 },
    { scientificName: 'Libellé; "inconnu"', frenchName: 'Texte avec\nretour', contacts: 3 },
    { scientificName: '=HYPERLINK("x")', frenchName: '@libellé', contacts: 2 }
  ];
  const original = structuredClone(rows);
  const result = Visuals.csv(rows);
  assert.ok(result.startsWith('\ufeff'));
  const decoded = Core.parseCSV(result, ';');
  assert.deepEqual(decoded.headers, ['Nom scientifique', 'Nom vernaculaire', 'Nombre de contacts']);
  assert.deepEqual(decoded.records, [
    ['Nyctalus noctula', 'Noctule commune', '15'],
    ['Libellé; "inconnu"', 'Texte avec\nretour', '3'],
    ['\'=HYPERLINK("x")', "'@libellé", '2']
  ]);
  assert.deepEqual(rows, original);
});

test('SVG table wraps all labels without truncation and preserves names and counts beyond the viewport', () => {
  const long = 'MotSansEspace'.repeat(26);
  const rows = [...table, { scientificName: long, frenchName: 'Libellé français avec accents « à é è » '.repeat(12), contacts: 9 }];
  const result = Visuals.tableSvg(rows, { fileName: 'fichier; & étude.csv' });
  assert.equal(result.width, 1200);
  assert.equal((result.svg.match(/data-table-row=/g) || []).length, 3);
  assert.match(result.svg, /34 contacts hors bruit/);
  assert.match(result.svg, /fichier; &amp; étude.csv/);
  assert.match(result.svg, /Nom scientifique/);
  assert.match(result.svg, /Nom vernaculaire/);
  assert.match(result.svg, /Nombre de contacts/);
  assert.match(result.svg, /font-style="italic"/);
  assert.ok(result.svg.includes(long), 'full label remains in the description even when the visible label wraps');
  const drawn = result.svg.match(/<text[^>]*>(.*?)<\/text>/gs).map(match => match.replace(/<[^>]*>/g, ''));
  assert.ok(drawn.join('').includes(long));
  assert.doesNotMatch(result.svg, /foreignObject|<script|<image|…|\.\.\./);
  assert.ok(result.height > Visuals.tableSvg(table).height + 120);
});

test('empty final table remains an exportable document with headings and zero total', async () => {
  const svg = Visuals.tableSvg([]);
  assert.match(svg.svg, /Aucun contact hors bruit/);
  assert.match(svg.svg, /0 contacts hors bruit/);
  assert.equal(Core.parseCSV(Visuals.csv([]), ';').records.length, 0);
  const exported = await Visuals.exportTable([], 'svg');
  assert.equal(exported.mimeType, 'image/svg+xml');
  assert.equal(exported.extension, 'svg');
  assert.match(await exported.blob.text(), /Nom scientifique/);
});

test('SVG and browser raster wrappers share authored geometry and reject unavailable raster formats clearly', async () => {
  const tableExport = await Visuals.exportTable(table, 'svg');
  const graphExport = await Visuals.exportComparison(comparisons, 'svg');
  assert.match(await tableExport.blob.text(), /Nyctalus noctula/);
  assert.match(await graphExport.blob.text(), /data-series="after"/);
  await assert.rejects(() => Visuals.exportTable(table, 'png'), /nécessite un navigateur/);
  await assert.rejects(() => Visuals.exportTable(table, 'gif'), /Format image non pris en charge/);
  const browser = { BatReviewCore: Core, BatActivityExport: Images, Intl, Blob };
  vm.runInNewContext(fs.readFileSync(require.resolve('../final-summary-visuals.js'), 'utf8'), browser);
  assert.equal(typeof browser.PlecotusFinalSummaryVisuals.comparisonSvg, 'function');
  assert.match(browser.PlecotusFinalSummaryVisuals.csv(table), /Noctule commune/);
  assert.equal((await browser.PlecotusFinalSummaryVisuals.exportTable(table, 'svg')).mimeType, 'image/svg+xml');
});
