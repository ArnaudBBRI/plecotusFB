const test = require('node:test');
const assert = require('node:assert/strict');
const Chart = require('../activity-chart.js');
const Names = require('../species.js');

const sample = [
  { scientificName: 'Pipistrellus pipistrellus', frenchName: 'Pipistrelle commune', contacts: 80, isSpecies: true, known: true },
  { scientificName: 'Myotis dasycneme', frenchName: 'Murin des marais', contacts: 10, isSpecies: true, known: true },
  { scientificName: 'Myotis sp.', frenchName: 'Murin indéterminé', contacts: 10, isSpecies: false, known: true }
];

test('preparation preserves the activity totals and gives exact proportions without mutating inputs', () => {
  const original = JSON.parse(JSON.stringify(sample));
  const data = Chart.prepare(sample);
  assert.equal(data.total, 100);
  assert.deepEqual(data.rows.map(row => row.contacts), [80, 10, 10]);
  assert.deepEqual(data.rows.map(row => row.percentage), [80, 10, 10]);
  assert.equal(data.rows.reduce((sum, row) => sum + row.proportion, 0), 1);
  assert.deepEqual(sample, original);
  assert.ok(data.rows.every(row => !sample.includes(row)));
  assert.equal(new Set(data.rows.map(row => row.color)).size, 3);
});

test('sorting is reproducible and does not merge precomputed rows or turn groups into species', () => {
  const forward = Chart.prepare(sample).rows;
  const reversed = Chart.prepare(sample.slice().reverse()).rows;
  assert.deepEqual(forward, reversed);
  assert.deepEqual(forward.map(row => row.scientificName), ['Pipistrellus pipistrellus', 'Myotis dasycneme', 'Myotis sp.']);
  assert.equal(forward[2].isSpecies, false);
  const duplicates = Chart.prepare([sample[0], sample[0]]);
  assert.equal(duplicates.rows.length, 2);
  assert.equal(duplicates.total, 160);
});

test('pie sectors carry their individual counts and percentages, with all activity rows retained', () => {
  const output = Chart.render(sample, 'pie');
  assert.equal((output.match(/class="activity-chart-slice"/g) || []).length, 3);
  assert.match(output, /Total : 100 contacts, hors Noise/);
  assert.match(output, /<title>Pipistrellus pipistrellus : 80 contacts \(80 %\)<\/title>/);
  assert.match(output, /<i class="activity-legend-name">Pipistrellus pipistrellus<\/i>/);
  assert.match(output, /<span class="activity-legend-name">Myotis sp\.<\/span>/);
  assert.match(output, /role="img"/);
  assert.match(output, /<desc>/);
  assert.equal(Chart.render(sample), output);
});

test('one species uses a full circle instead of a degenerate SVG arc', () => {
  const output = Chart.render([sample[0]], 'pie');
  assert.match(output, /<circle class="activity-chart-slice"/);
  assert.doesNotMatch(output, /<path/);
  assert.match(output, /80 contacts \(100 %\)/);
  assert.equal(Chart.prepare([sample[0]]).rows[0].proportion, 1);
});

test('a missing AUTO-ID column does not claim known Noise exclusion in the chart description', () => {
  const output = Chart.render([{ scientificName: 'Sans identification automatique', contacts: 3 }], 'pie', { hasAutoId: false });
  assert.match(output, /Total : 3 contacts\.<\/desc>/);
  assert.doesNotMatch(output, /hors Noise/);
});

test('bars use the same total denominator, names, values, and palette as the pie chart', () => {
  const output = Chart.render(sample, 'bar');
  assert.equal((output.match(/class="activity-bar-item"/g) || []).length, 3);
  for (const row of Chart.prepare(sample).rows) {
    assert.ok(output.includes(`width:${row.percentage}%;background:${row.color}`));
    assert.ok(output.includes(row.scientificName));
    assert.ok(output.includes(row.frenchName));
  }
  assert.doesNotMatch(output, /<svg/);
});

test('zero contacts and Noise are omitted before calculating shares, including all-noise inputs', () => {
  const input = [sample[0], { scientificName: 'Noise', contacts: 150 }, { scientificName: 'Bruit', contacts: 20 }, { scientificName: 'Myotis myotis', contacts: 0 }];
  const data = Chart.prepare(input);
  assert.equal(data.total, 80);
  assert.equal(data.rows.length, 1);
  assert.equal(data.rows[0].percentage, 100);
  assert.equal(Chart.prepare([{ scientificName: 'anything', category: 'noise', contacts: 99 }]).total, 0);
  for (const mode of ['pie', 'bar']) {
    const output = Chart.render(input.slice(1), mode);
    assert.match(output, /Aucun contact attribué/);
    assert.doesNotMatch(output, /NaN|Infinity|<svg/);
  }
  assert.equal(Chart.prepare().total, 0);
});

test('all five finalized NoID results appear independently in pies and bars and their percentage denominator', () => {
  const rows = Names.activityRows([
    ...Names.IDENTIFICATION_LABELS.map(({ label }, index) => ({ category: 'unresolved', label, total: index + 1 })),
    { category: 'taxon', label: 'MYODAS', total: 10 },
    { category: 'pending', label: 'NoID', total: 30 },
    { category: 'noise', label: 'Noise', total: 40 }
  ]);
  const data = Chart.prepare(rows);
  assert.equal(data.total, 25);
  assert.equal(data.rows.length, 6);
  for (const [index, label] of Names.IDENTIFICATION_LABELS.entries()) {
    const row = data.rows.find(row => row.scientificName === label.label);
    assert.equal(row.contacts, index + 1);
    assert.equal(row.percentage, (index + 1) * 4);
    assert.equal(row.isSpecies, false);
  }
  for (const mode of ['pie', 'bar']) {
    const output = Chart.render(rows, mode);
    assert.equal((output.match(new RegExp(mode === 'pie' ? 'class="activity-chart-slice"' : 'class="activity-bar-item"', 'g')) || []).length, 6);
    for (const { label, description } of Names.IDENTIFICATION_LABELS) {
      assert.ok(output.includes(`<span class="activity-legend-name">${label}</span>`));
      assert.ok(output.includes(description));
    }
    assert.doesNotMatch(output, /30 contacts|40 contacts|NaN|Infinity/);
  }
});

test('invalid counts fail explicitly instead of producing misleading proportions', () => {
  for (const contacts of [-1, NaN, Infinity, '10', null, undefined]) {
    assert.throws(() => Chart.prepare([{ scientificName: 'Example', contacts }]), RangeError);
  }
  assert.throws(() => Chart.prepare({ contacts: 10 }), TypeError);
  assert.throws(() => Chart.prepare([null]), TypeError);
});

test('untrusted CSV labels are escaped in SVG descriptions, titles, and both chart modes', () => {
  const rows = [{ scientificName: '<script>bad & "quoted"</script>', frenchName: "<img onerror='bad'>", contacts: 3 }];
  for (const mode of ['pie', 'bar']) {
    const output = Chart.render(rows, mode);
    assert.doesNotMatch(output, /<script>|<img /);
    assert.ok(output.includes('&lt;script&gt;bad &amp; &quot;quoted&quot;&lt;/script&gt;'));
    assert.ok(output.includes('&lt;img onerror=&#39;bad&#39;&gt;'));
  }
});

test('many species keep every row and every count in each chart mode', () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ scientificName: `Species ${index}`, frenchName: `Espèce ${index}`, contacts: index + 1 }));
  const data = Chart.prepare(rows);
  assert.equal(data.total, 820);
  assert.equal(data.rows.length, 40);
  assert.equal(new Set(data.rows.map(row => row.color)).size, 40);
  assert.equal((Chart.render(rows, 'pie').match(/class="activity-legend-item"/g) || []).length, 40);
  assert.equal((Chart.render(rows, 'bar').match(/class="activity-bar-item"/g) || []).length, 40);
});

test('multiple hidden categories are omitted together and restoring them preserves source counts', () => {
  const original = JSON.parse(JSON.stringify(sample));
  const hidden = new Set([Chart.rowKey(sample[0]), Chart.rowKey(sample[1])]);
  const selected = Chart.select(sample, hidden);
  assert.equal(selected.total, 10);
  assert.equal(selected.hiddenContacts, 90);
  assert.equal(selected.hiddenCount, 2);
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0].scientificName, 'Myotis sp.');
  assert.equal(selected.rows[0].percentage, 100);
  assert.equal(selected.legendRows.length, 3);
  assert.equal(selected.legendRows.filter(row => row.hidden).length, 2);
  hidden.delete(Chart.rowKey(sample[0]));
  assert.equal(Chart.select(sample, hidden).total, 90);
  hidden.clear();
  assert.equal(Chart.select(sample, hidden).total, 100);
  assert.deepEqual(sample, original);
});

test('interactive pie and bars retain hidden categories as native restoration buttons', () => {
  const hiddenKeys = new Set([Chart.rowKey(sample[0]), Chart.rowKey(sample[1])]);
  const title = 'Répartition des contacts selon les AUTO-ID';
  for (const mode of ['pie', 'bar']) {
    const output = Chart.render(sample, mode, { interactive: true, hiddenKeys, title });
    assert.equal((output.match(/<button type="button" class="activity-legend-toggle/g) || []).length, 3);
    assert.equal((output.match(/aria-pressed="false"/g) || []).length, 2);
    assert.equal((output.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(output, /aria-label="Afficher Pipistrellus pipistrellus"/);
    assert.match(output, /aria-label="Masquer Myotis sp\."/);
    assert.match(output, /<strong>80<\/strong><span>Masqué<\/span>/);
    assert.match(output, /<strong>10<\/strong><span>100 %<\/span>/);
    assert.match(output, /activity-chart-interactive/);
    assert.ok(output.includes(title));
    if (mode === 'pie') assert.equal((output.match(/class="activity-chart-slice"/g) || []).length, 1);
    else assert.equal((output.match(/class="activity-bar-track"/g) || []).length, 1);
  }
});

test('hiding every category keeps all legend controls available to restore the chart', () => {
  const hiddenKeys = new Set(sample.map(Chart.rowKey));
  const selected = Chart.select(sample, hiddenKeys);
  assert.equal(selected.total, 0);
  assert.equal(selected.hiddenContacts, 100);
  assert.equal(selected.hiddenCount, 3);
  assert.deepEqual(selected.rows, []);
  for (const mode of ['pie', 'bar']) {
    const output = Chart.render(sample, mode, { interactive: true, hiddenKeys });
    assert.match(output, /Aucune catégorie affichée\. Réactivez un élément de la légende\./);
    assert.equal((output.match(/data-chart-key=/g) || []).length, 3);
    assert.equal((output.match(/aria-pressed="false"/g) || []).length, 3);
    assert.doesNotMatch(output, /<svg|class="activity-bar-track"|NaN|Infinity/);
  }
});

test('filtering preserves the full palette when visible rows are prepared again for export', () => {
  const full = Chart.prepare(sample);
  const selected = Chart.select(sample, new Set([Chart.rowKey(sample[0])]));
  const exported = Chart.prepare(selected.rows);
  assert.equal(exported.total, 20);
  for (const row of exported.rows) {
    assert.equal(row.color, full.rows.find(source => Chart.rowKey(source) === Chart.rowKey(row)).color);
    assert.equal(row.percentage, 50);
    for (const mode of ['pie', 'bar']) assert.ok(Chart.render(selected.rows, mode).includes(row.color));
  }
  const many = Array.from({ length: 30 }, (_, index) => ({ scientificName: 'Species ' + index, contacts: 30 - index }));
  const manyFull = Chart.prepare(many);
  const last = manyFull.rows[29];
  assert.match(last.color, /^hsl\(/);
  const onlyLast = Chart.select(many, new Set(manyFull.rows.slice(0, -1).map(Chart.rowKey)));
  assert.equal(Chart.prepare(onlyLast.rows).rows[0].color, last.color);
});

test('legend keys and labels cannot inject markup and color overrides are constrained', () => {
  const source = { scientificName: '<img src=x onerror="bad">', frenchName: "A & B's", contacts: 3 };
  const hiddenKeys = new Set([Chart.rowKey(source)]);
  const output = Chart.render([source], 'pie', { interactive: true, hiddenKeys, title: '<script>title</script>' });
  assert.doesNotMatch(output, /<img |<script>| onerror="bad"/);
  assert.ok(output.includes('data-chart-key="[&quot;&lt;img src=x onerror=\\&quot;bad\\&quot;&gt;&quot;,&quot;A &amp; B&#39;s&quot;]"'));
  assert.match(output, /aria-pressed="false"/);
  assert.notEqual(Chart.rowKey({ scientificName: 'a,b', frenchName: 'c' }), Chart.rowKey({ scientificName: 'a', frenchName: 'b,c' }));
  for (const color of ['url(https://example.invalid/pixel)', '#000000" onclick="bad', 'red; background:url(x)']) {
    const row = Chart.prepare([{ scientificName: 'A', contacts: 1, color }]).rows[0];
    assert.equal(row.color, '#1b7663');
  }
  assert.equal(Chart.prepare([{ scientificName: 'A', contacts: 1, color: '#a1B2c3' }]).rows[0].color, '#a1B2c3');
});
