const test = require('node:test');
const assert = require('node:assert/strict');
const Chart = require('../activity-chart.js');

const rows = [
  { scientificName: 'Pipistrellus pipistrellus', frenchName: 'Pipistrelle commune', contacts: 80, isSpecies: true },
  { scientificName: 'Myotis dasycneme', frenchName: 'Murin des marais', contacts: 20, isSpecies: true }
];
const shapes = output => [...output.matchAll(/<rect\b[^>]*class="activity-column"[^>]*>/g)].map(match => {
  const attributes = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(item => [item[1], item[2]]));
  return { ...attributes, x: Number(attributes.x), y: Number(attributes.y), width: Number(attributes.width), height: Number(attributes.height) };
});

test('only the three supported modes remain and obsolete histogram requests fall back to pie', () => {
  assert.deepEqual(Chart.MODES, ['pie', 'bar', 'vertical']);
  assert.equal(Chart.normalizeMode('histogram'), 'pie');
  assert.equal(Chart.render(rows, 'histogram'), Chart.render(rows, 'pie'));
  assert.doesNotMatch(Chart.render(rows, 'histogram'), /Histogramme|activity-column/);
});

test('vertical mode plots contact counts from a shared zero baseline', () => {
  for (const mode of ['vertical']) {
    const output = Chart.render(rows, mode);
    const columns = shapes(output);
    assert.equal(columns.length, 2, mode + ' must render one SVG column per species');
    assert.equal(columns[0].height / columns[1].height, 4);
    assert.equal(columns[0].y + columns[0].height, columns[1].y + columns[1].height);
    assert(columns.every(column => column.height > 0 && column.width > 0));
    assert.match(output, /Contacts/);
    assert.match(output, /class="activity-column-tick"[^>]*>0<\/text>/);
    assert.match(output, /Total : 100 contacts/);
    assert.match(output, /aria-label="Espèces et nombres de contacts"/);
    assert.equal(columns[0]['data-contacts'], '80');
    assert.equal(columns[0]['data-percentage'], '80');
    assert.equal(columns[0]['data-species-name'], 'Pipistrellus pipistrellus');
    const valueLabels = [...output.matchAll(/<text class="activity-column-value"[^>]* y="([^"]+)"[^>]*>/g)];
    assert.equal(valueLabels.length, 2);
    assert(Number(valueLabels[0][1]) < columns[0].y, 'the largest count stays readable above its colored column');
  }
});

test('vertical bars retain visible spacing', () => {
  const separate = shapes(Chart.render(rows, 'vertical'));
  assert.equal(separate.length, 2);
  assert(separate[0].x + separate[0].width < separate[1].x);
});

test('vertical mode keeps hidden categories in its numbered legend and recalculates visible proportions without changing colors', () => {
  const original = structuredClone(rows);
  for (const mode of ['vertical']) {
    const output = Chart.render(rows, mode, { interactive: true, hiddenKeys: new Set([Chart.rowKey(rows[0])]) });
    const columns = shapes(output);
    assert.equal(columns.length, 1);
    assert.equal(columns[0]['data-species-name'], 'Myotis dasycneme');
    assert.equal(columns[0]['data-percentage'], '100');
    assert.equal(columns[0].fill, '#d78631');
    assert.equal((output.match(/data-chart-key=/g) || []).length, 2);
    assert.equal((output.match(/aria-pressed="false"/g) || []).length, 1);
    assert.equal((output.match(/aria-pressed="true"/g) || []).length, 1);
    assert.match(output, /Masqué/);
    assert.match(output, /activity-legend-number/);
  }
  assert.deepEqual(rows, original);
});

test('many species retain numbered axis labels and a complete readable legend in a keyboard-scrollable region', () => {
  const many = Array.from({ length: 31 }, (_, index) => ({ scientificName: 'Species ' + index,
    frenchName: 'Espèce complète ' + index, contacts: index + 1 }));
  for (const mode of ['vertical']) {
    const output = Chart.render(many, mode, { interactive: true });
    assert.equal(shapes(output).length, 31);
    assert.equal((output.match(/class="activity-column-label"/g) || []).length, 31);
    assert.equal((output.match(/class="activity-legend-number"/g) || []).length, 31);
    assert.match(output, /class="activity-columns-scroll"[^>]*tabindex="0"/);
    assert.match(output, /min-width:\d+px/);
    for (let index = 0; index < many.length; index++) {
      assert.ok(output.includes('Species ' + index));
      assert.ok(output.includes('Espèce complète ' + index));
    }
  }
});

test('every chart mode exposes safe tooltip identity on shapes and legends without making shapes category toggles', () => {
  for (const mode of ['pie', 'bar', 'vertical']) {
    const output = Chart.render(rows, mode, { interactive: true, seriesLabel: 'Avant AUTO-ID' });
    assert.match(output, /data-species-tooltip="true"/);
    assert.match(output, /data-species-name="Pipistrellus pipistrellus"/);
    assert.match(output, /data-french-name="Pipistrelle commune"/);
    assert.match(output, /data-contacts="80"/);
    assert.match(output, /data-percentage="80"/);
    assert.match(output, /data-series-label="Avant AUTO-ID"/);
    assert.equal((output.match(/data-chart-key=/g) || []).length, 2, 'only the legend buttons toggle filtering');
    for (const shape of output.matchAll(/<(?:path|circle|rect)\b[^>]*class="(?:activity-chart-slice|activity-column)"[^>]*>/g)) {
      assert.match(shape[0], /tabindex="0"/);
      assert.match(shape[0], /data-species-tooltip="true"/);
      assert.doesNotMatch(shape[0], /data-chart-key=/);
    }
    if (mode === 'bar') {
      assert.match(output, /class="activity-bar-item"[^>]*data-species-tooltip="true"/);
      assert.match(output, /class="activity-bar-track"[^>]*data-species-tooltip="true"/);
    }
  }
  assert.match(Chart.render([rows[0]], 'pie'), /<circle[^>]*data-species-tooltip="true"[^>]*tabindex="0"/);
});

test('vertical mode handles empty, single and fully hidden inputs without nonfinite coordinates', () => {
  for (const mode of ['vertical']) {
    assert.match(Chart.render([], mode), /Aucun contact attribué/);
    const single = Chart.render([rows[0]], mode);
    assert.equal(shapes(single).length, 1);
    assert.doesNotMatch(single, /NaN|Infinity/);
    const hidden = Chart.render(rows, mode, { interactive: true, hiddenKeys: new Set(rows.map(Chart.rowKey)) });
    assert.equal(shapes(hidden).length, 0);
    assert.match(hidden, /Aucune catégorie affichée/);
    assert.equal((hidden.match(/data-chart-key=/g) || []).length, 2);
    assert.doesNotMatch(hidden, /NaN|Infinity/);
    const huge = Chart.render([{ scientificName: 'Large', contacts: Number.MAX_VALUE }], mode);
    assert.equal(shapes(huge).length, 1);
    assert.doesNotMatch(huge, /NaN|Infinity/);
  }
});

test('tooltip metadata and new chart labels cannot introduce markup, event handlers or remote photo URLs', () => {
  const malicious = [{ scientificName: '\"><img src=x onerror="bad">', frenchName: "A & B's <script>",
    contacts: 1, photoUrl: 'https://attacker.invalid/track.png', color: 'url(https://attacker.invalid/color)' }];
  for (const mode of ['pie', 'bar', 'vertical']) {
    const output = Chart.render(malicious, mode, { interactive: true, seriesLabel: '\"><svg onload="bad">' });
    assert.doesNotMatch(output, /<img|<script>|<svg onload|https:\/\/attacker|onerror="bad"/);
    assert.match(output, /data-species-name="&quot;&gt;&lt;img src=x onerror=&quot;bad&quot;&gt;"/);
    assert.match(output, /data-french-name="A &amp; B&#39;s &lt;script&gt;"/);
    assert.match(output, /data-series-label="&quot;&gt;&lt;svg onload=&quot;bad&quot;&gt;"/);
  }
});
