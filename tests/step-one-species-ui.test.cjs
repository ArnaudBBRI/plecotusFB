const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function ready(overrides = {}) {
  return { ready: true, hasBestContacts: true, pendingBestIndices: [], bestIndices: [0, 10],
    noBestGroupKeys: [], selectionSignature: 'ratio-desc/qual-desc', sourceVersion: 1, fileName: 'contacts.csv',
    rows: [{ scientificName: 'Myotis daubentonii', frenchName: 'Murin de Daubenton', isSpecies: true }], ...overrides };
}

function fixture(initial = null, options = {}) {
  const file = path.join(__dirname, '..', 'step-one-species-ui.js');
  assert.ok(fs.existsSync(file), 'the provisional stage-one species export controller exists');
  class Node {
    constructor() { this.dataset = {}; this.listeners = new Map(); this.disabled = false; this.textContent = ''; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    fire(name) { return this.listeners.get(name)?.({ preventDefault() {} }); }
  }
  const buttons = ['csv', 'jpeg', 'csv', 'jpeg'].map(format => { const node = new Node(); node.dataset.stepOneSpeciesExport = format; return node; });
  const descriptions = [new Node(), new Node()], statuses = [new Node(), new Node()];
  const document = { querySelectorAll(selector) {
    return selector === '[data-step-one-species-export]' ? buttons
      : selector === '[data-step-one-species-help]' ? descriptions : statuses;
  } };
  let data = initial, reads = 0;
  const downloads = [], csvCalls = [], jpegCalls = [];
  const Visuals = {
    namesCsv(rows) { csvCalls.push(structuredClone(rows)); return '\ufeffNom scientifique;Nom vernaculaire\r\n'
      + rows.map(row => row.scientificName + ';' + row.frenchName).join('\r\n'); },
    async exportNamesTable(rows, format, settings) {
      jpegCalls.push({ rows: structuredClone(rows), format, settings });
      if (options.jpeg) return options.jpeg(rows, format, settings);
      return { blob: new Blob(['jpeg'], { type: 'image/jpeg' }), extension: 'jpeg' };
    }
  };
  const browser = { PlecotusFinalSummaryVisuals: Visuals, Blob };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), browser, { filename: 'step-one-species-ui.js' });
  const ui = browser.PlecotusStepOneSpeciesUI.init({ document,
    getData: () => { reads++; if (data instanceof Error) throw data; return data; },
    download: result => { if (options.download) return options.download(result); downloads.push(result); } });
  return { ui, buttons, descriptions, statuses, downloads, csvCalls, jpegCalls,
    setData(next) { data = next; }, reads: () => reads,
    export(format, place = 0) { return buttons[place * 2 + (format === 'csv' ? 0 : 1)].fire('click'); } };
}

test('both export locations reflect missing, incomplete, completed and all-Noise best contacts', () => {
  const a = fixture(); a.ui.refresh();
  assert.ok(a.buttons.every(button => button.disabled));
  a.setData(ready({ ready: false, pendingBestIndices: [0] })); a.ui.refresh();
  assert.ok(a.buttons.every(button => button.disabled));
  assert.match(a.descriptions[0].textContent, /identifier|terminer/);
  a.setData(ready({ hasBestContacts: false, ready: false, bestIndices: [] })); a.ui.refresh();
  assert.ok(a.buttons.every(button => button.disabled));
  assert.match(a.descriptions[0].textContent, /Aucun meilleur contact/);
  a.setData(ready({ rows: [], noBestGroupKeys: ['source:vide'] })); a.ui.refresh();
  assert.ok(a.buttons.every(button => !button.disabled), 'completed references corrected to Noise still allow an explicit empty list');
  assert.match(a.descriptions[0].textContent, /provisoire/);
  assert.match(a.descriptions[0].textContent, /complétée.*contrôles/);
  assert.match(a.descriptions[0].textContent, /1.*groupe.*sans référence/);
  assert.equal(a.descriptions[0].textContent, a.descriptions[1].textContent);
});

test('CSV and JPEG re-read live best identifications and use only the two-name provisional export helpers', async () => {
  const a = fixture(ready()); a.ui.refresh();
  const corrected = ready({ fileName: 'nuit<"sale>.csv', rows: [{ scientificName: 'NoID', frenchName: 'Chauve-souris non identifiée', isSpecies: false }] });
  a.setData(corrected);
  await a.export('csv', 1);
  assert.equal(a.csvCalls[0][0].scientificName, 'NoID', 'export does not reuse the earlier species row');
  assert.equal(a.downloads[0].fileName, 'nuit__sale__especes_etape_1.csv');
  assert.equal(a.downloads[0].blob.type, 'text/csv;charset=utf-8');
  assert.deepEqual([...new Uint8Array(await a.downloads[0].blob.arrayBuffer()).slice(0, 3)], [0xef, 0xbb, 0xbf]);
  await a.export('jpeg');
  assert.equal(a.jpegCalls[0].rows[0].scientificName, 'NoID');
  assert.equal(a.jpegCalls[0].format, 'jpeg');
  assert.equal(a.jpegCalls[0].settings.fileName, corrected.fileName);
  assert.match(a.downloads[1].fileName, /_especes_etape_1\.jpeg$/);
  assert.ok(a.reads() >= 4, 'live data is checked at every export publication');
  a.setData(ready({ ready: false, pendingBestIndices: [0] }));
  await a.export('csv');
  assert.equal(a.downloads.length, 2, 'a newly deferred best cannot be exported before refresh');
  assert.ok(a.buttons.every(button => button.disabled));
});

test('unchanged refresh preserves a pending JPEG while source, ranking, ID or reset invalidates old results', async () => {
  for (const change of ['unchanged', 'source', 'ranking', 'identification', 'reset']) {
    let complete;
    const a = fixture(ready(), { jpeg: () => new Promise(resolve => { complete = resolve; }) });
    a.ui.refresh();
    const pending = a.export('jpeg');
    assert.ok(a.buttons.every(button => button.disabled), 'all button copies reflect a pending export');
    if (change === 'reset') a.ui.reset();
    else {
      const next = ready(change === 'source' ? { sourceVersion: 2 } : change === 'ranking' ? { selectionSignature: 'pulses-desc', bestIndices: [2, 10] }
        : change === 'identification' ? { rows: [{ scientificName: 'Plecotus auritus', frenchName: 'Oreillard roux', isSpecies: true }] } : {});
      a.setData(next); a.ui.refresh();
      if (change === 'unchanged') assert.ok(a.buttons.every(button => button.disabled), 'identical data does not re-enable an in-flight export');
    }
    complete({ blob: new Blob(['jpeg']), extension: 'jpeg' }); await pending;
    assert.equal(a.downloads.length, change === 'unchanged' ? 1 : 0, change);
    if (change === 'reset') assert.ok(a.buttons.every(button => button.disabled));
    else assert.ok(a.buttons.every(button => !button.disabled));
  }
});

test('JPEG publication catches data changes even without refresh, and visible error recovery updates both locations', async () => {
  let complete;
  const a = fixture(ready(), { jpeg: () => new Promise(resolve => { complete = resolve; }) });
  a.ui.refresh(); const pending = a.export('jpeg');
  a.setData(ready({ ready: false, pendingBestIndices: [10] }));
  complete({ blob: new Blob(['jpeg']), extension: 'jpeg' }); await pending;
  assert.equal(a.downloads.length, 0);
  assert.ok(a.buttons.every(button => button.disabled));
  a.setData(new Error('Fichier indisponible.')); a.ui.refresh();
  assert.ok(a.buttons.every(button => button.disabled));
  assert.match(a.statuses[0].textContent, /Fichier indisponible/);
  assert.equal(a.statuses[0].textContent, a.statuses[1].textContent);
  a.setData(ready()); a.ui.refresh();
  assert.ok(a.buttons.every(button => !button.disabled));
  assert.equal(a.statuses[0].textContent, '');
});

test('JPEG and download failures are contained, shown in both status areas and do not leave buttons busy', async () => {
  const a = fixture(ready(), { jpeg: async () => { throw new Error('Conversion JPEG indisponible.'); } });
  a.ui.refresh(); await a.export('jpeg');
  assert.match(a.statuses[0].textContent, /Conversion JPEG indisponible/);
  assert.equal(a.statuses[0].textContent, a.statuses[1].textContent);
  assert.ok(a.buttons.every(button => !button.disabled));
  const b = fixture(ready(), { download: async () => { throw new Error('Téléchargement refusé.'); } });
  b.ui.refresh(); await b.export('csv');
  assert.match(b.statuses[0].textContent, /Téléchargement refusé/);
  assert.ok(b.buttons.every(button => !button.disabled));
});
