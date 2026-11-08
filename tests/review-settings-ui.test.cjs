const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../review-settings.js');
const UI = require('../review-settings-ui.js');

function editor() {
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.value = ''; this.attributes = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(name, listener) { this.listeners.set(name, listener); }
    fire(name) { if (!this.disabled) this.listeners.get(name)?.({ preventDefault() {} }); }
    querySelectorAll(tag) { return this.children.flatMap(node => [...(node.tagName === tag ? [node] : []), ...node.querySelectorAll(tag)]); }
    focus() { this.focused = true; }
  }
  const host = new Node('section');
  const doc = { createElement: tag => new Node(tag), getElementById: id => [host, ...host.querySelectorAll('input'), ...host.querySelectorAll('select'), ...host.querySelectorAll('button')].find(node => node.id === id) };
  const ui = UI.init({ document: doc, host });
  const list = className => host.querySelectorAll('ul').concat(host.querySelectorAll('ol')).find(node => node.className === className);
  const button = (label, root = host) => root.querySelectorAll('button').find(node => node.textContent === label || node.attributes['aria-label'] === label);
  return { ui, host, doc, list, button };
}

test('review editor displays defaults and converts the contact percentage to an exact fraction', () => {
  const e = editor();
  assert.deepEqual(e.ui.get(), Settings.normalize());
  e.doc.getElementById('settings-ratio-threshold').value = '0.85';
  e.doc.getElementById('settings-majority-threshold').value = '70';
  assert.equal(e.ui.get().ratioThreshold, .85);
  assert.equal(e.ui.get().majorityThreshold, .7);
  for (const [ratio, percent] of [['0', '0'], ['1', '100'], ['0.6', '33.3']]) {
    e.doc.getElementById('settings-ratio-threshold').value = ratio;
    e.doc.getElementById('settings-majority-threshold').value = percent;
    assert.equal(e.ui.get().majorityThreshold, Number(percent) / 100);
  }
});

test('invalid and empty thresholds identify the relevant input and preserve the draft', () => {
  for (const [id, value] of [['settings-ratio-threshold', '1.01'], ['settings-ratio-threshold', ''],
    ['settings-majority-threshold', '-1'], ['settings-majority-threshold', '101']]) {
    const e = editor();
    const input = e.doc.getElementById(id);
    input.value = value;
    assert.throws(() => e.ui.get(), /doit être un nombre entre/);
    e.ui.focusInvalid();
    assert.equal(input.focused, true);
    assert.equal(input.value, value);
  }
});

test('exclusion controls add and remove species while keeping NoID pinned', () => {
  const e = editor();
  const species = e.doc.getElementById('settings-excluded-species');
  species.value = 'PIPPIP';
  e.button('Ajouter').fire('click');
  assert.ok(e.ui.get().excludedSpecies.includes('PIPPIP'));
  assert.equal(species.children.some(option => option.value === 'PIPPIP'), false);
  e.button('Retirer Pipistrelle commune de la liste d’exclusion').fire('click');
  assert.equal(e.ui.get().excludedSpecies.includes('PIPPIP'), false);
  while (e.ui.get().excludedSpecies.some(code => code !== 'NoID')) {
    e.list('settings-excluded-list').querySelectorAll('button').find(button => !button.disabled).fire('click');
  }
  assert.deepEqual(e.ui.get().excludedSpecies, ['NoID']);
  const pinned = e.list('settings-excluded-list').children[0];
  assert.match(pinned.children[0].textContent, /NoID.*toujours vérifié par échantillon/);
  assert.equal(pinned.querySelectorAll('button')[0].disabled, true);
});

test('ranking controls add, remove, reorder and reverse criteria while keeping unsaved thresholds', () => {
  const e = editor();
  e.doc.getElementById('settings-ratio-threshold').value = '.8';
  const selection = e.doc.getElementById('settings-ranking-criterion');
  selection.value = 'matching';
  e.host.querySelectorAll('button').filter(button => button.textContent === 'Ajouter')[1].fire('click');
  assert.equal(e.ui.get().ranking.at(-1).key, 'matching');
  e.button('Monter MATCHING').fire('click');
  assert.equal(e.ui.get().ranking.at(-2).key, 'matching');
  const matchingRow = e.list('settings-ranking-list').children.find(row => row.children[0].textContent === 'MATCHING');
  const direction = matchingRow.querySelectorAll('select')[0];
  direction.value = 'asc';
  direction.fire('change');
  assert.deepEqual(e.ui.get().ranking.at(-2), { key: 'matching', direction: 'asc' });
  e.button('Retirer le critère MATCH RATIO').fire('click');
  assert.equal(e.ui.get().ranking[0].key, 'qual');
  assert.equal(e.ui.get().ratioThreshold, .8);
  while (e.ui.get().ranking.length > 1) e.button('Retirer', e.list('settings-ranking-list')).fire('click');
  assert.equal(e.button('Retirer', e.list('settings-ranking-list')).disabled, true);
});

test('reset restores every rule in the draft and reopening replaces all cancelled edits', () => {
  const e = editor();
  const custom = Settings.normalize({ ratioThreshold: .95, majorityThreshold: .8, excludedSpecies: [], ranking: [{ key: 'qual', direction: 'asc' }] });
  e.ui.set(custom);
  assert.deepEqual(e.ui.get(), custom);
  e.button('Rétablir les critères par défaut').fire('click');
  assert.deepEqual(e.ui.get(), Settings.normalize());
  e.doc.getElementById('settings-ratio-threshold').value = '.1';
  e.ui.set(custom);
  assert.deepEqual(e.ui.get(), custom);
  custom.ranking[0].direction = 'desc';
  assert.equal(e.ui.get().ranking[0].direction, 'asc');
});
