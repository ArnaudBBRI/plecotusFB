const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(initial = [1, 4, 9], options = {}) {
  const file = path.join(__dirname, '..', 'unresolved-review-ui.js');
  assert.ok(fs.existsSync(file), 'the one-at-a-time unresolved review controller exists');
  let activeElement = null;
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.hidden = true; this.disabled = false; this.textContent = ''; this.value = ''; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    fire(name) { if (!this.disabled) return this.listeners.get(name)?.({ preventDefault() {}, target: this }); }
    focus() { activeElement = this; }
  }
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const document = { getElementById: node, get activeElement() { return activeElement; } };
  let source = { id: 1 }, live = initial.slice(), stateChanges = 0;
  const complete = new Set(), rendered = [];
  const browser = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), browser, { filename: 'unresolved-review-ui.js' });
  const ui = browser.PlecotusUnresolvedReviewUI.init({ document,
    getSource: () => source,
    getItems: () => live.map(index => ({ recordIndex: index, label: index === 4 ? 'Noise' : 'PIPPIP',
      contact: { recordIndex: index, lineNumber: index + 2, fileName: 'contact-' + index + '.wav' } })),
    isComplete: index => complete.has(index),
    renderContactCard(contact, label) {
      rendered.push({ contact, label });
      const card = new Node('article'); card.dataset.recordIndex = String(contact.recordIndex);
      const input = new Node('textarea'); input.value = 'Commentaire conservé'; card.append(input);
      return card;
    },
    onStateChange: () => stateChanges++,
    onExit: options.onExit });
  return { ui, node, document, complete, rendered,
    current: () => node('unresolved-pass-card').children[0],
    currentIndex() { const card = this.current(); return card ? Number(card.dataset.recordIndex) : null; },
    setItems(items) { live = items; }, setSource(value) { source = value; },
    stateChanges: () => stateChanges };
}

test('show snapshots every unresolved category in a single shared card without initialization callbacks', () => {
  const a = fixture();
  assert.equal(a.stateChanges(), 0, 'initialization cannot call a root callback before its controller variable exists');
  assert.equal(a.ui.isActive(), false);
  a.node('unresolved-pass-start').fire('click');
  assert.equal(a.ui.isActive(), true);
  assert.equal(a.node('unresolved-pass').hidden, false);
  assert.equal(a.node('unresolved-pass-start').hidden, true);
  assert.equal(a.node('unresolved-pass-card').children.length, 1);
  assert.equal(a.currentIndex(), 1);
  assert.equal(a.current().dataset.unresolvedPass, 'true');
  assert.match(a.node('unresolved-pass-progress').textContent, /1\s*\/\s*3/);
  assert.equal(a.node('unresolved-pass-previous').disabled, true);
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.currentIndex(), 4);
  assert.equal(a.rendered.at(-1).label, 'Noise', 'source Noise remains part of the pass');
  assert.equal(a.stateChanges(), 1);
});

test('refresh never advances or rebuilds a focused card, while completed user decisions advance once and retain history', () => {
  const a = fixture(); a.ui.show();
  const original = a.current(), comment = original.children[0];
  comment.focus(); comment.value = 'Un son faible, à comparer';
  a.complete.add(1); a.setItems([4, 9]); a.ui.refresh();
  assert.equal(a.current(), original);
  assert.equal(a.document.activeElement, comment);
  assert.equal(comment.value, 'Un son faible, à comparer');
  assert.equal(a.currentIndex(), 1, 'a background decision refresh does not change the current contact');
  a.ui.afterDecision(1);
  assert.equal(a.currentIndex(), 4);
  a.ui.show();
  assert.equal(a.currentIndex(), 4, 'showing the active pass again does not restart it');
  assert.equal(a.node('unresolved-pass-previous').disabled, false, 'the active pass still retains its resolved history');
  a.ui.afterDecision(1);
  assert.equal(a.currentIndex(), 4, 'a duplicate completion callback cannot skip another card');
  a.complete.add(4); a.setItems([9]); a.ui.afterDecision(4);
  assert.equal(a.currentIndex(), 9);
  a.node('unresolved-pass-previous').fire('click');
  assert.equal(a.currentIndex(), 4, 'previous revisits a resolved card even though it left the live unresolved list');
  a.node('unresolved-pass-previous').fire('click');
  assert.equal(a.currentIndex(), 1);
});

test('manual next leaves decisions unchanged, pending decisions stay put and explicit deferral progresses only forward', () => {
  const a = fixture(); a.ui.show();
  a.ui.afterDecision(1);
  assert.equal(a.currentIndex(), 1, 'invalidation without a real identification is incomplete');
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.currentIndex(), 4);
  assert.equal(a.complete.size, 0, 'manual navigation does not confirm any identification');
  a.ui.afterDecision(4, { deferred: true });
  assert.equal(a.currentIndex(), 9);
  a.ui.afterDecision(9, { deferred: true });
  assert.equal(a.current(), undefined);
  assert.equal(a.ui.isActive(), true, 'end summary stays active for unresolved outer-panel visibility');
  assert.match(a.node('unresolved-pass-status').textContent, /3.*reprendre/);
  assert.equal(a.node('unresolved-pass-restart').hidden, false);
  a.node('unresolved-pass-previous').fire('click');
  assert.equal(a.currentIndex(), 9);
});

test('auto progress skips only later completed contacts and restarting uses remaining contacts rather than completed history', () => {
  const a = fixture(); a.ui.show();
  a.complete.add(1); a.complete.add(4); a.setItems([9]);
  a.ui.afterDecision(1);
  assert.equal(a.currentIndex(), 9, 'forward auto progress skips a later contact already completed elsewhere');
  a.ui.afterDecision(9, { deferred: true });
  assert.match(a.node('unresolved-pass-status').textContent, /1.*reprendre/);
  a.node('unresolved-pass-restart').fire('click');
  assert.equal(a.currentIndex(), 9);
  assert.match(a.node('unresolved-pass-progress').textContent, /1\s*\/\s*1/);
  a.complete.add(9); a.setItems([]); a.ui.refresh();
  assert.equal(a.currentIndex(), 9, 'removing the final live unresolved contact still cannot advance by refresh');
  a.ui.afterDecision(9);
  assert.equal(a.current(), undefined);
  assert.equal(a.ui.isActive(), true);
  assert.match(a.node('unresolved-pass-status').textContent, /Toutes.*terminées/);
  assert.equal(a.node('unresolved-pass-restart').hidden, true);
});

test('new unresolved items merge once without moving the current card or reopening an end summary', () => {
  const a = fixture([1]); a.ui.show();
  const original = a.current();
  a.setItems([1, 4, 4]); a.ui.refresh();
  assert.equal(a.current(), original);
  assert.match(a.node('unresolved-pass-progress').textContent, /1\s*\/\s*2/);
  a.node('unresolved-pass-next').fire('click');
  a.node('unresolved-pass-next').fire('click');
  assert.equal(a.current(), undefined);
  a.setItems([1, 4, 9]); a.ui.refresh();
  assert.equal(a.current(), undefined, 'new items do not leave the end summary on a simple refresh');
  assert.match(a.node('unresolved-pass-status').textContent, /3.*reprendre/);
  a.node('unresolved-pass-restart').fire('click');
  assert.equal(a.currentIndex(), 1);
  assert.match(a.node('unresolved-pass-progress').textContent, /1\s*\/\s*3/);
});

test('source changes and explicit reset clear old cards and ignore late completion callbacks', () => {
  const a = fixture(); a.ui.show();
  a.setSource({ id: 2 }); a.ui.refresh();
  assert.equal(a.ui.isActive(), false);
  assert.equal(a.node('unresolved-pass').hidden, true);
  assert.equal(a.current(), undefined);
  a.ui.afterDecision(1, { deferred: true });
  assert.equal(a.ui.isActive(), false);
  a.ui.show(); a.ui.reset();
  assert.equal(a.current(), undefined);
  assert.equal(a.ui.isActive(), false);
  a.ui.afterDecision(1);
  assert.equal(a.current(), undefined);
  a.ui.show(); a.ui.focus();
  assert.equal(a.document.activeElement, a.node('unresolved-pass-heading'));
  a.node('unresolved-pass-close').fire('click');
  assert.equal(a.ui.isActive(), false);
  assert.equal(a.node('unresolved-pass').hidden, true);
});

test('optional exit callback runs after cleanup and owns focus without a later hidden-start override', () => {
  let exits = 0;
  const a = fixture([1], { onExit() {
    exits++;
    assert.equal(a.ui.isActive(), false);
    assert.equal(a.node('unresolved-pass').hidden, true);
    assert.equal(a.current(), undefined);
    assert.equal(a.stateChanges(), 2, 'the root visibility callback has already run');
    assert.notEqual(a.document.activeElement, a.node('unresolved-pass-start'));
    a.node('current-screen-heading').focus();
  } });
  a.ui.show();
  a.complete.add(1); a.setItems([]); a.ui.afterDecision(1);
  a.node('unresolved-pass-close').fire('click');
  assert.equal(exits, 1);
  assert.equal(a.document.activeElement, a.node('current-screen-heading'));
});
