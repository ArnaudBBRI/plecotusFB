const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture(options = {}) {
  const file = path.join(__dirname, '..', 'contact-context-ui.js');
  assert.ok(fs.existsSync(file), 'the chronological context panel module exists');
  let activeElement = null;
  let scroller;
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = new Map(); this.hidden = true; this._text = ''; this.scrollTop = 0; this.isConnected = true; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this._text = ''; this.append(...children); }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    fire(name, extra = {}) { return this.listeners.get(name)?.({ target: this, preventDefault() { this.prevented = true; }, ...extra }); }
    focus() { activeElement = this; this.focusCount = (this.focusCount || 0) + 1; }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...((selector.startsWith('.')
      ? (child.className || '').split(' ').includes(selector.slice(1)) : child.tagName === selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() { return this.tagName === 'tr'
      ? { top: 100 + this.parent.children.indexOf(this) * 30 - scroller.scrollTop, height: 30 }
      : { top: 100, height: 180 }; }
  }
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) { const value = new Node(); value.id = id; nodes.set(id, value); } return nodes.get(id); };
  const panel = node('contact-context');
  scroller = new Node(); scroller.className = 'contact-context-scroll'; scroller.clientHeight = 180;
  scroller.append(node('contact-context-table-body'));
  panel.append(node('contact-context-heading'), node('contact-context-summary'), scroller, node('contact-context-close'), node('contact-context-status'));
  const document = { getElementById: node, createElement: tag => new Node(tag),
    get activeElement() { return activeElement; } };
  const decisions = new Map();
  let imported = { fileName: 'contacts.csv', undated: false };
  const creations = [], plays = [], gets = [];
  const Data = { create(source) {
    creations.push(source);
    return { get(reference, getDecision) {
      gets.push(reference);
      const indices = source.undated ? [reference] : Array.from({ length: 23 }, (_, index) => index)
        .slice(Math.max(0, reference - 10), Math.min(23, reference + 11));
      return { beforeCount: source.undated ? 0 : Math.min(10, reference), afterCount: source.undated ? 0 : Math.min(10, 22 - reference),
        undatedCount: source.undated ? 2 : 0, referenceDated: !source.undated, missingColumns: source.undated ? ['TIME'] : [],
        rows: indices.map(index => {
          const decision = getDecision(index);
          return { recordIndex: index, lineNumber: index + 5, fileName: index === reference ? '<img src=x onerror=alert(1)>.wav' : 'same.wav',
            autoId: index === 2 ? 'Noise' : 'PIPPIP', ratio: index === 0 ? '' : '0,8', pulses: '0',
            timestamp: source.undated ? null : Date.UTC(2026, 10, 8, 22, index),
            manualId: decision?.manualId || '', manualStatus: decision?.status === 'unresolved' ? 'unresolved'
              : decision?.manualId ? 'identified' : decision ? 'pending' : 'unreviewed', isReference: index === reference };
        }) };
    } };
  } };
  const browser = { PlecotusContactContextData: Data };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), browser, { filename: 'contact-context-ui.js' });
  const ui = browser.PlecotusContactContextUI.init({ document,
    getImported: () => imported, getDecision: index => decisions.get(index) || null,
    onOpenContact: async (index, source) => { plays.push({ index, source }); return options.open ? options.open(index, source) : true; } });
  const opener = new Node('button');
  const row = index => node('contact-context-table-body').children.find(row => row.dataset.contextIndex === String(index));
  return { ui, node, panel, document, decisions, creations, plays, gets, opener, row, scroller,
    source: () => imported, setSource(source) { imported = source; } };
}

test('modeless context presents 10 before and after, includes Noise and safely marks the fixed reference', () => {
  const a = fixture();
  assert.equal(a.creations.length, 0, 'chronology index is created lazily');
  a.decisions.set(1, { status: 'invalidated' });
  a.decisions.set(3, { status: 'unresolved' });
  a.ui.show(11, a.opener);
  assert.equal(a.panel.hidden, false);
  assert.equal(a.panel.getAttribute('role'), 'dialog');
  assert.equal(a.panel.getAttribute('aria-modal'), 'false');
  assert.equal(a.node('contact-context-table-body').children.length, 21);
  assert.ok(a.scroller.scrollTop > 0, 'opening centers the reference inside the panel scroll area');
  assert.equal(a.panel.scrollTop, 0, 'centering does not scroll the containing page or panel header');
  assert.match(a.node('contact-context-summary').textContent, /10.*avant.*10.*après/);
  assert.match(a.node('contact-context-summary').textContent, /Noise/);
  const reference = a.row(11);
  assert.equal(reference.getAttribute('aria-current'), 'true');
  assert.match(reference.className, /reference/);
  assert.match(reference.textContent, /Référence/);
  assert.match(reference.textContent, /08\/11\/2026 22:11/);
  assert.equal(reference.children.length, 6);
  assert.match(a.row(2).textContent, /Noise/);
  assert.match(a.row(1).children[5].textContent, /À identifier/);
  assert.match(a.row(3).children[5].textContent, /À revoir/);
  const wav = reference.querySelectorAll('button')[0];
  assert.equal(wav.textContent, '<img src=x onerror=alert(1)>.wav');
  assert.equal(wav.children.length, 0, 'source labels are never parsed as HTML');
  assert.match(wav.getAttribute('aria-label'), /ligne 16/);
  assert.equal(a.panel.querySelectorAll('input').length + a.panel.querySelectorAll('select').length + a.panel.querySelectorAll('textarea').length, 0);
});

test('neighbor WAV opening uses its exact source index and fresh IDs update without moving rows, focus or scroll', async () => {
  const a = fixture(); a.ui.show(11, a.opener);
  const source = a.source(), row = a.row(10), wav = row.querySelectorAll('button')[0];
  wav.focus(); a.scroller.scrollTop = 95; a.panel.scrollTop = 21;
  await wav.fire('click');
  assert.equal(a.plays[0].index, 10);
  assert.equal(a.plays[0].source, source);
  assert.equal(a.row(11).getAttribute('aria-current'), 'true', 'listening to a neighbor retains the reference');
  a.decisions.set(10, { status: 'invalidated', manualId: 'MYODAU' });
  a.ui.refresh();
  assert.equal(a.row(10), row);
  assert.equal(a.row(10).querySelectorAll('button')[0], wav);
  assert.equal(a.document.activeElement, wav);
  assert.equal(a.scroller.scrollTop, 95);
  assert.equal(a.panel.scrollTop, 21);
  assert.equal(row.children[5].textContent, 'MYODAU');
  a.decisions.set(10, { status: 'invalidated', manualId: null }); a.ui.refresh();
  assert.equal(row.children[5].textContent, 'À identifier');
  assert.equal(a.creations.length, 1, 'decisions refresh does not rebuild the chronological index');
});

test('close and Escape return focus, while Escape outside the modeless panel does not close it', () => {
  const a = fixture(); a.ui.show(11, a.opener);
  assert.equal(a.document.activeElement, a.node('contact-context-heading'));
  const outside = { isConnected: true };
  a.panel.fire('keydown', { key: 'Escape', target: outside });
  assert.equal(a.panel.hidden, false);
  a.panel.fire('keydown', { key: 'Tab' });
  assert.equal(a.panel.hidden, false, 'there is no focus trap');
  a.panel.fire('keydown', { key: 'Escape' });
  assert.equal(a.panel.hidden, true);
  assert.equal(a.document.activeElement, a.opener);
  a.ui.show(0, a.opener);
  assert.equal(a.node('contact-context-table-body').children.length, 11);
  a.node('contact-context-close').fire('click');
  assert.equal(a.panel.hidden, true);
  assert.equal(a.document.activeElement, a.opener);
});

test('new import resets cached source and old WAV buttons cannot open a row from the next file', async () => {
  const a = fixture(); a.ui.show(11, a.opener);
  const oldButton = a.row(10).querySelectorAll('button')[0];
  a.ui.reset();
  assert.equal(a.panel.hidden, true);
  assert.equal(a.node('contact-context-table-body').children.length, 0);
  a.setSource({ fileName: 'suivant.csv', undated: true });
  a.ui.show(4, a.opener);
  assert.equal(a.creations.length, 2);
  assert.equal(a.node('contact-context-table-body').children.length, 1);
  assert.match(a.node('contact-context-summary').textContent, /date.*heure.*seul/);
  assert.match(a.node('contact-context-summary').textContent, /2.*date.*heure/);
  assert.match(a.node('contact-context-summary').textContent, /TIME/);
  assert.match(a.row(4).textContent, /Non daté/);
  await oldButton.fire('click');
  assert.equal(a.plays.length, 0);
  assert.equal(a.panel.hidden, false, 'a stale detached button does not disturb the next panel');
});

test('an old asynchronous WAV result cannot overwrite a reopened context and current errors remain visible', async () => {
  let complete;
  const a = fixture({ open: () => new Promise(resolve => { complete = resolve; }) });
  a.ui.show(11, a.opener);
  const pending = a.row(10).querySelectorAll('button')[0].fire('click');
  a.ui.show(20, a.opener);
  complete(true); await pending;
  assert.equal(a.node('contact-context-status').textContent, '');
  assert.equal(a.row(20).getAttribute('aria-current'), 'true');
  const failed = fixture({ open: async () => { throw new Error('WAV introuvable.'); } });
  failed.ui.show(0, failed.opener);
  await failed.row(1).querySelectorAll('button')[0].fire('click');
  assert.match(failed.node('contact-context-status').textContent, /WAV introuvable/);
});
