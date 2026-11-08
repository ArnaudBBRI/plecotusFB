const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function fixture() {
  const modulePath = path.join(__dirname, '..', 'species-tooltip.js');
  assert.ok(fs.existsSync(modulePath), 'the species photo tooltip module must exist');
  const Tooltip = require(modulePath);
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.style = {}; this.listeners = new Map(); this.hidden = false; this._text = ''; }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { for (const child of this.children) child.parent = null; this.children = []; this.append(...children); }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'id') this.id = value; }
    getAttribute(key) { return this.attributes[key] ?? (key === 'id' ? this.id ?? null : null); }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    removeEventListener(name) { this.listeners.delete(name); }
    fire(name) { this.listeners.get(name)?.({ target: this }); }
    contains(other) { return this === other || this.children.some(child => child.contains(other)); }
    closest(selector) { return this.attributes['data-species-tooltip'] === 'true' ? this : this.parent?.closest(selector) || null; }
    get isConnected() { for (let node = this; node; node = node.parent) if (node === body) return true; return false; }
    getBoundingClientRect() { return this.tagName === 'button' ? { left: 100, top: 80, right: 160, bottom: 110, width: 60, height: 30 } : { width: 280, height: 310 }; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = null; }
  }
  const body = new Node('body');
  const listeners = new Map();
  const captures = new Map();
  const windowListeners = new Map();
  const doc = { body, defaultView: { innerWidth: 800, innerHeight: 600,
    addEventListener: (name, listener) => windowListeners.set(name, listener),
    removeEventListener: name => windowListeners.delete(name) },
    createElement: tag => new Node(tag), getElementById: id => find(body, node => node.id === id),
    addEventListener: (name, listener, capture) => { listeners.set(name, listener); captures.set(name, capture); },
    removeEventListener: name => listeners.delete(name) };
  const resolved = [];
  const pendingTimers = new Map();
  let nextTimer = 0;
  const photos = { resolve(label) {
    resolved.push(label);
    return label === 'Pipistrellus pipistrellus' ? { src: 'data:image/jpeg;base64,PHOTO',
      author: 'Photographe exemple', license: 'CC BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg' } : null;
  } };
  const ui = Tooltip.init({ document: doc, photos,
    setTimeout: callback => { const id = ++nextTimer; pendingTimers.set(id, callback); return id; },
    clearTimeout: id => pendingTimers.delete(id) });
  function find(node, condition) { return condition(node) ? node : node.children.map(child => find(child, condition)).find(Boolean); }
  const tip = () => find(body, node => node.getAttribute('role') === 'tooltip');
  const target = (overrides = {}) => {
    const node = new Node('button');
    for (const [name, value] of Object.entries({ 'data-species-tooltip': 'true',
      'data-species-name': 'Pipistrellus pipistrellus', 'data-french-name': 'Pipistrelle commune',
      'data-contacts': '123', 'data-percentage': '12.5', ...overrides })) node.setAttribute(name, value);
    body.append(node);
    return node;
  };
  const fire = (name, target, extra = {}) => listeners.get(name)?.({ target, clientX: 150, clientY: 100, ...extra });
  return { ui, body, doc, target, fire, tip, find, resolved, listeners, captures, windowListeners,
    fireWindow(name) { windowListeners.get(name)?.({ target: doc.defaultView }); },
    flushTimers() { for (const [id, callback] of pendingTimers) { pendingTimers.delete(id); callback(); } } };
}

test('hover shows offline photo, safe species labels, French figures and usable credits without intercepting clicks', () => {
  const a = fixture();
  const target = a.target({ 'data-french-name': '<img src=x onerror=alert(1)>', 'data-series-label': 'Après · vérification' });
  target.setAttribute('aria-describedby', 'existing-help');
  const child = new (target.constructor)('span'); target.append(child);
  a.fire('pointerover', child);
  const tooltip = a.tip();
  assert.ok(tooltip);
  assert.equal(tooltip.hidden, false);
  assert.match(tooltip.textContent, /Pipistrellus pipistrellus/);
  assert.match(tooltip.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(tooltip.textContent, /Après · vérification/);
  assert.match(tooltip.textContent, /123 contacts/);
  assert.match(tooltip.textContent, /12,5 %/);
  const image = a.find(tooltip, node => node.tagName === 'img');
  assert.equal(image.src, 'data:image/jpeg;base64,PHOTO');
  assert.match(image.alt, /Pipistrellus pipistrellus/);
  assert.match(tooltip.textContent, /Photographe exemple/);
  assert.match(tooltip.textContent, /redimensionnée.*cadrée/, 'photo credits disclose the display adaptation');
  const license = a.find(tooltip, node => node.tagName === 'a' && node.textContent === 'CC BY-SA 4.0');
  assert.equal(license.href, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.ok(a.find(tooltip, node => node.tagName === 'a' && node.href === 'https://commons.wikimedia.org/wiki/File:Example.jpg'));
  assert.match(target.getAttribute('aria-describedby'), /existing-help/);
  assert.ok(target.getAttribute('aria-describedby').includes(tooltip.id));
  assert.equal(a.listeners.has('click'), false, 'legend click and filtering remain owned by the charts');
});

test('NoID or unknown labels clear a prior photo and cannot inherit another species image or credits', () => {
  const a = fixture();
  a.fire('pointerover', a.target());
  for (const label of ['NoID', 'Myotis sp.', '<unknown>']) {
    a.fire('pointerover', a.target({ 'data-species-name': label, 'data-french-name': 'Identification indéterminée' }));
    const tooltip = a.tip();
    assert.match(tooltip.textContent, /Aucune photo d’espèce associée/);
    const image = a.find(tooltip, node => node.tagName === 'img');
    assert.ok(!image || image.hidden || !image.src, 'the previous species photo is not visible');
    assert.doesNotMatch(tooltip.textContent, /Photographe exemple|CC BY-SA/);
    assert.ok(tooltip.textContent.includes(label));
  }
});

test('keyboard focus shows the tooltip, Escape restores description, and a detached chart target hides safely', () => {
  const a = fixture();
  const target = a.target(); target.setAttribute('aria-describedby', 'help-a help-b');
  a.fire('focusin', target);
  assert.equal(a.tip().hidden, false);
  a.fire('keydown', target, { key: 'Escape' });
  assert.equal(a.tip().hidden, true);
  assert.equal(target.getAttribute('aria-describedby'), 'help-a help-b');
  a.fire('focusin', target);
  target.remove();
  a.fire('pointermove', a.body);
  assert.equal(a.tip().hidden, true);
  assert.equal(target.getAttribute('aria-describedby'), 'help-a help-b');
  a.ui.destroy();
  assert.equal(a.listeners.size, 0);
});

test('pointer transitions preserve clickable credit links and position clamps to the current viewport', () => {
  const a = fixture();
  const target = a.target();
  a.fire('pointerover', target, { clientX: 795, clientY: 595 });
  const tooltip = a.tip();
  assert.ok(parseFloat(tooltip.style.left) >= 0);
  assert.ok(parseFloat(tooltip.style.left) + 280 <= 800);
  assert.ok(parseFloat(tooltip.style.top) >= 0);
  assert.ok(parseFloat(tooltip.style.top) + 310 <= 600);
  const credit = a.find(tooltip, node => node.tagName === 'a');
  a.fire('pointerout', target, { relatedTarget: a.body });
  assert.equal(tooltip.hidden, false, 'a short grace permits crossing the gap to the credits');
  a.fire('pointerover', credit);
  a.flushTimers();
  assert.equal(tooltip.hidden, false, 'entering the tooltip cancels pending closure');
  a.fire('pointerout', target, { relatedTarget: credit });
  assert.equal(tooltip.hidden, false);
  const left = tooltip.style.left;
  a.fire('pointermove', credit, { clientX: 5, clientY: 5 });
  assert.equal(tooltip.style.left, left, 'credit links do not move while the pointer approaches them');
  a.fire('pointerout', credit, { relatedTarget: a.body });
  a.flushTimers();
  assert.equal(tooltip.hidden, true);
  a.doc.defaultView.innerWidth = 320;
  a.doc.defaultView.innerHeight = 480;
  a.fire('focusin', target);
  assert.ok(parseFloat(tooltip.style.left) + 280 <= 320);
  assert.ok(parseFloat(tooltip.style.top) + 310 <= 480);
  a.ui.hide();
  assert.equal(tooltip.hidden, true);
});

test('resize and captured page or container scroll dismiss stale positions while tooltip scrolling stays usable', () => {
  const a = fixture();
  const target = a.target();
  a.fire('pointerover', target, { clientX: 795, clientY: 595 });
  assert.equal(a.tip().hidden, false);
  a.doc.defaultView.innerWidth = 320;
  a.fireWindow('resize');
  assert.equal(a.tip().hidden, true, 'the old fixed left position cannot survive a narrower viewport');
  assert.equal(target.getAttribute('aria-describedby'), null);
  a.fire('focusin', target);
  assert.equal(a.tip().hidden, false);
  assert.equal(a.captures.get('scroll'), true, 'scroll capture also observes scrollable chart and legend containers');
  a.fire('scroll', a.body);
  assert.equal(a.tip().hidden, true);
  a.fire('focusin', target);
  a.fire('scroll', a.tip());
  assert.equal(a.tip().hidden, false, 'a constrained tooltip can scroll to its own credit links');
  a.ui.destroy();
  assert.equal(a.windowListeners.size, 0);
  assert.equal(a.listeners.size, 0);
});
