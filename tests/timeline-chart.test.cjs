const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Images = require('../activity-export.js');
const Timeline = require('../timeline-data.js');

function chart() {
  const file = path.join(__dirname, '..', 'timeline-chart.js');
  assert.ok(fs.existsSync(file), 'the contact timeline chart module exists');
  return require(file);
}
const hour = 3600000;
function data(values = [2, 0, 4], intervalMs = hour) {
  const start = Date.UTC(2026, 10, 8, 22);
  const bins = values.map((contacts, index) => ({ start: start + index * intervalMs,
    end: start + (index + 1) * intervalMs, contacts }));
  return { bins, intervalMs, total: values.reduce((a, b) => a + b, 0), sourceContacts: 10,
    noiseCount: 1, invalidDateTimeCount: 3, hasAutoId: true, missingColumns: [],
    start: bins.length ? start : null, end: bins.at(-1)?.end ?? null };
}

test('timeline geometry preserves chronological spacing, zero gaps and proportional counts without smoothing', () => {
  const Chart = chart();
  const source = data();
  const before = structuredClone(source);
  const result = Chart.svg(source);
  const points = [...result.svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"/g)].map(match => match.slice(1).map(Number));
  assert.equal(points.length, 3);
  assert.ok(Math.abs((points[1][0] - points[0][0]) - (points[2][0] - points[1][0])) < .01);
  assert.ok(Math.abs((points[1][1] - points[0][1]) * 2 - (points[1][1] - points[2][1])) < .01);
  assert.match(result.svg, /data-timeline-index="1"/);
  assert.match(result.svg, /09\/11\/2026 00:00/);
  assert.match(result.svg, /08\/11\/2026 23:00/);
  assert.match(result.svg, /0 contact/);
  const paths = [...result.svg.matchAll(/<path\b[^>]*d="([^"]*)"[^>]*>/g)];
  assert.ok(paths.some(match => / Z$/.test(match[1])), 'the area closes below the line');
  for (const path of paths) assert.doesNotMatch(path[1], /[CSQ]\s*[\d.-]/);
  assert.doesNotMatch(result.svg, /NaN|Infinity|<image|<script/);
  assert.deepEqual(source, before);
});

test('integer zero-based ticks, source clock dates and bounded labels remain readable for a long chronology', () => {
  const Chart = chart();
  const source = data(Array.from({ length: 720 }, (_, index) => index % 3), 24 * hour);
  const result = Chart.svg(source);
  assert.ok(result.width >= 560);
  assert.ok(result.width <= 1600, 'many bins do not create an impractically wide export');
  assert.equal((result.svg.match(/data-timeline-index=/g) || []).length, 720);
  const ticks = [...result.svg.matchAll(/class="timeline-y-tick"[^>]*>([^<]+)<\/text>/g)].map(match => match[1]);
  assert.ok(ticks.includes('0'));
  assert.ok(ticks.every(value => /^\d+$/.test(value)), 'contacts axis does not invent fractional counts');
  assert.ok((result.svg.match(/class="timeline-x-tick"/g) || []).length <= 8);
  assert.match(Chart.caption(source), /24 h|1 jour/);
  assert.match(Chart.caption(source), /sans conversion de fuseau horaire/);
});

test('fixed ten-minute sparse gaps stay flat at zero with true chronological spacing and complete exports', () => {
  const Chart = chart();
  const start = Date.UTC(2026, 10, 8), intervalMs = 600000;
  const source = { ...data([], intervalMs), total: 7, sparse: true, binCount: 1001,
    start, end: start + 1001 * intervalMs,
    bins: [[0, 2], [1, 0], [999, 0], [1000, 5]].map(([index, contacts]) =>
      ({ start: start + index * intervalMs, end: start + (index + 1) * intervalMs, contacts })) };
  const original = structuredClone(source);
  const result = Chart.svg(source, { fileName: 'longue.csv' });
  const points = [...result.svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"/g)].map(match => match.slice(1).map(Number));
  assert.equal(points.length, 4);
  assert.equal(points[1][1], points[2][1], 'compressed empty time stays exactly on the zero baseline');
  assert(Math.abs((points[1][0] - points[0][0]) * 1000 - (points[3][0] - points[0][0])) < .00001);
  assert.match(Chart.caption(source), /10 min/);
  assert.match(Chart.caption(source), /plages.*zéro.*bornes/i);
  assert.match(result.svg, /7 contacts/);
  assert.match(result.svg, /fin exclue/);
  const labels = [...result.svg.matchAll(/class="timeline-x-tick" x="([\d.]+)"/g)].map(match => Number(match[1]));
  assert.equal(labels.length, 6);
  assert(labels.slice(1).every((x, index) => Math.abs(x - labels[index] - (labels[1] - labels[0])) < .00001));
  assert.doesNotMatch(result.svg, /NaN|Infinity/);
  assert.deepEqual(source, original);
});

test('the actual fixed-bin data renders extreme dates and more than 720 occupied bins without widening intervals', () => {
  const Chart = chart();
  const imported = { headers: ['DATE', 'TIME'], records: [['1800-01-01', '00:00'], ['9999-12-31', '23:59:59']] };
  const extreme = Timeline.build(imported);
  assert.equal(extreme.intervalMs, 600000);
  const result = Chart.svg(extreme);
  assert.equal((result.svg.match(/data-timeline-index=/g) || []).length, 4);
  assert.match(result.svg, /1800/);
  assert.match(result.svg, /10 min/);
  assert.doesNotMatch(result.svg, /NaN|Infinity/);
  const many = data(Array.from({ length: 2500 }, (_, index) => index % 3 + 1), 600000);
  many.binCount = many.bins.length;
  many.sparse = true;
  const large = Chart.svg(many);
  assert.equal((large.svg.match(/data-timeline-index=/g) || []).length, 2500);
  assert.match(large.svg, /10 min/);
  assert.doesNotMatch(large.svg, /NaN|Infinity/);
});

test('sparse validation forbids false gaps, changed durations, overlap and inconsistent theoretical counts', () => {
  const Chart = chart();
  const source = data([1, 0, 0, 2], 600000);
  source.bins[2].start += 100 * 600000;
  source.bins[2].end += 100 * 600000;
  source.bins[3].start += 100 * 600000;
  source.bins[3].end += 100 * 600000;
  source.end = source.bins.at(-1).end;
  source.binCount = 104;
  assert.throws(() => Chart.svg(source), /intervalle|chronologie/i);
  source.sparse = true;
  assert.doesNotThrow(() => Chart.svg(source));
  for (const change of [draft => { draft.bins[1].contacts = 1; draft.total++; },
    draft => { draft.bins[2].end++; }, draft => { draft.bins[2].start--; },
    draft => { draft.binCount--; }, draft => { draft.sparse = 'true'; }]) {
    const invalid = structuredClone(source); change(invalid);
    assert.throws(() => Chart.svg(invalid), /intervalle|chronologie/i);
  }
});

test('one-bin and empty chronologies have finite dimensions and explain missing timestamp fields', () => {
  const Chart = chart();
  const single = Chart.svg(data([1]));
  assert.equal((single.svg.match(/data-timeline-index=/g) || []).length, 1);
  assert.doesNotMatch(single.svg, /NaN|Infinity/);
  const empty = { ...data([]), missingColumns: ['DATE', 'TIME'], invalidDateTimeCount: 9 };
  const result = Chart.svg(empty);
  assert.ok(result.width > 0 && result.height > 0);
  assert.match(result.svg, /Aucun contact.*date.*heure/);
  assert.match(Chart.render(empty), /Aucun contact/);
  assert.match(Chart.caption(empty), /DATE.*TIME/);
});

test('caption and self-contained exports disclose exclusions, interval boundaries and zero-count semantics', async () => {
  const Chart = chart();
  const caption = Chart.caption(data());
  assert.match(caption, /6 contacts/);
  assert.match(caption, /1.*Noise/);
  assert.match(caption, /3.*date.*heure/);
  assert.match(caption, /zéro contact dans le fichier/);
  assert.match(caption, /enregistrement continu/);
  const unknownNoise = Chart.caption({ ...data(), hasAutoId: false, noiseCount: null });
  assert.match(unknownNoise, /AUTO-ID absente/);
  const result = Chart.svg(data(), { title: '<script> & chronologie', fileName: 'nuit<&".csv' });
  assert.ok(result.svg.startsWith('<svg'));
  assert.match(result.svg, /xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(result.svg, /&lt;script&gt; &amp; chronologie/);
  assert.match(result.svg, /nuit&lt;&amp;&quot;\.csv/);
  assert.doesNotMatch(result.svg, /<script>/);
  assert.match(result.svg, /zéro contact dans le fichier/);
  const exported = await Images.rasterize(result, 'svg');
  assert.equal(exported.extension, 'svg');
  assert.equal(await exported.blob.text(), result.svg);
});

test('invalid timeline counts and timestamps are rejected rather than generating corrupt SVG', () => {
  const Chart = chart();
  for (const patch of [{ contacts: -1 }, { contacts: .5 }, { start: NaN }, { end: Infinity }]) {
    const source = data(); source.bins[0] = { ...source.bins[0], ...patch };
    assert.throws(() => Chart.svg(source));
  }
});

test('embedded chart avoids duplicate visible title and notes while exports keep complete context', () => {
  const Chart = chart();
  const full = Chart.svg(data(), { fileName: 'nuit.csv' });
  const embedded = Chart.render(data());
  const visibleText = svg => [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => match[1]).join(' ');
  assert.doesNotMatch(visibleText(embedded), /Contacts au fil du temps|zéro contact dans le fichier|enregistrement continu/);
  assert.match(embedded, /<title>Contacts au fil du temps<\/title>/);
  assert.match(embedded, /<desc>[^]*zéro contact dans le fichier/);
  assert.match(visibleText(full.svg), /Contacts au fil du temps/);
  assert.match(visibleText(full.svg), /Fichier : nuit\.csv/);
  assert.match(visibleText(full.svg), /enregistrement continu/);
  const coordinates = svg => [...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"/g)].map(match => match.slice(1).map(Number));
  const a = coordinates(full.svg), b = coordinates(embedded);
  assert.deepEqual(a.map(point => point[0]), b.map(point => point[0]));
  assert.ok(a.every((point, index) => Math.abs((point[1] - b[index][1]) - (a[0][1] - b[0][1])) < .01),
    'the compact header only translates the same zero-based plot geometry');
});
