const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const ContextUI = require('../contact-context-ui.js');
const Decisions = require('../contact-decisions.js');
const Wav = require('../wav-opening.js');
const Settings = require('../review-settings.js');

function imported(prefix = 'Original') {
  return { fileName: prefix + '.csv', sourceRows: Array.from({ length: 25 }, (_, index) => index + 40),
    headers: ['INDIR', 'FOLDER', 'IN FILE', 'DATE', 'TIME', 'AUTO-ID', 'MATCH RATIO', 'PULSES', 'MANUAL ID', 'SEMIMANUAL ID'],
    records: Array.from({ length: 25 }, (_, index) => {
      const clock = new Date(Date.UTC(2025, 6, 23, 23, 55) + (24 - index) * 60000);
      const date = String(clock.getUTCDate()).padStart(2, '0') + '-07-25';
      return ['C:\\Recordings', prefix + '\\Batch' + index, 'same.wav', date, clock.toISOString().slice(11, 19),
        index === 22 ? 'Noise' : 'PIPPIP', '0,80', '0', index === 12 ? 'MYODAU' : '', 'CALCULATED'];
    }) };
}

async function fixture({ configured = true } = {}) {
  let activeElement = null, body;
  class Node {
    constructor(tag = 'div') { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = new Map(); this.hidden = false; this._text = ''; this.value = ''; this.scrollTop = 0; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this._text = ''; this.append(...children); }
    set textContent(value) { for (const child of this.children) child.parent = null; this.children = []; this._text = String(value); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    fire(name) { if (name === 'click' && this.disabled) return; return this.listeners.get(name)?.({ target: this, preventDefault() {} }); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    querySelectorAll(selector) { return this.children.flatMap(child => [...((selector[0] === '.'
      ? String(child.className || '').split(' ').includes(selector.slice(1)) : child.tagName === selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get isConnected() { let current = this; while (current.parent) current = current.parent; return current === body; }
    getBoundingClientRect() { return { top: 100, height: 180 }; }
    focus() { activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  body = new Node('body');
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) { const item = new Node(); item.id = id; nodes.set(id, item); body.append(item); }
    return nodes.get(id);
  };
  const panel = node('contact-context'), scroller = new Node(); scroller.className = 'contact-context-scroll';
  scroller.append(node('contact-context-table-body'));
  panel.append(node('contact-context-heading'), node('contact-context-summary'), scroller,
    node('contact-context-close'), node('contact-context-status'));
  const document = { body, getElementById: node, createElement: tag => new Node(tag),
    querySelector: () => ({ content: 'test-token' }), get activeElement() { return activeElement; } };
  const requests = [];
  const wav = Wav.init({ document, location: { origin: 'http://127.0.0.1:4174' },
    storage: { getItem: () => JSON.stringify({ wavViewer: 'chirosurf',
      chirosurfExecutable: configured ? 'D:\\Apps\\ChiroSurf.exe' : '' }), setItem() {} },
    reviewSettingsUI: { set() {}, get: () => Settings.normalize(), focusInvalid() {} },
    settingsReportUI: { refresh() {} },
    fetch: async (url, request) => { requests.push({ url, body: JSON.parse(request.body) });
      return { ok: true, json: async () => ({ ok: true }) }; } });
  let source = imported(), decisions = await Decisions.create(source, { storage: null, crypto: webcrypto });
  const ui = ContextUI.init({ document, getImported: () => source, getDecision: index => decisions.get(index),
    onOpenContact: (index, capturedSource) => capturedSource === source ? wav.openContact(capturedSource, { recordIndex: index }) : false });
  const row = index => node('contact-context-table-body').children.find(item => item.dataset.contextIndex === String(index));
  return { ui, node, panel, scroller, document, requests, row,
    source: () => source, decisions: () => decisions,
    open(index = 12) { const opener = new Node('button'); body.append(opener); return ui.show(index, opener); },
    async replace() { ui.reset(); source = imported('Replacement'); decisions = await Decisions.create(source, { storage: null, crypto: webcrypto }); } };
}

test('real context chronology opens duplicate WAV names by exact source indices across European-date midnight and Noise', async () => {
  const a = await fixture();
  const before = structuredClone(a.source()), decisions = a.decisions().snapshot();
  assert.equal(a.open(), true);
  assert.deepEqual(a.node('contact-context-table-body').children.map(row => Number(row.dataset.contextIndex)),
    [22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  assert.match(a.row(22).children[0].textContent, /23\/07\/2025 23:57:00/);
  assert.match(a.row(12).children[0].textContent, /24\/07\/2025 00:07:00/);
  assert.equal(a.row(22).children[2].textContent, 'Noise');
  assert.equal(a.row(22).children[3].textContent, '0,80');
  assert.equal(a.row(22).children[4].textContent, '0');
  await a.row(22).querySelector('button').fire('click');
  await a.row(2).querySelector('button').fire('click');
  assert.deepEqual(a.requests.map(request => request.body.file),
    ['C:\\Recordings\\Original\\Batch22\\same.wav', 'C:\\Recordings\\Original\\Batch2\\same.wav']);
  assert.ok(a.requests.every(request => request.body.viewer === 'chirosurf' && request.body.executable === 'D:\\Apps\\ChiroSurf.exe'));
  assert.equal(a.row(12).getAttribute('aria-current'), 'true');
  assert.equal(a.node('contact-context-table-body').children.filter(row => row.getAttribute('aria-current') === 'true').length, 1);
  assert.deepEqual(a.decisions().snapshot(), decisions);
  assert.deepEqual(a.source(), before);
});

test('real local decisions replace source manual IDs in place without showing calculated assignments', async () => {
  const a = await fixture(); a.open();
  const row = a.row(12), wav = row.querySelector('button');
  wav.focus(); a.scroller.scrollTop = 70;
  assert.equal(row.children[5].textContent, 'MYODAU');
  for (const [status, manual, expected] of [
    ['invalidated', null, 'À identifier'], ['invalidated', 'NoID', 'NoID'], ['unresolved', null, 'À revoir'], ['validated', null, 'PIPPIP']
  ]) {
    if (manual === null) a.decisions().set(12, status);
    else a.decisions().setManualId(12, manual);
    a.ui.refresh();
    assert.equal(a.row(12), row);
    assert.equal(row.children[5].textContent, expected);
    assert.equal(a.document.activeElement, wav);
    assert.equal(a.scroller.scrollTop, 70);
    assert.equal(row.getAttribute('aria-current'), 'true');
  }
  assert.equal(a.row(11).children[5].textContent, '—');
  assert.equal(a.node('contact-context-table-body').textContent.includes('CALCULATED'), false);
  assert.equal(a.source().records[12][8], 'MYODAU', 'local decisions leave the original manual source cell intact');
});

test('a modeless real context leaves the configured-viewer settings dialog usable without losing its reference', async () => {
  const a = await fixture({ configured: false }); a.open();
  await a.row(22).querySelector('button').fire('click');
  assert.equal(a.node('wav-settings').open, true);
  assert.equal(a.document.activeElement, a.node('wav-settings-executable'));
  assert.equal(a.panel.hidden, false);
  assert.equal(a.panel.getAttribute('aria-modal'), 'false');
  assert.equal(a.row(12).getAttribute('aria-current'), 'true');
  assert.deepEqual(a.requests, []);
});

test('old context WAV buttons cannot reuse their indices against a replacement imported source', async () => {
  const a = await fixture(); a.open();
  const obsolete = a.row(22).querySelector('button');
  await a.replace();
  assert.equal(a.panel.hidden, true);
  a.open();
  await obsolete.fire('click');
  assert.deepEqual(a.requests, []);
  await a.row(22).querySelector('button').fire('click');
  assert.equal(a.requests[0].body.file, 'C:\\Recordings\\Replacement\\Batch22\\same.wav');
  assert.equal(a.row(12).getAttribute('aria-current'), 'true');
});
