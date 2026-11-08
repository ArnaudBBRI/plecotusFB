const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const Decisions = require('../contact-decisions.js');
const Workflow = require('../manual-workflow.js');
const Summary = require('../final-summary-data.js');
const Import = require('../file-import.js');
const Results = require('../results-file.js');

function source(labels, uncertain = []) {
  return { fileName: 'relecture.csv',
    headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'PULSES', 'DATE', 'TIME', 'MANUAL ID', 'COMMENTAIRE PLECOTUS'],
    records: labels.map((label, index) => ['same.wav', label, '.9', String(100 - index), '8', '08-11-26',
      '23:' + String(index).padStart(2, '0') + ':00', uncertain.includes(index) ? 'Uncertain' : '', 'Remarque ' + index]),
    sourceRows: labels.map((_, index) => index + 7) };
}

async function fixture(options = {}) {
  assert.ok(fs.existsSync(require('node:path').join(__dirname, '..', 'unresolved-review-ui.js')),
    'the sequential unresolved-review controller exists');
  const UI = require('../unresolved-review-ui.js');
  let imported = options.imported || source(options.labels || ['PIPPIP', 'MYODAU', 'Noise'], options.uncertain);
  let decisions = options.decisions || await Decisions.create(imported, { storage: null, crypto: webcrypto });
  for (const index of options.deferred || []) decisions.set(index, 'unresolved');
  const nodes = new Map();
  let body, activeElement;
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {};
      this.listeners = new Map(); this.hidden = false; this.textContent = ''; this.value = ''; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    fire(name) { if (name === 'click' && this.disabled) return; return this.listeners.get(name)?.({ target: this, preventDefault() {} }); }
    focus() { activeElement = this; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(selector.split(',').some(tag => tag.trim() === child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get isConnected() { let top = this; while (top.parent) top = top.parent; return top === body; }
  }
  body = new Node('body');
  const node = id => { if (!nodes.has(id)) { const element = new Node(); element.id = id; nodes.set(id, element); body.append(element); } return nodes.get(id); };
  const document = { body, getElementById: node, createElement: tag => new Node(tag), get activeElement() { return activeElement; } };
  const rendered = [], states = [];
  const plan = () => Workflow.build(imported, decisions);
  const ui = UI.init({ document, getSource: () => imported,
    getItems: () => plan().unresolvedContacts.map(contact => ({ recordIndex: contact.recordIndex, contact, label: contact.groupLabel })),
    isComplete: index => Decisions.isComplete(decisions.get(index)),
    renderContactCard(contact, label) {
      rendered.push({ contact, label });
      const card = new Node('article'); card.dataset.recordIndex = String(contact.recordIndex);
      const comment = new Node('textarea'); comment.value = decisions.getComment(contact.recordIndex); card.append(comment);
      return card;
    }, onStateChange: (...args) => states.push(args) });
  return { ui, node, plan, states, rendered, imported: () => imported, decisions: () => decisions,
    card: () => node('unresolved-pass-card').children[0],
    index: () => Number(node('unresolved-pass-card').children[0]?.dataset.recordIndex),
    async replace() {
      imported = source(['PIPNAT']);
      decisions = await Decisions.create(imported, { storage: null, crypto: webcrypto });
      decisions.set(0, 'unresolved');
      ui.refresh();
    } };
}

test('real decisions advance one source index at a time, preserve resolved history and keep the final gate blocked until all are complete', async () => {
  const a = await fixture({ deferred: [0, 1, 2] });
  const original = structuredClone(a.imported());
  assert.equal(a.ui.show(), true);
  assert.equal(a.node('unresolved-pass-card').children.length, 1);
  assert.equal(a.index(), 0);
  a.decisions().setManualId(0, 'MYODAU');
  a.ui.refresh();
  assert.equal(a.index(), 0, 'unrelated refresh cannot silently advance the current contact');
  a.ui.afterDecision(0);
  assert.equal(a.index(), 1);
  a.ui.afterDecision(0, { deferred: true });
  assert.equal(a.index(), 1, 'the previous action cannot advance a second time');
  assert.throws(() => Summary.build(a.imported(), a.plan()), /Terminez tous les contrôles/);
  const saved = a.decisions().snapshot();
  a.node('unresolved-pass-previous').fire('click');
  assert.equal(a.index(), 0, 'the resolved index remains in the pass history');
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.index(), 1);
  assert.deepEqual(a.decisions().snapshot(), saved, 'navigation alone never changes identifications');
  a.decisions().setManualId(1, 'NoID');
  a.ui.afterDecision(1);
  assert.equal(a.index(), 2);
  assert.equal(Decisions.isComplete(a.decisions().get(1)), true);
  assert.deepEqual(a.plan().unresolvedIndices, [2], 'an explicit NoID is completed while the Noise contact remains deferred');
  assert.equal(a.rendered.at(-1).label, 'Noise');
  assert.equal(a.rendered.at(-1).contact.fileName, 'same.wav');
  assert.equal(a.rendered.at(-1).contact.lineNumber, 9);
  a.decisions().set(2, 'validated');
  a.ui.afterDecision(2);
  assert.deepEqual(a.plan().unresolvedIndices, []);
  assert.equal(a.plan().assignmentReady, true);
  assert.doesNotThrow(() => Summary.build(a.imported(), a.plan()));
  assert.deepEqual(a.imported(), original);
});

test('skipping and re-deferring leave real unresolved decisions unchanged and restart only the remaining contacts', async () => {
  const a = await fixture({ deferred: [0, 1, 2] });
  a.ui.show();
  const unchanged = a.decisions().snapshot();
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.index(), 1);
  assert.deepEqual(a.decisions().snapshot(), unchanged);
  a.decisions().setManualId(1, 'NoID Myo');
  a.ui.afterDecision(1);
  assert.equal(a.index(), 2);
  const beforeDeferred = a.decisions().snapshot();
  a.ui.afterDecision(2, { deferred: true });
  assert.deepEqual(a.decisions().snapshot(), beforeDeferred, 'the pass controller does not replace the user decision');
  assert.deepEqual(a.plan().unresolvedIndices, [0, 2]);
  assert.equal(a.plan().assignmentReady, false);
  a.node('unresolved-pass-restart').fire('click');
  assert.equal(a.index(), 0);
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.index(), 2, 'completed NoID is absent from the new pass');
});

test('incomplete invalidation cannot advance and comments remain attached to duplicate WAV source indices', async () => {
  const a = await fixture({ deferred: [0, 1] });
  a.ui.show();
  const comment = '  Écoute faible\r\nÀ comparer avec le passage suivant.  ';
  a.decisions().setComment(0, comment);
  a.decisions().set(0, 'invalidated');
  a.ui.refresh();
  a.ui.afterDecision(0);
  assert.equal(a.index(), 0, 'an incomplete identification never counts as a completed decision');
  assert.equal(a.plan().assignmentReady, false);
  a.decisions().set(0, 'unresolved');
  a.ui.afterDecision(0, { deferred: true });
  assert.equal(a.index(), 1);
  assert.equal(a.card().querySelector('textarea').value, 'Remarque 1');
  a.node('unresolved-pass-previous').fire('click');
  assert.equal(a.index(), 0);
  assert.equal(a.card().querySelector('textarea').value, comment);
  assert.equal(a.decisions().getComment(1), 'Remarque 1');
});

test('source uncertainty and deferred Noise survive portable CSV and are both reachable in the real pass', async () => {
  const original = source(['PIPPIP', 'Noise'], [0, 1]);
  const choices = await Decisions.create(original, { storage: null, crypto: webcrypto });
  choices.setComment(1, 'Bruit ?\nÀ réécouter');
  assert.equal(choices.get(0), null, 'source uncertainty does not require a browser decision');
  const saved = Results.build(original, Workflow.build(original, choices), choices.snapshot());
  const bytes = Buffer.from(saved.text);
  const loaded = await Import.read({ name: saved.fileName, size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const resume = Results.prepareResume(loaded);
  const restored = await Decisions.create(resume.imported, { storage: null, crypto: webcrypto });
  Results.applyResume(restored, resume);
  const a = await fixture({ imported: resume.imported, decisions: restored });
  assert.deepEqual(a.plan().unresolvedIndices, [0, 1]);
  a.ui.show();
  assert.equal(a.index(), 0);
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.index(), 1);
  assert.equal(a.rendered.at(-1).label, 'Noise');
  assert.equal(a.card().querySelector('textarea').value, 'Bruit ?\nÀ réécouter');
  assert.equal(a.plan().assignmentReady, false);
  assert.throws(() => Summary.build(a.imported(), a.plan()), /Terminez tous les contrôles/);
});

test('finishing the pass never bypasses other real supplementary checks', async () => {
  const a = await fixture({ labels: Array(20).fill('NYCNOC'), deferred: [0] });
  a.ui.show();
  a.decisions().setManualId(0, 'NoID');
  a.ui.afterDecision(0);
  const plan = a.plan();
  assert.deepEqual(plan.unresolvedIndices, []);
  assert.ok(plan.remaining > 0);
  assert.equal(plan.assignmentReady, false);
  assert.throws(() => Summary.build(a.imported(), plan), /Terminez tous les contrôles/);
});

test('newly deferred real contacts join the current pass once without replacing its resolved history', async () => {
  const a = await fixture({ labels: ['PIPPIP', 'MYODAU', 'Noise', 'PIPNAT'], deferred: [0, 1] });
  a.ui.show();
  a.decisions().setManualId(0, 'PIPPIP');
  a.ui.afterDecision(0);
  assert.equal(a.index(), 1);
  a.decisions().set(3, 'unresolved');
  a.ui.refresh();
  a.ui.refresh();
  assert.equal(a.index(), 1);
  a.decisions().setManualId(1, 'NoID');
  a.ui.afterDecision(1);
  assert.equal(a.index(), 3);
  a.decisions().setManualId(3, 'PIPNAT');
  a.ui.afterDecision(3);
  assert.equal(a.node('unresolved-pass-next').disabled, true, 'the same newly deferred record was not appended twice');
  a.node('unresolved-pass-previous').fire('click');
  a.node('unresolved-pass-previous').fire('click');
  assert.equal(a.index(), 1, 'resolved source identities remain in their original pass order');
});

test('a replacement imported source resets pass history even when the new unresolved record has the same index and WAV name', async () => {
  const a = await fixture({ deferred: [0, 1] });
  a.ui.show();
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.index(), 1);
  await a.replace();
  assert.equal(a.ui.isActive(), false);
  assert.equal(a.node('unresolved-pass').hidden, true);
  const snapshot = a.decisions().snapshot();
  a.ui.afterDecision(1, { deferred: true });
  assert.deepEqual(a.decisions().snapshot(), snapshot);
  a.ui.show();
  assert.equal(a.index(), 0);
  assert.equal(a.rendered.at(-1).label, 'PIPNAT');
  assert.equal(a.node('unresolved-pass-previous').disabled, true);
});
