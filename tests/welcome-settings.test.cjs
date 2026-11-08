const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const Settings = require('../review-settings.js');
const Core = require('../core.js');
const Names = require('../species.js');
const Import = require('../file-import.js');
const Best = require('../best-contacts.js');
const Workflow = require('../manual-workflow.js');
const Decisions = require('../contact-decisions.js');
const Results = require('../results-file.js');

// Run the complete production controller. Only its browser and screen adapters
// are doubled; selection, decisions, workflow and CSV results use real modules.
async function app({ realManual = false, autoId = 'PIPPIP', manualId = '', startReview = true,
  sameFile = false, initialReviewer, loadFile = true, withContext = false, withStepOneExport = false, withUnresolvedPass = false } = {}) {
  const ids = new Map();
  let activeElement = null;
  const camel = name => name.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {};
      this.listeners = new Map(); this.hidden = true; this.value = ''; this._text = '';
      this.classList = { add() {}, remove() {}, toggle() {} }; this.style = { setProperty() {} };
    }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; this.append(...nodes); }
    set textContent(value) { this.replaceChildren(); this._text = value; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    get childElementCount() { return this.children.length; }
    set value(value) { this._value = value; this.valueWrites = (this.valueWrites || 0) + 1; this.selectionStart = this.selectionEnd = String(value).length; }
    get value() { return this._value; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener() {}
    fire(name) { return this.listeners.get(name)?.({ preventDefault() {}, target: this }); }
    focus() { this.focused = true; activeElement = this; }
    get isConnected() { let top = this; while (top.parent) top = top.parent; return top === body; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    decode() { return Promise.resolve(); }
    matches(selector) {
      const match = selector.match(/^(\w+)?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
      if (!match) return false;
      const [, tag, attribute, value] = match;
      if (tag && this.tagName !== tag) return false;
      if (!attribute) return true;
      const actual = attribute.startsWith('data-') ? this.dataset[camel(attribute.slice(5))] : this.attributes[attribute];
      return actual !== undefined && (value === undefined || actual === value);
    }
    querySelectorAll(selector) {
      return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const body = new Node('body');
  const node = id => {
    if (!ids.has(id)) { const item = new Node(); item.id = id; ids.set(id, item); body.append(item); }
    return ids.get(id);
  };
  const document = {
    body, getElementById: node, createElement: tag => new Node(tag),
    get activeElement() { return activeElement; },
    createTextNode: text => { const item = new Node('#text'); item.textContent = text; return item; },
    querySelectorAll: selector => body.querySelectorAll(selector), querySelector: () => ({ content: '' })
  };
  node('header-reviewer-name').textContent = 'non spécifié';
  node('header-reviewer-name').dataset.unspecified = 'true';
  let preferences = { reviewer: initialReviewer, debugMode: true, includeCommonPipistrelle: true, reviewSettings: Settings.normalize() };
  let settingsCallback, manualOptions, finalOptions, decisions, savedBlob;
  let manualRefreshCount = 0;
  const contextShows = [], wavOpens = [];
  let contextOptions, contextRefreshCount = 0, contextResetCount = 0;
  let stepOneOptions, stepOneRefreshCount = 0, stepOneResetCount = 0;
  let finishDecisions;
  let decisionsCreated;
  let manual = {
    hide() { node('manual-plan-overview').hidden = true; node('manual-species-detail').hidden = true; },
    showPlan() { const plan = manualOptions.getPlan(); node('manual-plan-overview').hidden = false; return plan.ready; },
    refresh() { manualRefreshCount++; return manualOptions.getPlan(); }
  };
  const final = {
    hide() { node('final-summary').hidden = true; },
    show() { finalOptions.getData(); node('final-summary').hidden = false; return true; },
    refresh() {}
  };
  const headers = ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'PULSES', 'MANUAL ID'];
  const records = Array.from({ length: 10 }, (_, index) => [sameFile ? 'same.wav' : `contact-${index}.wav`, autoId, index === 0 ? '.9' : '.8', String(index + 1), '10', index === 0 ? manualId : '']);
  const imported = { fileName: 'contacts.csv', sheetName: null, headers, records,
    sourceRows: records.map((_, index) => index + 2), delimiter: ',', warnings: [],
    columns: Core.canonicalColumns(headers), summary: Import.summarize({ headers, records }) };
  const context = {
    document, Blob, Intl, setTimeout() { return 1; }, clearTimeout() {},
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    window: { showSaveFilePicker: async () => ({ name: 'contacts_resultats.csv',
      createWritable: async () => ({ write: async blob => { savedBlob = blob; }, close: async () => {} }) }) },
    PlecotusReviewSettings: Settings, PlecotusBestContacts: Best, PlecotusManualWorkflow: Workflow,
    BatSpeciesNames: Names, PlecotusResultsFile: Results,
    PlecotusFileImport: { read: async file => ({ ...structuredClone(imported), fileName: file.name }) },
    PlecotusContactDecisions: { create: async imported => {
      decisions = await Decisions.create(imported, { storage: null, crypto: webcrypto });
      finishDecisions();
      return decisions;
    }, isComplete: Decisions.isComplete },
    PlecotusImportChart: { build: () => ({ rows: [], total: 0 }) },
    BatActivityChart: { select: () => ({ total: 0 }), rowKey: row => row.key },
    PlecotusWavOpening: { init: options => {
      settingsCallback = options.onPreferencesChange;
      return { getPreferences: () => preferences, openContact(imported, contact) {
        wavOpens.push({ imported, contact }); return Promise.resolve(true);
      } };
    } },
    PlecotusManualReviewUI: { init: options => {
      manualOptions = options;
      if (realManual) manual = require('../manual-review-ui.js').init(options);
      return manual;
    } },
    PlecotusFinalSummaryData: require('../final-summary-data.js'),
    PlecotusFinalSummaryUI: { init: options => { finalOptions = options; return final; } }
  };
  if (withContext) context.PlecotusContactContextUI = { init: options => {
    contextOptions = options;
    return { show(index, opener) { contextShows.push({ index, opener, imported: options.getImported() }); },
      refresh() { contextRefreshCount++; }, reset() { contextResetCount++; } };
  } };
  if (withStepOneExport) {
    context.PlecotusStepOneSpecies = require('../step-one-species.js');
    context.PlecotusStepOneSpeciesUI = { init: options => {
      stepOneOptions = options;
      return { refresh() { stepOneRefreshCount++; }, reset() { stepOneResetCount++; } };
    } };
  }
  if (withUnresolvedPass) context.PlecotusUnresolvedReviewUI = require('../unresolved-review-ui.js');
  vm.runInNewContext(fs.readFileSync(require.resolve('../welcome.js'), 'utf8'), context, { filename: 'welcome.js' });
  async function load(fileName = imported.fileName) {
    decisionsCreated = new Promise(resolve => { finishDecisions = resolve; });
    node('data-file').files = [{ name: fileName }];
    node('data-file').fire('change');
    // File loading awaits both import and decision fingerprinting.
    await decisionsCreated;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(node('import-error').hidden, true, node('import-error').textContent);
    assert.equal(node('save-results').hidden, false, 'the asynchronous source import completed');
    if (startReview) node('start-review').fire('click');
  }
  if (loadFile) await load();
  return { node, manual, final,
    document, load,
    decisions: () => decisions,
    listeningContext: { shows: contextShows, wavOpens, options: () => contextOptions,
      refreshCount: () => contextRefreshCount, resetCount: () => contextResetCount },
    stepOneExport: { options: () => stepOneOptions, refreshCount: () => stepOneRefreshCount,
      resetCount: () => stepOneResetCount },
    manualRefreshCount: () => manualRefreshCount,
    plan: () => manualOptions.getPlan(),
    finalize: () => manualOptions.onFinalize(),
    change(settings) {
      const previous = preferences;
      preferences = { ...preferences, reviewSettings: Settings.normalize(settings) };
      settingsCallback(preferences, previous);
    },
    setReviewer(name) {
      const previous = preferences;
      preferences = { ...preferences, reviewer: name };
      settingsCallback(preferences, previous);
    },
    async save() { await node('save-results').fire('click'); return savedBlob.text(); }
  };
}

test('settings update method explanations, displayed best and the next-step gate', async () => {
  const a = await app();
  assert.match(a.node('species-groups').textContent, /contact-0\.wav/);
  a.node('debug-validate-all').fire('click');
  assert.equal(a.node('review-next-button').attributes['aria-disabled'], 'false');
  a.change({ ratioThreshold: .85, majorityThreshold: .7, excludedSpecies: ['PIPPIP'],
    ranking: [{ key: 'qual', direction: 'desc' }] });
  assert.match(a.node('species-groups').textContent, /contact-9\.wav/);
  assert.equal(a.node('review-next-button').attributes['aria-disabled'], 'true');
  assert.match(a.node('best-ranking-criteria').textContent, /Qual · ordre décroissant/);
  assert.match(a.node('manual-ratio-condition').textContent, /Au moins 70 %.*≥ 0,85/);
  assert.match(a.node('manual-excluded-species').textContent, /PIPPIP/);
  assert.equal(a.decisions().get(0).manualId, 'PIPPIP');
  const plan = a.plan();
  assert.equal(plan.groups[0].best.recordIndex, 9);
  assert.equal(plan.groups[0].qualifyingCount, 1);
  assert.equal(plan.groups[0].sensitive, true);
});

test('changing the reference returns manual or final screens to an unreviewed best without losing decisions', async () => {
  for (const screen of ['manual', 'final']) {
    const a = await app();
    a.node('debug-validate-all').fire('click');
    a.node('review-next-button').fire('click');
    assert.equal(a.node('manual-plan-overview').hidden, false);
    if (screen === 'final') { a.finalize(); assert.equal(a.node('final-summary').hidden, false); }
    a.change({ ranking: [{ key: 'qual', direction: 'desc' }] });
    assert.equal(a.node('species-overview').hidden, false);
    assert.equal(a.node('manual-plan-overview').hidden, true);
    assert.equal(a.node('final-summary').hidden, true);
    assert.equal(a.node('review-next-button').attributes['aria-disabled'], 'true');
    assert.equal(a.decisions().snapshot().decisions.length, 1);
    assert.equal(a.decisions().get(0).manualId, 'PIPPIP');
  }
});

test('stricter thresholds close stale final results, require more controls and are applied to saved CSV', async () => {
  const a = await app();
  a.node('debug-validate-all').fire('click');
  a.node('review-next-button').fire('click');
  a.finalize();
  assert.equal(a.node('final-summary').hidden, false);
  assert.equal(a.plan().groups[0].mode, 'auto');
  let csv = Core.parseCSV(await a.save());
  let semi = csv.headers.indexOf('SEMIMANUAL ID');
  assert.equal(csv.records.filter(row => row[semi] === 'PIPPIP').length, 10);
  a.change({ ratioThreshold: .95, majorityThreshold: 1 });
  assert.equal(a.node('final-summary').hidden, true);
  assert.equal(a.node('manual-plan-overview').hidden, false);
  assert.equal(a.plan().groups[0].mode, 'sample');
  assert.ok(a.plan().remaining > 0);
  csv = Core.parseCSV(await a.save());
  semi = csv.headers.indexOf('SEMIMANUAL ID');
  assert.equal(csv.records.filter(row => row[semi] === 'PIPPIP').length, 1);
  assert.equal(a.node('results-save-status').dataset.error, 'false');
});

test('deferring a best permits the next screen but remains visible and blocks real manual finalization', async () => {
  const a = await app({ realManual: true });
  const best = a.node('species-groups').querySelector('button[data-decision="unresolved"]');
  assert.match(best.attributes['aria-label'], /Identification incertaine\/non résolue/);
  best.fire('click');
  assert.equal(a.decisions().get(0).status, 'unresolved');
  assert.equal(a.decisions().get(0).manualId, null);
  assert.equal(a.node('review-next-button').attributes['aria-disabled'], 'false');
  assert.match(a.node('review-next-status').textContent, /identification reste à reprendre/);
  assert.equal(a.node('unresolved-review-panel').hidden, false);
  assert.equal(a.node('unresolved-review-heading').textContent, 'Identifications à reprendre (1)');
  const card = a.node('unresolved-review-list').children[0];
  assert.match(card.textContent, /contact-0\.wav/);
  const row = card.querySelector('tr[data-contact-index]');
  assert.equal(row.dataset.reviewStatus, 'unresolved');
  assert.equal(row.querySelector('button[data-decision="unresolved"]').attributes['aria-pressed'], 'true');
  const editor = card.querySelector('[data-identification-index]');
  assert.equal(editor.hidden, false);
  assert.match(editor.querySelector('p').textContent, /ne compte pas comme une identification NoID/);
  a.node('review-next-button').fire('click');
  assert.equal(a.node('manual-plan-overview').hidden, false);
  assert.equal(a.node('manual-finalize-button').disabled, true);
  assert.match(a.node('manual-finalize-status').textContent, /incertaine\/non résolue.*à reprendre/);
  assert.equal(a.plan().proportionalAssignments.length, 0);
  const openDetail = a.node('manual-species-rows').querySelector('button');
  openDetail.fire('click');
  assert.ok(a.node('manual-contact-list').querySelector('tr[data-contact-index="0"]'), 'deferred best is available in the manual detail');
});

test('resolving a deferred identification from the persistent panel updates all copies and keeps a final NoID outcome', async () => {
  const a = await app({ realManual: true, autoId: 'NoID' });
  a.node('species-groups').querySelector('button[data-decision="unresolved"]').fire('click');
  a.node('review-next-button').fire('click');
  const plan = a.plan();
  assert.equal(plan.groups[0].mode, 'sample');
  assert.equal(plan.groups[0].sampleTarget, 2);
  assert.equal(plan.groups[0].sensitive, true);
  const editor = a.node('unresolved-review-list').querySelector('select');
  assert.ok(editor.children.some(option => /Identification incertaine\/non résolue.*à revoir/.test(option.textContent)));
  editor.value = 'NoID';
  editor.fire('change');
  assert.equal(a.decisions().get(0).status, 'validated');
  assert.equal(a.decisions().get(0).manualId, 'NoID');
  assert.equal(a.node('unresolved-review-panel').hidden, true);
  assert.equal(a.node('unresolved-review-list').children.length, 0);
  assert.equal(a.node('species-groups').querySelector('tr[data-contact-index="0"]').dataset.reviewStatus, 'validated');
  a.node('manual-plan-debug-all').fire('click');
  assert.equal(a.node('manual-finalize-button').disabled, false);
  a.node('manual-finalize-button').fire('click');
  assert.equal(a.node('final-summary').hidden, false);
  assert.equal(a.plan().groups[0].mode, 'sample', 'manual NoID completion never globally confirms the source NoID group');
});

test('the full unresolved select choice remains mandatory after the ranking changes the sampled reference', async () => {
  const a = await app({ realManual: true });
  a.node('species-groups').querySelector('button[data-decision="invalidated"]').fire('click');
  const select = a.node('species-groups').querySelector('select');
  select.value = select.children.find(option => /Identification incertaine\/non résolue.*à revoir/.test(option.textContent)).value;
  select.fire('change');
  a.change({ ranking: [{ key: 'qual', direction: 'desc' }] });
  a.node('debug-validate-all').fire('click');
  a.node('review-next-button').fire('click');
  assert.equal(a.plan().groups[0].best.recordIndex, 9);
  assert.ok(a.plan().requiredIndices.includes(0));
  assert.equal(a.node('manual-finalize-button').disabled, true);
  const card = a.node('unresolved-review-list').querySelector('select');
  card.value = 'MYODAU';
  card.fire('change');
  assert.equal(a.decisions().get(0).manualId, 'MYODAU');
  assert.equal(a.node('unresolved-review-panel').hidden, true);
  assert.equal(a.plan().unresolvedIndices.length, 0);
});

test('an imported unresolved manual value can be resolved then reviewed through finalization', async () => {
  const a = await app({ realManual: true, manualId: Decisions.UNRESOLVED_LABEL, startReview: false });
  assert.equal(a.node('start-review').hidden, false, 'a partly identified file remains accessible for review');
  assert.equal(a.node('start-review').textContent, 'Reprendre la vérification par espèce');
  assert.equal(a.node('unresolved-review-panel').hidden, false);
  assert.equal(a.node('unresolved-review-heading').textContent, 'Identifications à reprendre (1)');
  const editor = a.node('unresolved-review-list').querySelector('[data-identification-index]');
  assert.equal(editor.hidden, false);
  const select = editor.querySelector('select');
  select.value = 'PIPPIP';
  select.fire('change');
  assert.equal(a.decisions().get(0).manualId, 'PIPPIP');
  assert.equal(a.node('unresolved-review-panel').hidden, true);
  a.node('start-review').fire('click');
  assert.equal(a.node('species-overview').hidden, false);
  assert.match(a.node('species-groups').textContent, /contact-0\.wav/);
  assert.equal(a.node('review-next-button').attributes['aria-disabled'], 'false');
  a.node('review-next-button').fire('click');
  assert.equal(a.node('manual-plan-overview').hidden, false);
  assert.equal(a.node('manual-finalize-button').disabled, false);
  a.node('manual-finalize-button').fire('click');
  assert.equal(a.node('final-summary').hidden, false);
});

test('optional step-one comments autosave without changing the review gate and survive decision changes', async () => {
  const a = await app();
  const card = a.node('species-groups').children[0];
  const comment = card.querySelector('textarea[data-comment-index="0"]');
  assert.ok(comment, 'the best-contact card exposes an optional comment textarea before any decision');
  assert.match(card.textContent, /Commentaire \(facultatif\)/);
  const text = 'Cri social ?\nDébut faible, puis son net — à comparer.';
  comment.value = text; comment.fire('input');
  assert.equal(a.decisions().getComment(0), text);
  assert.equal(a.decisions().get(0), null, 'a comment alone is not a manual identification');
  assert.equal(a.decisions().snapshot().decisions.length, 0);
  assert.equal(a.node('review-next-button').attributes['aria-disabled'], 'true');
  assert.equal(a.manualRefreshCount(), 0, 'typing does not refresh the manual plan');
  assert.equal(card.querySelector('textarea[data-comment-index="0"]'), comment);
  const status = card.querySelector('[data-comment-status-index="0"]');
  assert.match(status.textContent, /session/);
  assert.match(status.textContent, /indisponible/);
  card.querySelector('button[data-decision="validated"]').fire('click');
  assert.equal(a.decisions().getComment(0), text);
  card.querySelector('button[data-decision="invalidated"]').fire('click');
  assert.equal(a.decisions().getComment(0), text);
  const identification = card.querySelector('select');
  identification.value = 'MYODAU'; identification.fire('change');
  assert.equal(a.decisions().getComment(0), text);
  assert.equal(a.decisions().get(0).manualId, 'MYODAU');
});

test('comments follow a source contact across duplicate cards and navigation while shared WAVs stay independent', async () => {
  const a = await app({ realManual: true, autoId: 'NoID', sameFile: true });
  const original = a.node('species-groups').querySelector('textarea[data-comment-index="0"]');
  assert.ok(original, 'comment editor is visible on the first contact');
  original.value = 'Première écoute'; original.fire('input');
  a.node('species-groups').querySelector('button[data-decision="unresolved"]').fire('click');
  const duplicate = a.node('unresolved-review-list').querySelector('textarea[data-comment-index="0"]');
  assert.equal(duplicate.value, 'Première écoute');
  duplicate.focus();
  duplicate.value = 'Premier contact : son faible';
  duplicate.selectionStart = duplicate.selectionEnd = 8;
  const writes = duplicate.valueWrites;
  duplicate.fire('input');
  assert.equal(a.node('unresolved-review-list').querySelector('textarea[data-comment-index="0"]'), duplicate);
  assert.equal(duplicate.valueWrites, writes, 'synchronization does not assign the focused textarea value again');
  assert.equal(duplicate.selectionStart, 8);
  assert.equal(duplicate.selectionEnd, 8);
  assert.equal(original.value, duplicate.value);
  a.node('review-next-button').fire('click');
  a.node('manual-species-rows').querySelector('button').fire('click');
  const detail = a.node('manual-contact-list');
  assert.equal(detail.querySelector('textarea[data-comment-index="0"]').value, duplicate.value);
  const other = detail.querySelectorAll('textarea').find(field => field.dataset.commentIndex !== '0');
  assert.ok(other, 'the additional sampled contact also exposes an optional comment');
  other.value = 'Autre contact du même WAV'; other.fire('input');
  assert.equal(a.decisions().getComment(Number(other.dataset.commentIndex)), 'Autre contact du même WAV');
  assert.equal(a.decisions().getComment(0), duplicate.value);
  a.node('manual-species-back').fire('click');
  a.node('manual-plan-back').fire('click');
  assert.equal(a.node('species-groups').querySelector('textarea[data-comment-index="0"]').value, duplicate.value);
  a.change({ ratioThreshold: .75 });
  assert.equal(a.node('species-groups').querySelector('textarea[data-comment-index="0"]').value, duplicate.value);
});

test('an empty optional comment never blocks verification or finalization', async () => {
  const a = await app({ realManual: true });
  const field = a.node('species-groups').querySelector('textarea[data-comment-index="0"]');
  assert.ok(field, 'the optional editor is present');
  assert.equal(field.required, false);
  assert.equal(field.value, '');
  field.fire('input');
  a.node('debug-validate-all').fire('click');
  a.node('review-next-button').fire('click');
  assert.equal(a.node('manual-finalize-button').disabled, false);
  a.node('manual-finalize-button').fire('click');
  assert.equal(a.node('final-summary').hidden, false);
});

test('the real results CSV includes an optional comment even before the contact is identified', async () => {
  const a = await app();
  const field = a.node('species-groups').querySelector('textarea[data-comment-index="0"]');
  assert.ok(field, 'the optional editor is present');
  const text = 'Écoute 1, faible ; "cri social" ?\nVérifier le début.';
  field.value = text; field.fire('input');
  const csv = Core.parseCSV(await a.save());
  const column = csv.headers.indexOf('COMMENTAIRE PLECOTUS');
  assert.ok(column >= 0, 'results export contains the Plecotus comment column');
  assert.equal(csv.records[0][column], text);
  assert.equal(csv.records[1][column], '');
  assert.equal(a.decisions().get(0), null);
});

test('header reviewer is rendered before import from saved names with an explicit blank marker', async () => {
  for (const name of [undefined, '', '  \t  ', 'Alice Dupont', '  Élodie Van der Meer  ']) {
    const a = await app({ initialReviewer: name, loadFile: false });
    const header = a.node('header-reviewer-name');
    const expected = typeof name === 'string' ? name.trim() : '';
    assert.equal(header.textContent, expected || 'non spécifié');
    assert.equal(header.dataset.unspecified, String(!expected));
  }
});

test('header reviewer changes only when saved preferences change and renders names as safe text', async () => {
  const a = await app({ initialReviewer: 'Alice', loadFile: false });
  const header = a.node('header-reviewer-name');
  const unsaved = a.node('settings-reviewer');
  unsaved.value = 'Benoît'; unsaved.fire('input');
  assert.equal(header.textContent, 'Alice', 'editing an unsaved settings field does not change the header');
  const name = '<img src=x onerror="alert(1)"> & Élodie';
  a.setReviewer('  ' + name + '  ');
  assert.equal(header.textContent, name);
  assert.equal(header.children.length, 0, 'reviewer text is never inserted as markup');
  assert.equal(header.dataset.unspecified, 'false');
  a.setReviewer('   ');
  assert.equal(header.textContent, 'non spécifié');
  assert.equal(header.dataset.unspecified, 'true');
});

test('header reviewer survives comments, review navigation, rule changes and a new file import', async () => {
  const a = await app({ realManual: true, initialReviewer: 'Alice Dupont' });
  const assertReviewer = () => assert.equal(a.node('header-reviewer-name').textContent, 'Alice Dupont');
  const field = a.node('species-groups').querySelector('textarea[data-comment-index="0"]');
  field.value = 'Son net'; field.fire('input');
  assertReviewer();
  a.node('debug-validate-all').fire('click');
  a.node('review-next-button').fire('click');
  assert.equal(a.node('manual-plan-overview').hidden, false);
  assertReviewer();
  a.node('manual-plan-back').fire('click');
  a.change({ ratioThreshold: .7 });
  assertReviewer();
  await a.load('autre-fichier.csv');
  assert.equal(a.node('selected-file').textContent, 'Fichier chargé : autre-fichier.csv');
  assertReviewer();
});

test('context buttons use original contact indices across best, supplementary and deferred cards', async () => {
  const a = await app({ withContext: true, realManual: true, sameFile: true });
  const button = a.node('species-groups').querySelector('button[data-context-index="0"]');
  assert.ok(button, 'the best contact offers chronological listening context');
  button.fire('click');
  assert.equal(a.listeningContext.shows.at(-1).index, 0);
  assert.equal(a.listeningContext.shows.at(-1).opener, button);
  a.node('species-groups').querySelector('button[data-decision="unresolved"]').fire('click');
  const deferred = a.node('unresolved-review-list').querySelector('button[data-context-index="0"]');
  assert.ok(deferred, 'deferred cards share the same context button');
  deferred.fire('click');
  assert.equal(a.listeningContext.shows.at(-1).index, 0);
  a.node('species-groups').querySelector('button[data-decision="validated"]').fire('click');
  a.change({ excludedSpecies: ['PIPPIP'] });
  a.node('review-next-button').fire('click');
  const group = a.plan().groups[0];
  a.node('manual-species-rows').querySelector('button').fire('click');
  for (const index of group.requiredIndices) {
    const neighbor = a.node('manual-contact-list').querySelector('button[data-context-index="' + index + '"]');
    assert.ok(neighbor, 'supplementary contact ' + index + ' offers chronological context');
    neighbor.fire('click');
    assert.equal(a.listeningContext.shows.at(-1).index, index, 'duplicate WAV filenames never replace source indices');
  }
});

test('context opening reuses the configured WAV adapter, refreshes live decisions and resets on a new file', async () => {
  const a = await app({ withContext: true });
  const options = a.listeningContext.options();
  assert.ok(options, 'the chronological context controller is initialized');
  const imported = options.getImported();
  assert.equal(await options.onOpenContact(3), true);
  assert.equal(a.listeningContext.wavOpens.at(-1).imported, imported);
  assert.equal(a.listeningContext.wavOpens.at(-1).contact.recordIndex, 3);
  const refreshBefore = a.listeningContext.refreshCount();
  a.node('species-groups').querySelector('button[data-decision="validated"]').fire('click');
  assert.equal(options.getDecision(0).manualId, 'PIPPIP');
  assert.ok(a.listeningContext.refreshCount() > refreshBefore);
  const resetBefore = a.listeningContext.resetCount();
  await a.load('different.csv');
  assert.ok(a.listeningContext.resetCount() > resetBefore);
  assert.notEqual(options.getImported(), imported);
  assert.equal(options.getImported().fileName, 'different.csv');
  const opensBefore = a.listeningContext.wavOpens.length;
  assert.equal(await options.onOpenContact(3, imported), false);
  assert.equal(a.listeningContext.wavOpens.length, opensBefore, 'an obsolete panel cannot open an index in the replacement source');
});

test('context markup provides one modeless labelled panel and local dependencies', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const id of ['contact-context', 'contact-context-heading', 'contact-context-summary', 'contact-context-table-body', 'contact-context-close', 'contact-context-status']) {
    assert.ok(html.includes('id="' + id + '"'), id);
  }
  assert.match(html, /<section[^>]*id="contact-context"[^>]*role="dialog"[^>]*aria-modal="false"/);
  for (const source of ['contact-context-data.js', 'contact-context-ui.js']) {
    assert.ok(html.includes('<script defer src="' + source + '"></script>'), source);
  }
  assert.ok(html.includes('<link rel="stylesheet" href="contact-context.css">'));
});

test('step-one names export becomes ready before supplementary checks and tracks corrected best identifications', async () => {
  const a = await app({ withStepOneExport: true, realManual: true });
  const options = a.stepOneExport.options();
  assert.ok(options, 'the names-only exporter is initialized');
  assert.equal(options.getData().ready, false);
  a.change({ excludedSpecies: ['PIPPIP'] });
  const before = a.stepOneExport.refreshCount();
  a.node('species-groups').querySelector('button[data-decision="validated"]').fire('click');
  assert.ok(a.stepOneExport.refreshCount() > before);
  assert.ok(a.plan().remaining > 0, 'additional manual checks are still required');
  const data = options.getData();
  assert.equal(data.ready, true);
  assert.equal(data.rows[0].scientificName, 'Pipistrellus pipistrellus');
  assert.equal(data.rows[0].frenchName, 'Pipistrelle commune');
  assert.equal('contacts' in data.rows[0], false);
  a.node('species-groups').querySelector('button[data-decision="invalidated"]').fire('click');
  assert.equal(options.getData().ready, false);
  const choice = a.node('species-groups').querySelector('select');
  choice.value = 'MYODAU'; choice.fire('change');
  assert.equal(options.getData().ready, true);
  assert.equal(options.getData().rows[0].scientificName, 'Myotis daubentonii');
  assert.equal(options.getData().fileName, 'contacts.csv');
});

test('step-one export recomputes a changed best and resets immediately when importing another source', async () => {
  const a = await app({ withStepOneExport: true });
  const options = a.stepOneExport.options();
  a.node('species-groups').querySelector('button[data-decision="validated"]').fire('click');
  const first = options.getData();
  assert.equal(first.ready, true);
  a.change({ ranking: [{ key: 'qual', direction: 'desc' }] });
  assert.equal(options.getData().ready, false);
  assert.deepEqual(Array.from(options.getData().bestIndices), [9]);
  a.node('species-groups').querySelector('button[data-decision="validated"]').fire('click');
  a.decisions().set(1, 'unresolved');
  assert.equal(options.getData().ready, true, 'a non-best deferred contact does not block this stage-one list');
  const resetBefore = a.stepOneExport.resetCount();
  await a.load('other.csv');
  assert.ok(a.stepOneExport.resetCount() > resetBefore);
  assert.notEqual(options.getData().sourceVersion, first.sourceVersion);
  assert.equal(options.getData().fileName, 'other.csv');
});

test('names-only export controls are present after step one and above the supplementary controls', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  assert.equal((html.match(/data-step-one-species-export="csv"/g) || []).length, 2);
  assert.equal((html.match(/data-step-one-species-export="jpeg"/g) || []).length, 2);
  assert.ok(html.indexOf('data-step-one-species-export=') < html.indexOf('id="review-next-button"'));
  const manual = html.slice(html.indexOf('id="manual-plan-overview"'), html.indexOf('id="manual-species-detail"'));
  assert.match(manual, /data-step-one-species-export="csv"/);
  for (const name of ['step-one-species.js', 'step-one-species-ui.js']) {
    assert.ok(html.includes('<script defer src="' + name + '"></script>'));
  }
});

test('the unresolved pass reuses real contact cards, keeps an invalidated attempt pending and advances once after identification', async () => {
  const a = await app({ withUnresolvedPass: true, withContext: true, realManual: true, sameFile: true });
  a.decisions().set(2, 'unresolved');
  a.decisions().set(4, 'unresolved');
  a.decisions().setComment(0, 'Son compliqué\nÀ comparer avec un collègue.');
  a.node('species-groups').querySelector('button[data-decision="unresolved"]').fire('click');
  a.node('unresolved-pass-start').fire('click');
  const host = a.node('unresolved-pass-card');
  assert.equal(host.children.length, 1);
  assert.match(host.children[0].querySelector('h3').textContent, /PIPPIP/, 'the original AUTO-ID is visible before revalidation');
  assert.equal(host.querySelector('tr[data-contact-index]').dataset.contactIndex, '0');
  assert.equal(host.querySelector('textarea').value, a.decisions().getComment(0));
  assert.equal(a.node('unresolved-review-list').hidden, true);
  assert.equal(a.listeningContext.wavOpens.length, 0, 'entering a re-review pass does not launch audio automatically');
  host.querySelector('button').fire('click');
  assert.equal(a.listeningContext.wavOpens.at(-1).contact.recordIndex, 0);
  host.querySelector('button[data-context-index="0"]').fire('click');
  assert.equal(a.listeningContext.shows.at(-1).index, 0);
  host.querySelector('button[data-decision="invalidated"]').fire('click');
  assert.equal(a.decisions().get(0).status, 'unresolved', 'an incomplete attempt remains CSV-resumable as uncertain');
  assert.equal(host.querySelector('tr[data-contact-index]').dataset.contactIndex, '0');
  const choice = host.querySelector('select');
  choice.value = 'MYODAU'; choice.fire('change');
  assert.equal(a.decisions().get(0).manualId, 'MYODAU');
  assert.equal(host.querySelector('tr[data-contact-index]').dataset.contactIndex, '2');
  host.querySelector('button').fire('click');
  assert.equal(a.listeningContext.wavOpens.at(-1).contact.recordIndex, 2);
  assert.equal(a.document.activeElement, a.node('unresolved-pass-heading'), 'the old card cannot reclaim focus after advance');
  a.node('unresolved-pass-previous').fire('click');
  assert.equal(host.querySelector('tr[data-contact-index]').dataset.contactIndex, '0');
  assert.equal(host.querySelector('textarea').value, 'Son compliqué\nÀ comparer avec un collègue.');
  a.node('unresolved-pass-next').fire('click');
  const second = host.querySelector('select');
  second.value = 'NoID'; second.fire('change');
  assert.equal(host.querySelector('tr[data-contact-index]').dataset.contactIndex, '4');
  assert.equal(a.decisions().get(2).manualId, 'NoID');
  host.querySelector('button[data-decision="unresolved"]').fire('click');
  assert.equal(a.decisions().get(4).status, 'unresolved');
  assert.equal(a.node('unresolved-review-panel').hidden, false);
  a.node('unresolved-pass-restart').fire('click');
  assert.equal(host.querySelector('tr[data-contact-index]').dataset.contactIndex, '4');
  host.querySelector('button[data-decision="validated"]').fire('click');
  assert.equal(a.plan().unresolvedIndices.length, 0);
  assert.equal(a.node('unresolved-review-panel').hidden, false, 'the completion summary stays visible until closed');
  a.node('unresolved-pass-close').fire('click');
  assert.equal(a.node('unresolved-review-panel').hidden, true);
  assert.equal(a.document.activeElement, a.node('species-heading'), 'closing the completed pass focuses a visible screen heading');
});

test('a re-review completion keeps supplementary checks required and old cards cannot affect a new import', async () => {
  const a = await app({ withUnresolvedPass: true, realManual: true });
  a.change({ excludedSpecies: ['PIPPIP'] });
  a.node('species-groups').querySelector('button[data-decision="unresolved"]').fire('click');
  a.node('review-next-button').fire('click');
  assert.equal(a.node('manual-finalize-button').disabled, true);
  a.node('unresolved-pass-start').fire('click');
  const oldCard = a.node('unresolved-pass-card').children[0];
  oldCard.querySelector('button[data-decision="validated"]').fire('click');
  assert.equal(a.plan().unresolvedIndices.length, 0);
  assert.ok(a.plan().remaining > 0);
  assert.equal(a.node('manual-finalize-button').disabled, true);
  await a.load('new.csv');
  assert.equal(a.node('unresolved-pass').hidden, true);
  assert.equal(a.node('unresolved-pass-card').children.length, 0);
  const before = JSON.stringify(a.decisions().snapshot());
  oldCard.querySelector('button[data-decision="unresolved"]').fire('click');
  oldCard.querySelector('select').value = 'MYODAU'; oldCard.querySelector('select').fire('change');
  oldCard.querySelector('textarea').value = 'Ancien contact'; oldCard.querySelector('textarea').fire('input');
  assert.equal(JSON.stringify(a.decisions().snapshot()), before);
});

test('the pass includes imported uncertainty and Noise, while confirming an empty AUTO-ID still asks for a real identity', async () => {
  for (const autoId of ['Noise', '']) {
    const a = await app({ withUnresolvedPass: true, autoId, manualId: Decisions.UNRESOLVED_LABEL, startReview: false });
    a.node('unresolved-pass-start').fire('click');
    const host = a.node('unresolved-pass-card');
    assert.equal(host.querySelector('tr[data-contact-index]').dataset.contactIndex, '0');
    host.querySelector('button[data-decision="invalidated"]').fire('click');
    assert.equal(a.decisions().get(0).status, 'unresolved');
    if (!autoId) {
      host.querySelector('button[data-decision="validated"]').fire('click');
      assert.equal(a.decisions().get(0).status, 'unresolved');
      assert.equal(host.querySelector('select').focused, true);
    }
    const saved = Core.parseCSV(await a.save());
    assert.equal(saved.records[0][saved.headers.indexOf('ORIGINE ID PLECOTUS')], Results.ORIGINS.unresolved);
    const select = host.querySelector('select');
    select.value = 'NoID'; select.fire('change');
    assert.equal(a.decisions().get(0).manualId, 'NoID');
    assert.equal(a.plan().unresolvedIndices.length, 0);
  }
});

test('unresolved one-by-one controls are labelled and included in the local application', () => {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  for (const id of ['unresolved-pass-start', 'unresolved-pass', 'unresolved-pass-heading', 'unresolved-pass-progress',
    'unresolved-pass-card', 'unresolved-pass-previous', 'unresolved-pass-next', 'unresolved-pass-restart',
    'unresolved-pass-close', 'unresolved-pass-status']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.ok(html.includes('<script defer src="unresolved-review-ui.js"></script>'));
  assert.ok(html.includes('<link rel="stylesheet" href="unresolved-review.css">'));
});

test('closing a completed pass after finalization returns focus to the visible final summary', async () => {
  const a = await app({ withUnresolvedPass: true, realManual: true });
  a.node('species-groups').querySelector('button[data-decision="unresolved"]').fire('click');
  a.node('review-next-button').fire('click');
  a.node('unresolved-pass-start').fire('click');
  a.node('unresolved-pass-card').querySelector('button[data-decision="validated"]').fire('click');
  assert.equal(a.node('manual-finalize-button').disabled, false);
  a.node('manual-finalize-button').fire('click');
  assert.equal(a.node('final-summary').hidden, false);
  a.node('unresolved-pass-close').fire('click');
  assert.equal(a.document.activeElement, a.node('final-summary-heading'));
});
