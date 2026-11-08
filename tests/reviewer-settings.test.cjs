const test = require('node:test');
const assert = require('node:assert/strict');
const Wav = require('../wav-opening.js');
const Settings = require('../review-settings.js');

const key = 'plecotus.preferences.v1';
const executable = 'C:\Logiciels\kaleidoscope.exe';

function ui(saved = {}, options = {}) {
  const nodes = new Map();
  class Node {
    constructor() { this.value = ''; this.checked = false; this.textContent = ''; this.children = []; this.listeners = new Map(); }
    set id(value) { this.nodeId = value; nodes.set(value, this); }
    get id() { return this.nodeId; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    fire(name) { for (const listener of this.listeners.get(name) || []) listener({ preventDefault() {} }); }
    showModal() { this.open = true; }
    close() { this.open = false; this.fire('close'); }
    focus() { this.focused = true; }
  }
  const node = id => {
    if (!nodes.has(id)) { const created = new Node(); created.id = id; }
    return nodes.get(id);
  };
  const values = options.values || new Map([[key, JSON.stringify(saved)]]);
  let writes = 0;
  const editor = { draft: Settings.normalize(), set(value) { this.draft = Settings.normalize(value); },
    get() { return Settings.normalize(this.draft); }, focusInvalid() {} };
  const changes = [], statuses = [];
  const app = Wav.init({
    document: { getElementById: node, createElement: () => new Node(), body: new Node(), querySelector: () => null },
    location: { origin: 'file://' }, fetch: async () => { throw Error('settings should not open a WAV'); },
    storage: options.blocked ? { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } }
      : { getItem: name => values.get(name) ?? null, setItem: (name, value) => { writes++; values.set(name, value); } },
    reviewSettingsUI: editor,
    onPreferencesChange: (next, previous) => changes.push({ next, previous }),
    onStatus: (message, error) => statuses.push({ message, error })
  });
  return { app, node, editor, values, changes, statuses, get writes() { return writes; },
    saved: () => JSON.parse(values.get(key)),
    open: () => app.openSettings(), save: () => node('wav-settings-form').fire('submit'),
    cancel: () => node('wav-settings-cancel').fire('click'),
    type(value, event = 'input') { node('settings-reviewer').value = value; node('settings-reviewer').fire(event); },
    preview: () => node('settings-report-preview').value };
}

test('reviewer defaults to empty and existing reviewer preferences hydrate as one normalized line', () => {
  for (const saved of [{}, { reviewer: null }, { reviewer: 12 }, { reviewer: true }, { reviewer: {} }]) {
    const a = ui(saved);
    assert.equal(a.app.getPreferences().reviewer, '');
    assert.equal(a.app.getConfiguration().reviewer, '');
    a.open();
    assert.equal(a.node('settings-reviewer').value, '');
    assert.equal(a.writes, 0);
    assert.equal(a.changes.length, 0);
  }
  const a = ui({ reviewer: ' \tÉlodie\n  Dupont \r ' });
  assert.equal(a.app.getPreferences().reviewer, 'Élodie Dupont');
  a.open();
  assert.equal(a.node('settings-reviewer').value, 'Élodie Dupont');
  assert.equal(a.saved().reviewer, ' \tÉlodie\n  Dupont \r ', 'hydration must not silently write preferences');
});

test('saving a reviewer updates the legacy preference key and notification atomically then hydrates after reload', () => {
  const a = ui({ reviewer: 'AB', kaleidoscopeExecutable: executable, unrelated: 'conservé' });
  a.open();
  a.type('  Léa\t Vermeulen \n ');
  assert.equal(a.app.getPreferences().reviewer, 'AB');
  assert.equal(a.changes.length, 0);
  a.save();
  assert.equal(a.node('wav-settings').open, false);
  assert.equal(a.app.getPreferences().reviewer, 'Léa Vermeulen');
  assert.equal(a.app.getConfiguration().reviewer, 'Léa Vermeulen');
  assert.equal(a.saved().reviewer, 'Léa Vermeulen');
  assert.equal(a.saved().unrelated, 'conservé');
  assert.equal(a.writes, 1);
  assert.equal(a.changes.length, 1);
  assert.equal(a.changes[0].previous.reviewer, 'AB');
  assert.equal(a.changes[0].next.reviewer, 'Léa Vermeulen');
  const reloaded = ui({}, { values: a.values });
  reloaded.open();
  assert.equal(reloaded.node('settings-reviewer').value, 'Léa Vermeulen');
});

test('cancel discards reviewer edits and saving an empty name explicitly clears an existing reviewer', () => {
  const a = ui({ reviewer: 'Alice' });
  a.open();
  a.type('Bob');
  a.cancel();
  assert.equal(a.app.getPreferences().reviewer, 'Alice');
  assert.equal(a.saved().reviewer, 'Alice');
  assert.equal(a.changes.length, 0);
  a.open();
  assert.equal(a.node('settings-reviewer').value, 'Alice');
  a.type(' \t\r\n ');
  a.save();
  assert.equal(a.app.getPreferences().reviewer, '');
  assert.equal(a.saved().reviewer, '');
  a.open();
  assert.equal(a.node('settings-reviewer').value, '');
});

test('invalid executable or review rules cannot partially save the reviewer name', () => {
  for (const invalidField of ['executable', 'rules']) {
    const a = ui({ reviewer: 'Alice', kaleidoscopeExecutable: executable });
    a.open();
    a.type('Bob');
    if (invalidField === 'executable') a.node('wav-settings-executable').value = 'C:\Windows\cmd.exe';
    else a.editor.draft.ratioThreshold = 1.1;
    a.save();
    assert.equal(a.node('wav-settings').open, true);
    assert.equal(a.app.getPreferences().reviewer, 'Alice');
    assert.equal(a.saved().reviewer, 'Alice');
    assert.equal(a.writes, 0);
    assert.equal(a.changes.length, 0);
    assert.equal(a.node('settings-reviewer').value, 'Bob');
  }
});

test('the reviewer remains usable for the session when browser storage is unavailable', () => {
  const a = ui({}, { blocked: true });
  a.open();
  a.type('  Céline  ');
  a.save();
  assert.equal(a.app.getPreferences().reviewer, 'Céline');
  assert.equal(a.changes[0].next.reviewer, 'Céline');
  assert.match(a.statuses.at(-1).message, /cette session/);
  a.open();
  assert.equal(a.node('settings-reviewer').value, 'Céline');
});

test('reviewer input and change events update the report draft while active settings retain the saved name', () => {
  const a = ui({ reviewer: 'Alice' });
  a.open();
  assert.match(a.preview(), /Alice/);
  assert.doesNotMatch(a.preview(), /modifications non encore enregistrées/);
  a.type('  Bob  ');
  assert.match(a.preview(), /Bob/);
  assert.match(a.preview(), /modifications non encore enregistrées/);
  assert.equal(a.app.getConfiguration().reviewer, 'Alice');
  a.type('Céline', 'change');
  assert.match(a.preview(), /Céline/);
  assert.equal(a.app.getPreferences().reviewer, 'Alice');
  assert.equal(a.changes.length, 0);
  a.cancel(); a.open();
  assert.match(a.preview(), /Alice/);
  assert.doesNotMatch(a.preview(), /Céline/);
  assert.doesNotMatch(a.preview(), /modifications non encore enregistrées/);
});
