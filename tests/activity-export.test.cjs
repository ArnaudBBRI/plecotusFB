const test = require('node:test');
const assert = require('node:assert/strict');
const Chart = require('../activity-chart.js');
const Export = require('../activity-export.js');
const Species = require('../species.js');

const sample = [
  { scientificName: 'Pipistrellus pipistrellus', frenchName: 'Pipistrelle commune', contacts: 80, isSpecies: true },
  { scientificName: 'Myotis dasycneme', frenchName: 'Murin des marais', contacts: 10, isSpecies: true },
  { scientificName: 'Myotis sp.', frenchName: 'Murin indéterminé', contacts: 10 }
];

test('autonomous pie SVG preserves every label, count and palette without mutating activity rows', () => {
  const original = structuredClone(sample);
  const result = Export.svg(sample, 'pie', { ignoredNoise: 7, totalContacts: 107, pendingContacts: 0 });
  assert.equal(result.width, 1200);
  assert.ok(result.height > 500);
  assert.match(result.svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(result.svg, new RegExp(`viewBox="0 0 ${result.width} ${result.height}"`));
  assert.match(result.svg, /fill="#fff"/);
  assert.match(result.svg, /100 contacts représentés \(hors Noise\)/);
  assert.match(result.svg, /7 Noise ignorés · 107 contacts dans le fichier/);
  assert.match(result.svg, /Bilan final/);
  assert.equal((result.svg.match(/data-series=/g) || []).length, 3);
  assert.equal((result.svg.match(/data-legend=/g) || []).length, 3);
  for (const row of Chart.prepare(sample).rows) {
    assert.ok(result.svg.includes(row.scientificName));
    assert.ok(result.svg.includes(row.frenchName));
    assert.ok(result.svg.includes(`fill="${row.color}"`));
    assert.ok(result.svg.includes(`${row.contacts} contacts (${row.percentage} %)`));
  }
  assert.match(result.svg, /font-style="italic"/);
  assert.doesNotMatch(result.svg, /foreignObject|<style|<script|https:\/\//);
  assert.deepEqual(sample, original);
});

test('bars share the pie denominator and include all original scientific and French labels', () => {
  const result = Export.svg(sample, 'bar');
  assert.match(result.svg, /Graphique en barres/);
  assert.equal((result.svg.match(/data-series=/g) || []).length, 3);
  for (const [index, row] of Chart.prepare(sample).rows.entries()) {
    assert.ok(result.svg.includes(`data-series="${index}"`));
    assert.ok(result.svg.includes(`width="${1120 * row.proportion}"`));
    assert.ok(result.svg.includes(row.frenchName));
  }
  assert.match(result.svg, /80 contacts · 80 %/);
  assert.match(result.svg, /10 contacts · 10 %/);
  assert.doesNotMatch(result.svg, /<path|NaN|Infinity/);
});

test('single species draws a full circle and empty or all Noise inputs have a clear empty state', () => {
  assert.match(Export.svg([sample[0]]).svg, /<circle data-series="0"/);
  assert.match(Export.svg([sample[0]]).svg, /80 contacts \(100 %\)/);
  for (const mode of ['pie', 'bar']) {
    const result = Export.svg([{ scientificName: 'Noise', contacts: 99 }], mode);
    assert.match(result.svg, /0 contacts représentés \(hors Noise\)/);
    assert.match(result.svg, /Aucun contact attribué à une espèce/);
    assert.doesNotMatch(result.svg, /data-series=|data-legend=|NaN|Infinity/);
    assert.ok(result.height > 200);
  }
});

test('Noise and zero counts never enter percentages, totals or species legends', () => {
  const input = [...sample, { scientificName: 'Noise', contacts: 500 }, { scientificName: 'Bruit', contacts: 30 }, { scientificName: 'ignored', category: 'noise', contacts: 20 }, { scientificName: 'zero', contacts: 0 }];
  for (const mode of ['pie', 'bar']) {
    const result = Export.svg(input, mode);
    assert.equal((result.svg.match(/data-legend=/g) || []).length, 3);
    assert.match(result.svg, /100 contacts représentés/);
    assert.match(result.svg, /80 contacts \(80 %\)/);
    assert.doesNotMatch(result.svg, /500 contacts|30 contacts|20 contacts|data-legend="zero"/);
  }
});

test('untrusted labels and titles cannot add markup, event handlers or external resources', () => {
  const row = { scientificName: '<script>bad & "quoted"</script>', frenchName: "<img onerror='bad'>", contacts: 3 };
  for (const mode of ['pie', 'bar']) {
    const result = Export.svg([row], mode, { title: '<image href="https://invalid.example"/>\u0001' });
    assert.doesNotMatch(result.svg, /<script|<img|<image|\u0001/);
    assert.match(result.svg, /&lt;script&gt;bad &amp; &quot;quoted&quot;&lt;\/script&gt;/);
    assert.match(result.svg, /&lt;img onerror=&#39;bad&#39;&gt;/);
    assert.match(result.svg, /&lt;image href=&quot;https:\/\/invalid\.example&quot;\/&gt;/);
  }
});

test('large legends grow instead of dropping rows and long words wrap without losing text', () => {
  const longWord = 'W'.repeat(160);
  const rows = Array.from({ length: 65 }, (_, i) => ({ scientificName: `${longWord} taxon${i}`, frenchName: `Dénomination française complète pour l’espèce numéro ${i}`, contacts: i + 1 }));
  for (const mode of ['pie', 'bar']) {
    const result = Export.svg(rows, mode);
    assert.equal((result.svg.match(/data-series=/g) || []).length, rows.length);
    assert.equal((result.svg.match(/data-legend=/g) || []).length, rows.length);
    assert.ok(result.height > 5000);
    for (let i = 0; i < rows.length; i++) assert.ok(result.svg.includes(`taxon${i}`));
    assert.doesNotMatch(result.svg, /…/);
    const ys = [...result.svg.matchAll(/\by="([0-9.]+)"/g)].map(match => Number(match[1]));
    assert.ok(Math.max(...ys) < result.height);
    assert.match(result.svg, /2\s145 contacts représentés/);
  }
  assert.ok(Export.svg(rows, 'pie').height < Export.svg(rows, 'bar').height / 2);
});

function compactLegend(svg) {
  return [...svg.matchAll(/<g data-legend="([^"]*)" data-legend-row="(\d+)" data-legend-column="(\d+)">([\s\S]*?)<\/g>/g)].map(match => ({
    label: match[1], row: Number(match[2]), column: Number(match[3]), markup: match[4],
    texts: [...match[4].matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)].map(text => ({
      attributes: text[1], value: text[2], y: Number(text[1].match(/\by="([^"]+)"/)[1])
    }))
  }));
}

test('29 real species use three aligned compact columns below a centered pie', () => {
  const input = Species.SPECIES.slice(0, 29).map((row, index) => ({ ...row, contacts: index + 1 }));
  const prepared = Chart.prepare(input), result = Export.svg(input, 'pie');
  const legend = compactLegend(result.svg);
  assert.equal(result.width, 1200);
  assert.ok(result.height >= 1000 && result.height < 1400);
  assert.match(result.svg, /data-series="0" d="M 600 /);
  assert.equal(legend.length, 29);
  assert.equal((result.svg.match(/data-series=/g) || []).length, 29);
  assert.equal(new Set(legend.map(entry => entry.row)).size, 10);
  for (const [index, entry] of legend.entries()) {
    const row = prepared.rows[index];
    assert.equal(entry.label, row.scientificName);
    assert.equal(entry.row, Math.floor(index / 3));
    assert.equal(entry.column, index % 3);
    assert.ok(entry.markup.includes(`fill="${row.color}"`));
    assert.ok(entry.markup.includes(row.scientificName));
    assert.ok(entry.markup.includes(row.frenchName));
    const value = entry.texts.at(-1);
    assert.match(value.value, /contacts · .* %$/);
    assert.equal(value.y - entry.texts.at(-2).y, 22);
    assert.ok(value.y < result.height);
    const sameRow = legend.filter(candidate => candidate.row === entry.row);
    assert.ok(sameRow.every(candidate => candidate.texts[0].y === entry.texts[0].y));
    const nextRow = legend.find(candidate => candidate.row === entry.row + 1);
    if (nextRow) assert.ok(nextRow.texts[0].y - Math.max(...sameRow.map(candidate => candidate.texts.at(-1).y)) >= 28);
  }
  assert.match(result.svg, /435 contacts représentés \(hors Noise\)/);
  assert.doesNotMatch(result.svg, /font-size="(?:[0-9]|1[0-3])"|…/);
});

test('compact 65-species legend keeps sorted counts, palette and all rows instead of summarizing small shares', () => {
  const rows = Array.from({ length: 65 }, (_, index) => ({
    ...Species.SPECIES[index % Species.SPECIES.length],
    scientificName: `Taxon ${index} — ${Species.SPECIES[index % Species.SPECIES.length].scientificName}`,
    contacts: index + 1
  }));
  const result = Export.svg(rows, 'pie'), prepared = Chart.prepare(rows), legend = compactLegend(result.svg);
  assert.equal(legend.length, 65);
  assert.equal((result.svg.match(/data-series=/g) || []).length, 65);
  assert.equal(new Set(legend.map(entry => entry.row)).size, 22);
  assert.ok(result.height < 2800);
  assert.match(result.svg, /2\s145 contacts représentés/);
  for (const [index, entry] of legend.entries()) {
    assert.equal(entry.label, prepared.rows[index].scientificName);
    assert.ok(entry.markup.includes(`fill="${prepared.rows[index].color}"`));
    assert.ok(entry.texts.at(-1).value.startsWith(`${prepared.rows[index].contacts} contacts`));
  }
  assert.doesNotMatch(result.svg, /Autres|…|NaN|Infinity/);
});

test('compact long Unicode labels wrap completely with values below names, without truncation or markup', () => {
  const scientificName = `W${'W'.repeat(159)} taxon<> & "quoted"`;
  const frenchName = `${'界'.repeat(50)} Dénomination française très longue pour l’espèce à identifier`;
  const rows = Array.from({ length: 9 }, (_, index) => ({ scientificName: scientificName + index, frenchName, contacts: index + 1 }));
  const result = Export.svg(rows, 'pie'), legend = compactLegend(result.svg);
  const decode = value => value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  assert.equal(legend.length, 9);
  for (const entry of legend) {
    const names = entry.texts.slice(0, -1);
    const scientific = names.filter(line => /fill="#17352e"/.test(line.attributes)).map(line => decode(line.value)).join('');
    const french = names.filter(line => /fill="#607269"/.test(line.attributes)).map(line => decode(line.value)).join('');
    assert.equal(scientific.replace(/\s/g, ''), decode(entry.label).replace(/\s/g, ''));
    assert.equal(french.replace(/\s/g, ''), frenchName.replace(/\s/g, ''));
    assert.ok(names.length > 8);
    assert.equal(entry.texts.at(-1).y - names.at(-1).y, 22);
    assert.ok(entry.texts.at(-1).y < result.height);
  }
  assert.doesNotMatch(result.svg, /<script|<foreignObject|…/);
});

test('compact layout starts only above eight species and bars retain their original geometry', () => {
  const rows = Species.SPECIES.slice(0, 9).map((row, index) => ({ ...row, contacts: index + 1 }));
  assert.doesNotMatch(Export.svg(rows.slice(0, 8), 'pie').svg, /data-legend-layout="grid"/);
  assert.match(Export.svg(rows.slice(0, 8), 'pie').svg, /data-series="0" d="M 220 /);
  assert.match(Export.svg(rows, 'pie').svg, /data-legend-layout="grid"/);
  const bars = Export.svg(rows, 'bar');
  assert.doesNotMatch(bars.svg, /data-legend-layout="grid"|data-legend-column=/);
  for (const [index, row] of Chart.prepare(rows).rows.entries()) {
    assert.ok(bars.svg.includes(`data-series="${index}" x="40"`));
    assert.ok(bars.svg.includes(`width="${1120 * row.proportion}"`));
  }
});

test('provisional and imported Noise counters are included without changing chart geometry', () => {
  const final = Export.svg(sample, 'bar');
  const pending = Export.svg(sample, 'bar', { ignoredNoise: 4, totalContacts: 110, pendingContacts: 6, provisional: true });
  assert.match(pending.svg, /Bilan provisoire/);
  assert.match(pending.svg, /6 contacts en attente de classification/);
  assert.match(pending.svg, /100 contacts représentés/);
  const widths = output => [...output.matchAll(/data-series="\d+"[^>]*width="([^\"]+)"/g)].map(match => match[1]);
  assert.deepEqual(widths(pending.svg), widths(final.svg));
  for (const ignoredNoise of [-1, NaN, Infinity, '2']) assert.throws(() => Export.svg(sample, 'pie', { ignoredNoise }), RangeError);
});

test('filtered pie and bars recalculate the visible denominator and visibly annotate excluded common pipistrelle', () => {
  const original = structuredClone(sample);
  const filtered = Species.chartRows(sample, false);
  for (const mode of ['pie', 'bar']) {
    const result = Export.svg(filtered.rows, mode, { excludedCommonPipistrelle: filtered.omittedContacts, totalContacts: 100 });
    assert.match(result.svg, /20 contacts représentés \(hors Noise\)/);
    assert.match(result.svg, /Pipistrelle commune exclue du graphique : 80 contacts\./);
    assert.match(result.svg, /<text[^>]*>Pipistrelle commune exclue du graphique : 80 contacts\.<\/text>/);
    assert.equal((result.svg.match(/data-series=/g) || []).length, 2);
    assert.match(result.svg, /10 contacts \(50 %\)/);
    assert.doesNotMatch(result.svg, /data-legend="Pipistrellus pipistrellus"|80 %/);
    assert.match(result.svg, /100 contacts dans le fichier/);
  }
  assert.deepEqual(sample, original);
});

test('exclusion annotation is absent by default but documents an explicitly excluded species even with zero contacts', () => {
  assert.doesNotMatch(Export.svg(sample, 'pie').svg, /commune exclue/);
  assert.match(Export.svg(sample, 'bar', { excludedCommonPipistrelle: 0 }).svg, /Pipistrelle commune exclue du graphique : 0 contacts\./);
  for (const excludedCommonPipistrelle of [-1, NaN, Infinity, '80']) {
    assert.throws(() => Export.svg(sample, 'pie', { excludedCommonPipistrelle }), RangeError);
  }
});

test('only common pipistrelle leaves an annotated empty graphic without invented percentages', () => {
  const filtered = Species.chartRows([sample[0]], false);
  const result = Export.svg(filtered.rows, 'pie', { excludedCommonPipistrelle: filtered.omittedContacts });
  assert.match(result.svg, /0 contacts représentés/);
  assert.match(result.svg, /Pipistrelle commune exclue du graphique : 80 contacts\./);
  assert.match(result.svg, /Aucun contact attribué à une espèce/);
  assert.doesNotMatch(result.svg, /data-series=|NaN|Infinity|100 %/);
});

test('SVG download works without canvas and raster errors do not prevent a later SVG export', async () => {
  const result = await Export.exportBlob(sample, 'pie', 'svg');
  assert.equal(result.mimeType, 'image/svg+xml');
  assert.equal(result.extension, 'svg');
  assert.equal(result.blob.type, 'image/svg+xml');
  assert.match(await result.blob.text(), /Pipistrellus pipistrellus/);
  await assert.rejects(() => Export.exportBlob(sample, 'pie', 'png'), /nécessite un navigateur/);
  await assert.rejects(() => Export.exportBlob(sample, 'bar', 'gif'), /Format image non pris en charge/);
  assert.equal((await Export.exportBlob(sample, 'bar', 'svg')).extension, 'svg');
});
