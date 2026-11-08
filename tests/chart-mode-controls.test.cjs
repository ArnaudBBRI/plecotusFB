const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Chart = require('../activity-chart.js');
const Images = require('../activity-export.js');
const Settings = require('../review-settings.js');
const Core = require('../core.js');
const Decisions = require('../contact-decisions.js');

const decode = value => String(value).replace(/&(?:quot|#39|lt|gt|amp);/g,
  entity => ({ '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' })[entity]);
const attributes = value => Object.fromEntries([...value.matchAll(/([\w-]+)="([^"]*)"/g)]
  .map(match => [match[1], decode(match[2])]));
const modes = ['pie', 'bar', 'vertical'];

// Construct the actual mode/export buttons authored in index.html. Browser
// layout/audio adapters are omitted, while controllers/renderers/SVG exports
// remain real; clicks on rendered legend buttons exercise delegated filters.
function browser() {
  const ids = new Map(), blobs = new Map(), downloads = [];
  const camel = name => name.replace(/-([a-z])/g, (_, character) => character.toUpperCase());
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {};
      this.listeners = new Map(); this.hidden = false; this.value = ''; this._text = ''; this._html = '';
      this.classList = { add() {}, remove() {}, toggle() {} }; this.style = { setProperty() {} };
    }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { this._html = String(value); this.children = []; }
    get innerHTML() { return this._html; }
    get childElementCount() { return this.children.length; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith('data-')) this.dataset[camel(name.slice(5))] = String(value);
      if (name === 'id') this.id = value;
    }
    addEventListener(name, callback) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(callback);
    }
    removeEventListener() {}
    matches(selector) {
      return selector.split(',').some(part => {
        const match = part.trim().match(/^(\w+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
        if (!match) return false;
        const [, tag, attribute, value] = match;
        if (tag && tag !== this.tagName) return false;
        if (!attribute) return true;
        const actual = attribute.startsWith('data-') ? this.dataset[camel(attribute.slice(5))]
          : attribute === 'id' ? this.id : this.attributes[attribute];
        return actual !== undefined && (value === undefined || actual === value);
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    fire(name) {
      if (name === 'click' && this.disabled) return;
      const event = { target: this, preventDefault() {} };
      let result;
      for (let current = this; current; current = current.parent) for (const callback of current.listeners.get(name) || []) {
        const next = callback(event); if (next !== undefined) result = next;
      }
      return result;
    }
    click() {
      if (this.tagName === 'a') downloads.push({ fileName: this.download, blob: blobs.get(this.href) });
      else return this.fire('click');
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
    focus() {}
    decode() { return Promise.resolve(); }
  }
  const body = new Node('body');
  const node = id => {
    if (!ids.has(id)) {
      const created = new Node(); created.id = id; ids.set(id, created);
      (id.startsWith('final-') && id !== 'final-summary' ? node('final-summary') : body).append(created);
    }
    return ids.get(id);
  };
  const index = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const match of index.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = attributes(match[1]);
    if (!Object.keys(attrs).some(name => /^data-(chart-(?:mode|export)|summary-(?:mode|chart|table)|timeline-export|step-one-species-export)$/.test(name))) continue;
    const button = new Node('button');
    for (const [name, value] of Object.entries(attrs)) button.setAttribute(name, value);
    button.textContent = match[2];
    (Object.keys(attrs).some(name => name.startsWith('data-summary-')) ? node('final-summary') : body).append(button);
  }
  const document = { body, getElementById: node, createElement: tag => new Node(tag),
    createTextNode: text => { const item = new Node('#text'); item.textContent = text; return item; },
    querySelectorAll: selector => body.querySelectorAll(selector), querySelector: () => ({ content: '' }) };
  const context = vm.createContext({ document, Blob, Intl, Map, Set, setTimeout: () => 1, clearTimeout() {},
    URL: { createObjectURL(blob) { const key = 'blob:' + blobs.size; blobs.set(key, blob); return key; }, revokeObjectURL() {} },
    matchMedia: () => ({ matches: true, addEventListener() {} }), window: {},
    BatActivityChart: Chart, BatActivityExport: Images, BatReviewCore: Core,
    BatSpeciesNames: require('../species.js'), PlecotusReviewSettings: Settings,
    PlecotusImportChart: require('../import-chart.js'), PlecotusFileImport: require('../file-import.js'),
    PlecotusBestContacts: require('../best-contacts.js'), PlecotusManualWorkflow: require('../manual-workflow.js'),
    PlecotusResultsFile: require('../results-file.js'), PlecotusFinalSummaryData: require('../final-summary-data.js'),
    PlecotusFinalSummaryVisuals: require('../final-summary-visuals.js'),
    PlecotusWavOpening: { init: () => ({ getPreferences: () => ({ reviewer: '', debugMode: false,
      includeCommonPipistrelle: true, reviewSettings: Settings.normalize() }) }) },
    PlecotusManualReviewUI: { init: () => ({ hide() {}, refresh() {} }) }
  });
  vm.runInContext(fs.readFileSync(require.resolve('../final-summary-ui.js'), 'utf8'), context);
  const toggleLegend = (host, scientificName) => {
    const match = [...host.innerHTML.matchAll(/<button\b([^>]*data-chart-key="[^"]*"[^>]*)>/g)]
      .map(match => attributes(match[1])).find(attrs => JSON.parse(attrs['data-chart-key'])[0] === scientificName);
    assert.ok(match, 'the real rendered legend contains ' + scientificName);
    const button = new Node('button');
    for (const [name, value] of Object.entries(match)) button.setAttribute(name, value);
    host.append(button); button.click();
  };
  return { context, node, document, downloads, toggleLegend };
}

function assertMode(output, mode, live) {
  if (mode === 'pie') assert.match(output, live ? /class="activity-chart-slice"/ : /<(?:circle|path) data-series=/);
  else if (mode === 'bar') assert.match(output, live ? /activity-bar-list/ : /Graphique en barres/);
  else assert.match(output, live ? /class="activity-column"/ : /Barres verticales/);
}

test('the three index import buttons preserve a legend filter and export the displayed mode with its own filename', async () => {
  const b = browser();
  let finish;
  const created = new Promise(resolve => { finish = resolve; });
  b.context.PlecotusContactDecisions = { create: async imported => {
    const model = await Decisions.create(imported, { storage: null, crypto: webcrypto }); finish(); return model;
  } };
  vm.runInContext(fs.readFileSync(require.resolve('../welcome.js'), 'utf8'), b.context);
  const bytes = Buffer.from('IN FILE,AUTO-ID\n' + ['PIPPIP', 'PIPPIP', 'PIPPIP', 'PIPPIP', 'PIPPIP', 'PIPPIP',
    'MYODAU', 'MYODAU', 'MYODAU', 'NoID', 'Noise'].map((name, index) => index + '.wav,' + name).join('\n'));
  b.node('data-file').files = [{ name: 'contacts.csv', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }];
  b.node('data-file').fire('change'); await created; await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.node('import-error').hidden, true, b.node('import-error').textContent);
  const buttons = b.document.querySelectorAll('[data-chart-mode]');
  assert.deepEqual(buttons.map(button => button.dataset.chartMode), modes);
  b.toggleLegend(b.node('distribution-chart'), 'Pipistrellus pipistrellus');
  for (const [index, mode] of modes.entries()) {
    buttons[index].click();
    assert.equal(buttons[index].attributes['aria-pressed'], 'true');
    assert.equal(buttons.filter(button => button.attributes['aria-pressed'] === 'true').length, 1);
    assertMode(b.node('distribution-chart').innerHTML, mode, true);
    assert.match(b.node('distribution-caption').textContent, /4 contacts représentés.*1 catégorie masquée/);
    await b.document.querySelectorAll('[data-chart-export]').find(button => button.dataset.chartExport === 'svg').click();
    const download = b.downloads.at(-1), svg = await download.blob.text();
    assertMode(svg, mode, false);
    assert.match(svg, /4 contacts représentés/);
    assert.doesNotMatch(svg, /data-legend="Pipistrellus pipistrellus"/);
    assert.equal(download.fileName, 'contacts_autoid_' + ({ pie: 'camembert', bar: 'barres', vertical: 'barres_verticales' })[mode] + '_filtre.svg');
  }
  b.toggleLegend(b.node('distribution-chart'), 'Pipistrellus pipistrellus');
  assert.match(b.node('distribution-caption').textContent, /10 contacts représentés/);
});

test('the three final-summary buttons retain a shared filter across before, after and comparison renderings and exports', async () => {
  const b = browser();
  const species = [
    { key: 'PIPPIP', scientificName: 'Pipistrellus pipistrellus', frenchName: 'Pipistrelle commune', isSpecies: true, color: '#1b7663' },
    { key: 'MYODAU', scientificName: 'Myotis daubentonii', frenchName: 'Murin de Daubenton', isSpecies: true, color: '#d78631' },
    { key: 'NoID', scientificName: 'NoID', frenchName: 'Chauve-souris non identifiée', color: '#6284b5' }
  ];
  const data = { fileName: 'contacts.csv', beforeHasAutoId: true,
    beforeRows: species.map((row, index) => ({ ...row, contacts: [6, 3, 1][index] })),
    afterRows: species.map((row, index) => ({ ...row, contacts: [4, 4, 2][index] })),
    comparisonRows: species.map((row, index) => ({ ...row, before: [6, 3, 1][index], after: [4, 4, 2][index] })),
    tableRows: species.map((row, index) => ({ ...row, contacts: [4, 4, 2][index] })),
    totals: { sourceContacts: 10, beforeContacts: 10, afterContacts: 10, beforeNoise: 0, afterNoise: 0, manualContacts: 4, calculatedContacts: 6 } };
  const ui = b.context.PlecotusFinalSummaryUI.init({ document: b.document, getData: () => data,
    getPreferences: () => ({ includeCommonPipistrelle: true }), onBack() {} });
  ui.show();
  const buttons = b.document.querySelectorAll('[data-summary-mode]');
  assert.deepEqual(buttons.map(button => button.dataset.summaryMode), modes);
  b.toggleLegend(b.node('final-before-chart'), 'Pipistrellus pipistrellus');
  for (const [index, mode] of modes.entries()) {
    buttons[index].click();
    assert.equal(buttons[index].attributes['aria-pressed'], 'true');
    for (const which of ['before', 'after']) {
      assertMode(b.node('final-' + which + '-chart').innerHTML, mode, true);
      assert.match(b.node('final-' + which + '-caption').textContent, which === 'before' ? /4 contacts représentés/ : /6 contacts représentés/);
      await b.document.querySelectorAll('[data-summary-chart]').find(button => button.dataset.summaryChart === which && button.dataset.summaryFormat === 'svg').click();
      const svg = await b.downloads.at(-1).blob.text();
      assertMode(svg, mode, false);
      assert.doesNotMatch(svg, /data-legend="Pipistrellus pipistrellus"/);
      assert.match(svg, which === 'before' ? /4 contacts représentés/ : /6 contacts représentés/);
    }
    assert.doesNotMatch(b.node('final-comparison-chart').innerHTML, /data-comparison-key="PIPPIP"/);
    assert.equal((b.node('final-comparison-chart').innerHTML.match(/data-comparison-key=/g) || []).length, 4);
    assert.equal(b.node('final-table-total').textContent, '10');
  }
});

test('the interface offers no histogram option in either chart selector', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.doesNotMatch(html, /Histogramme|data-(?:chart|summary)-mode="histogram"/i);
});

test('the source summary contains a separately labelled chronology card and loads its local modules', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const id of ['timeline-heading', 'timeline-chart', 'timeline-caption', 'timeline-detail', 'timeline-export-status']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.ok(html.indexOf('id="distribution-chart"') < html.indexOf('id="timeline-chart"'));
  assert.ok(html.indexOf('id="timeline-chart"') < html.indexOf('id="import-warnings"'));
  for (const source of ['timeline-data.js', 'timeline-chart.js', 'timeline-ui.js']) {
    assert.ok(html.includes('<script defer src="' + source + '"></script>'), source);
  }
});

test('each actual file import resets the previous timeline and supplies the new source contacts to it', async () => {
  const b = browser(), shown = [];
  let resets = 0, finish;
  b.context.PlecotusTimelineUI = { init: options => {
    assert.equal(options.document, b.document);
    return { reset() { resets++; }, show(imported) { shown.push(imported); } };
  } };
  b.context.PlecotusContactDecisions = { create: async imported => {
    const decisions = await Decisions.create(imported, { storage: null, crypto: webcrypto });
    finish(); return decisions;
  } };
  vm.runInContext(fs.readFileSync(require.resolve('../welcome.js'), 'utf8'), b.context);
  async function load(name, text) {
    const created = new Promise(resolve => { finish = resolve; });
    const bytes = Buffer.from(text);
    b.node('data-file').files = [{ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }];
    b.node('data-file').fire('change');
    await created; await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.node('import-error').hidden, true, b.node('import-error').textContent);
  }
  await load('first.csv', 'IN FILE,AUTO-ID,DATE,TIME\na.wav,PIPPIP,2026-11-08,23:30:00\nb.wav,Noise,2026-11-08,23:40:00');
  assert.equal(resets, 1);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].fileName, 'first.csv');
  assert.equal(shown[0].records.length, 2, 'the timeline receives Noise too and accounts for its own exclusions');
  await load('second.csv', 'IN FILE,AUTO-ID\nc.wav,NoID');
  assert.equal(resets, 2);
  assert.equal(shown.length, 2);
  assert.equal(shown[1].fileName, 'second.csv');
  assert.deepEqual(Array.from(shown[1].headers), ['IN FILE', 'AUTO-ID']);
});

test('the real timeline survives species filtering, exports its full chronology and clears when the next file has no timestamps', async () => {
  const b = browser();
  b.context.PlecotusTimelineData = require('../timeline-data.js');
  b.context.PlecotusTimelineChart = require('../timeline-chart.js');
  vm.runInContext(fs.readFileSync(require.resolve('../timeline-ui.js'), 'utf8'), b.context);
  let finish;
  b.context.PlecotusContactDecisions = { create: async imported => {
    const decisions = await Decisions.create(imported, { storage: null, crypto: webcrypto });
    finish(); return decisions;
  } };
  vm.runInContext(fs.readFileSync(require.resolve('../welcome.js'), 'utf8'), b.context);
  async function load(name, content) {
    const created = new Promise(resolve => { finish = resolve; });
    const bytes = Buffer.from(content);
    b.node('data-file').files = [{ name, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }];
    b.node('data-file').fire('change');
    await created; await new Promise(resolve => setImmediate(resolve));
    assert.equal(b.node('import-error').hidden, true, b.node('import-error').textContent);
  }
  await load('night.csv', 'IN FILE,AUTO-ID,DATE,TIME\na.wav,PIPPIP,23-07-25,23:10:00\nb.wav,PIPPIP,24-07-25,00:15:00\nc.wav,NoID,24-07-25,02:30:00\nd.wav,Noise,24-07-25,01:00:00\ne.wav,PIPPIP,24-07-25,invalid');
  const graph = b.node('timeline-chart').innerHTML;
  assert.match(graph, /<svg\b/);
  assert.match(b.node('timeline-caption').textContent, /3 contacts/);
  assert.match(b.node('timeline-caption').textContent, /Intervalles de 10 min/);
  assert.equal((graph.match(/data-timeline-index=/g) || []).length, 21);
  assert.match(b.node('timeline-caption').textContent, /23\/07\/2025/);
  assert.match(b.node('timeline-caption').textContent, /24\/07\/2025/);
  b.toggleLegend(b.node('distribution-chart'), 'Pipistrellus pipistrellus');
  assert.equal(b.node('timeline-chart').innerHTML, graph);
  const buttons = b.document.querySelectorAll('[data-timeline-export]');
  assert.equal(buttons.length, 3);
  const svgButton = buttons.find(button => button.dataset.timelineExport === 'svg');
  assert.equal(svgButton.disabled, false);
  await svgButton.click();
  const result = b.downloads.at(-1);
  assert.equal(result.fileName, 'night_chronologie_contacts.svg');
  const exported = await result.blob.text();
  assert.match(exported, /3 contacts/);
  assert.match(exported, /23\/07\/2025/);
  assert.match(exported, /Intervalles de 10 min/);
  assert.match(exported, /Du 24\/07\/2025 00:10 au 24\/07\/2025 00:20/);
  await load('missing.csv', 'IN FILE,AUTO-ID,DATE-12\na.wav,PIPPIP,2025-07-23');
  assert.ok(buttons.every(button => button.disabled));
  assert.doesNotMatch(b.node('timeline-chart').innerHTML, /23\/07\/2025/);
  assert.doesNotMatch(b.node('timeline-caption').textContent, /3 contacts/);
});

test('actual stage-one buttons download a corrected two-column species CSV before supplementary checks are completed', async () => {
  const b = browser();
  b.context.PlecotusStepOneSpecies = require('../step-one-species.js');
  vm.runInContext(fs.readFileSync(require.resolve('../step-one-species-ui.js'), 'utf8'), b.context);
  const settings = Settings.normalize({ excludedSpecies: ['PIPPIP'] });
  b.context.PlecotusWavOpening = { init: () => ({ getPreferences: () => ({ reviewer: '', debugMode: false,
    includeCommonPipistrelle: true, reviewSettings: settings }) }) };
  let finish, source, decisions;
  const created = new Promise(resolve => { finish = resolve; });
  b.context.PlecotusContactDecisions = { create: async imported => {
    source = imported;
    decisions = await Decisions.create(imported, { storage: null, crypto: webcrypto });
    finish(); return decisions;
  } };
  vm.runInContext(fs.readFileSync(require.resolve('../welcome.js'), 'utf8'), b.context);
  const buttons = b.document.querySelectorAll('[data-step-one-species-export]');
  assert.equal(buttons.length, 4);
  assert.ok(buttons.every(button => button.disabled));
  const bytes = Buffer.from('IN FILE,AUTO-ID,MATCH RATIO,Qual,PULSES\n'
    + Array.from({ length: 10 }, (_, i) => i + '.wav,PIPPIP,' + (i ? '.8' : '.9') + ',5,10').join('\n'));
  b.node('data-file').files = [{ name: 'night.csv', arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }];
  b.node('data-file').fire('change'); await created; await new Promise(resolve => setImmediate(resolve));
  b.node('start-review').click();
  assert.ok(buttons.every(button => button.disabled));
  b.node('species-groups').querySelector('button[data-decision="invalidated"]').click();
  const select = b.node('species-groups').querySelector('select');
  select.value = 'MYODAU'; select.fire('change');
  assert.ok(buttons.every(button => !button.disabled));
  const plan = require('../manual-workflow.js').build(source, decisions, { settings });
  assert.ok(plan.remaining > 0, 'the actual supplementary completion gate remains unfinished');
  const csvButtons = buttons.filter(button => button.dataset.stepOneSpeciesExport === 'csv');
  for (const button of csvButtons) {
    await button.click();
    const download = b.downloads.at(-1);
    assert.equal(download.fileName, 'night_especes_etape_1.csv');
    const text = await download.blob.text();
    const table = Core.parseCSV(text, ';');
    assert.deepEqual(table.headers, ['Nom scientifique', 'Nom vernaculaire']);
    assert.deepEqual(table.records, [['Myotis daubentonii', 'Murin de Daubenton']]);
    assert.doesNotMatch(text, /Nombre de contacts|Pipistrellus|SEMIMANUAL/);
  }
});
