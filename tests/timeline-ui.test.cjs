const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Images = require('../activity-export.js');

function fixture(options = {}) {
  const file = path.join(__dirname, '..', 'timeline-ui.js');
  assert.ok(fs.existsSync(file), 'the timeline controller module exists');
  const Chart = require('../timeline-chart.js');
  const nodes = new Map();
  class Node {
    constructor() { this.children = []; this.dataset = {}; this.listeners = new Map(); this.textContent = ''; this.innerHTML = ''; this.hidden = true; }
    append(node) { this.children.push(node); }
    replaceChildren() { this.children = []; this.innerHTML = ''; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    fire(name, target = this) { return this.listeners.get(name)?.({ target, relatedTarget: null }); }
    contains(node) { return this === node || this.children.includes(node); }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const buttons = ['png', 'jpeg', 'svg'].map(format => { const button = new Node(); button.dataset.timelineExport = format; return button; });
  const document = { getElementById: node, querySelectorAll: () => buttons };
  const built = [], downloads = [], rasterized = [];
  const Data = { build(imported) { built.push(imported); return options.realData ? require('../timeline-data.js').build(imported) : imported.timeline; } };
  const Raster = { async rasterize(source, format) {
    rasterized.push({ source, format });
    if (options.rasterize) return options.rasterize(source, format);
    return format === 'svg' ? Images.rasterize(source, format) : { blob: new Blob([format]), extension: format };
  } };
  const browser = { PlecotusTimelineData: Data, PlecotusTimelineChart: Chart, BatActivityExport: Raster, Blob };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), browser, { filename: 'timeline-ui.js' });
  const ui = browser.PlecotusTimelineUI.init({ document, download: file => downloads.push(file) });
  return { ui, node, built, downloads, rasterized, buttons,
    export: format => buttons.find(button => button.dataset.timelineExport === format).fire('click'),
    point(index) { const point = new Node(); point.dataset.timelineIndex = String(index); point.closest = () => point; node('timeline-chart').append(point); return point; } };
}

function imported(fileName = 'contacts.csv', values = [2, 0, 1]) {
  const start = Date.UTC(2026, 10, 8, 23, 40), intervalMs = 600000;
  const bins = values.map((contacts, index) => ({ start: start + index * intervalMs, end: start + (index + 1) * intervalMs, contacts }));
  return { fileName, timeline: { bins, intervalMs, total: values.reduce((sum, value) => sum + value, 0),
    sourceContacts: 5, noiseCount: 1, invalidDateTimeCount: 1, hasAutoId: true, missingColumns: [],
    start: bins.length ? start : null, end: bins.at(-1)?.end ?? null, binCount: bins.length, sparse: false } };
}

test('controller builds the source chronology and gives exact interval counts on pointer and keyboard focus', () => {
  const a = fixture();
  const source = imported(); a.ui.show(source);
  assert.equal(a.built[0], source);
  assert.match(a.node('timeline-chart').innerHTML, /Contacts au fil du temps/);
  assert.match(a.node('timeline-caption').textContent, /3 contacts/);
  assert.match(a.node('timeline-caption').textContent, /Intervalles de 10 min/);
  assert.ok(a.buttons.every(button => button.disabled === false));
  a.node('timeline-chart').fire('pointerover', a.point(1));
  assert.equal(a.node('timeline-detail').hidden, false, 'the HTML status starts hidden and must be made visible');
  assert.match(a.node('timeline-detail').textContent, /08\/11\/2026 23:50/);
  assert.match(a.node('timeline-detail').textContent, /09\/11\/2026 00:00/);
  assert.match(a.node('timeline-detail').textContent, /0 contact/);
  a.node('timeline-chart').fire('focusin', a.point(0));
  assert.match(a.node('timeline-detail').textContent, /2 contacts/);
});

test('empty chronologies and resetting never leave the previous file graph or active exports', () => {
  const a = fixture(); a.ui.show(imported());
  a.ui.show(imported('vide.csv', []));
  assert.match(a.node('timeline-chart').innerHTML, /Aucun contact/);
  assert.ok(a.buttons.every(button => button.disabled));
  a.ui.reset();
  assert.equal(a.node('timeline-chart').innerHTML, '');
  assert.equal(a.node('timeline-caption').textContent, '');
  assert.equal(a.node('timeline-detail').textContent, '');
  assert.equal(a.node('timeline-export-status').textContent, '');
  assert.ok(a.buttons.every(button => button.disabled));
});

test('all three export formats use the actual timeline SVG, safe filenames and no species-chart mode', async () => {
  const a = fixture(); a.ui.show(imported('nuit<"sale>.csv'));
  for (const format of ['png', 'jpeg', 'svg']) await a.export(format);
  assert.deepEqual(a.rasterized.map(call => call.format), ['png', 'jpeg', 'svg']);
  assert.equal(a.downloads.length, 3);
  for (const [index, file] of a.downloads.entries()) {
    assert.match(file.fileName, /_chronologie_contacts\.(png|jpeg|svg)$/);
    assert.doesNotMatch(file.fileName, /[<>"\\/]/);
    assert.match(a.rasterized[index].source.svg, /Contacts au fil du temps/);
    assert.match(a.rasterized[index].source.svg, /nuit&lt;&quot;sale&gt;\.csv/);
    assert.match(a.rasterized[index].source.svg, /Intervalles de 10 min/);
  }
  assert.equal(a.downloads[2].blob.type, 'image/svg+xml');
});

test('real source data reaches pointer details and SVG exports as distinct ten-minute intervals across midnight', async () => {
  const a = fixture({ realData: true });
  a.ui.show({ fileName: 'minuit.csv', headers: ['IN FILE', 'DATE', 'TIME', 'AUTO-ID'], records: [
    ['a.wav', '08-11-26', '23:49:59', 'PIPPIP'],
    ['b.wav', '08-11-26', '23:50:00', 'NoID'],
    ['c.wav', '09-11-26', '00:00:00', 'MYODAU'],
    ['noise.wav', '09-11-26', '00:10:00', 'Noise']
  ] });
  assert.match(a.node('timeline-caption').textContent, /3 contacts/);
  assert.match(a.node('timeline-caption').textContent, /Intervalles de 10 min/);
  a.node('timeline-chart').fire('pointerover', a.point(1));
  assert.match(a.node('timeline-detail').textContent, /08\/11\/2026 23:50/);
  assert.match(a.node('timeline-detail').textContent, /09\/11\/2026 00:00/);
  assert.match(a.node('timeline-detail').textContent, /1 contact/);
  a.node('timeline-chart').fire('focusin', a.point(2));
  assert.match(a.node('timeline-detail').textContent, /09\/11\/2026 00:00/);
  assert.match(a.node('timeline-detail').textContent, /09\/11\/2026 00:10/);
  await a.export('svg');
  const svg = await a.downloads[0].blob.text();
  assert.equal((svg.match(/data-timeline-index=/g) || []).length, 3);
  assert.match(svg, /Intervalles de 10 min/);
  assert.doesNotMatch(svg, /Intervalles de 1 h/);
});

test('a pending raster export cannot download or overwrite statuses after another import', async () => {
  let finish;
  const a = fixture({ rasterize: () => new Promise(resolve => { finish = resolve; }) });
  a.ui.show(imported('premier.csv'));
  const pending = a.export('png');
  a.ui.show(imported('suivant.csv', [5]));
  finish({ blob: new Blob(['png']), extension: 'png' });
  await pending;
  assert.equal(a.downloads.length, 0);
  assert.equal(a.node('timeline-export-status').textContent, '');
  assert.match(a.node('timeline-caption').textContent, /5 contacts/);
  assert.ok(a.buttons.every(button => !button.disabled));
});
