const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../review-settings.js');
const Wav = require('../wav-opening.js');

// Exercise the real settings form, settings editor and report together. Only
// browser DOM/storage are represented here; no report refresh is called by tests.
function settingsApp() {
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = {};
      this.value = ''; this.checked = false; this.open = false; this.disabled = false; this.textContent = '';
    }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(listener);
    }
    fire(name) {
      if (name === 'click' && this.disabled) return;
      const event = { target: this, preventDefault() {} };
      let result;
      for (let current = this; current; current = current.parent) {
        event.currentTarget = current;
        for (const listener of current.listeners.get(name) || []) result = listener(event);
      }
      return result;
    }
    querySelectorAll(tag) { return this.children.flatMap(node => [...(node.tagName === tag ? [node] : []), ...node.querySelectorAll(tag)]); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  const body = new Node('body');
  const dialog = new Node('dialog'); dialog.id = 'wav-settings'; body.append(dialog);
  const form = new Node('form'); form.id = 'wav-settings-form'; dialog.append(form);
  const all = () => { const walk = node => [node, ...node.children.flatMap(walk)]; return walk(body); };
  const node = id => {
    let found = all().find(item => item.id === id);
    if (!found) { found = new Node(); found.id = id; form.append(found); }
    return found;
  };
  const document = { body, createElement: tag => new Node(tag), getElementById: node,
    querySelector: () => ({ content: 'local-test-token' }) };
  const key = 'plecotus.preferences.v1';
  const saved = { reviewer: 'AB', debugMode: false, includeCommonPipistrelle: true,
    reviewSettings: Settings.normalize({ ratioThreshold: .7, majorityThreshold: .6, excludedSpecies: ['BARBAR'] }),
    wavViewer: 'kaleidoscope', kaleidoscopeExecutable: 'C:\\Old\\kaleidoscope.exe',
    chirosurfExecutable: 'D:\\Old\\ChiroSurf.exe', wavSearchFolders: ['E:\\Original'] };
  const storage = new Map([[key, JSON.stringify(saved)]]);
  const preferenceChanges = [];
  const app = Wav.init({ document, location: { origin: 'http://127.0.0.1:4174' },
    storage: { getItem: name => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, value) },
    fetch: async () => { throw new Error('settings edits must not open audio'); },
    onPreferencesChange: (...args) => preferenceChanges.push(args) });
  const initialConfiguration = app.getConfiguration();
  const initialPreferences = app.getPreferences();
  const initialStorage = storage.get(key);
  const reportHost = node('settings-report');
  const button = (label, root = body) => root.querySelectorAll('button')
    .find(item => item.textContent === label || item.attributes['aria-label'] === label);
  const change = (id, value, event = 'input') => { const field = node(id); field.value = value; field.fire(event); };
  const rankingSelect = label => node('review-settings-fields').querySelectorAll('select')
    .find(item => item.attributes['aria-label'] === 'Sens du classement pour ' + label);
  const unchanged = () => {
    assert.deepEqual(app.getConfiguration(), initialConfiguration, 'draft changes must not change applied configuration');
    assert.deepEqual(app.getPreferences(), initialPreferences, 'draft changes must not change active preferences');
    assert.equal(storage.get(key), initialStorage, 'draft changes must not write storage');
    assert.equal(preferenceChanges.length, 0);
  };
  node('open-settings').fire('click');
  assert.equal(dialog.open, true);
  assert.match(node('settings-report-preview').value, /Au moins 60 %.*MATCH RATIO supérieur ou égal à 0,7/);
  return { app, node, dialog, button, change, rankingSelect, unchanged, reportHost, storage, key,
    preview: () => node('settings-report-preview').value,
    reportButtons: () => reportHost.querySelectorAll('button'),
    reportStatus: () => reportHost.querySelectorAll('p').find(item => item.attributes.role === 'status').textContent,
    reopen() { node('open-settings').fire('click'); },
    cancel() { node('wav-settings-cancel').fire('click'); },
    save() { form.fire('submit'); } };
}

test('typing thresholds updates the visible report without blur or saving, and only submit applies them', () => {
  const a = settingsApp();
  a.change('settings-ratio-threshold', '0.83');
  assert.match(a.preview(), /Au moins 60 %.*MATCH RATIO supérieur ou égal à 0,83/);
  a.change('settings-majority-threshold', '72.5');
  assert.match(a.preview(), /Au moins 72,5 %.*MATCH RATIO supérieur ou égal à 0,83/);
  assert.match(a.preview(), /modifications non encore enregistrées/);
  a.unchanged();
  a.save();
  assert.equal(a.dialog.open, false);
  assert.equal(a.app.getPreferences().reviewSettings.ratioThreshold, .83);
  assert.equal(a.app.getPreferences().reviewSettings.majorityThreshold, .725);
  assert.equal(JSON.parse(a.storage.get(a.key)).reviewSettings.ratioThreshold, .83);
  a.reopen();
  assert.match(a.preview(), /Paramètres enregistrés actuellement appliqués/);
  assert.doesNotMatch(a.preview(), /modifications non encore enregistrées/);
});

test('species and ranking changes including defaults reset immediately change the report', () => {
  const a = settingsApp();
  a.change('settings-excluded-species', 'PIPPIP', 'change');
  a.button('Ajouter', a.node('review-settings-fields')).fire('click');
  assert.match(a.preview(), /PIPPIP — Pipistrelle commune/);
  a.button('Retirer Barbastelle d’Europe de la liste d’exclusion').fire('click');
  assert.doesNotMatch(a.preview(), /BARBAR — Barbastelle d’Europe/);
  const direction = a.rankingSelect('Qual'); direction.value = 'asc'; direction.fire('change');
  assert.match(a.preview(), /2\. Qual : ordre croissant\./);
  a.button('Monter Qual').fire('click');
  assert.match(a.preview(), /1\. Qual : ordre croissant\.\n2\. MATCH RATIO : ordre décroissant\./);
  a.change('settings-ranking-criterion', 'matching', 'change');
  a.node('review-settings-fields').querySelectorAll('button').filter(item => item.textContent === 'Ajouter')[1].fire('click');
  assert.match(a.preview(), /6\. MATCHING : ordre décroissant\./);
  a.button('Retirer le critère PULSES').fire('click');
  assert.doesNotMatch(a.preview(), /PULSES : ordre/);
  assert.match(a.preview(), /5\. MATCHING : ordre décroissant\./);
  a.unchanged();
  a.button('Rétablir les critères par défaut').fire('click');
  assert.match(a.preview(), /Au moins 50 %.*MATCH RATIO supérieur ou égal à 0,6/);
  assert.match(a.preview(), /1\. MATCH RATIO : ordre décroissant\.\n2\. Qual : ordre décroissant\./);
  assert.match(a.preview(), /BARBAR — Barbastelle d’Europe/);
  assert.doesNotMatch(a.preview(), /PIPPIP — Pipistrelle commune/);
  assert.doesNotMatch(a.preview(), /MATCHING : ordre/);
  a.unchanged();
});

test('interface and both viewer path drafts appear live, while cancelling restores the saved report', () => {
  const a = settingsApp();
  a.node('settings-debug-mode').checked = true; a.node('settings-debug-mode').fire('change');
  assert.match(a.preview(), /Mode débogage : activé/);
  a.change('settings-common-pipistrelle', 'no', 'change');
  assert.match(a.preview(), /Pipistrelle commune par défaut dans les graphiques : non/);
  a.change('wav-settings-executable', 'C:\\New\\kaleidoscope.exe');
  assert.ok(a.preview().includes('C:\\New\\kaleidoscope.exe'));
  a.change('wav-settings-viewer', 'chirosurf', 'change');
  assert.match(a.preview(), /Logiciel sélectionné : ChiroSurf/);
  a.change('wav-settings-executable', 'D:\\New\\ChiroSurf_4.6.exe');
  assert.ok(a.preview().includes('D:\\New\\ChiroSurf_4.6.exe'));
  a.change('wav-settings-search-folders', 'F:\\Moved\nG:\\Nights');
  assert.ok(a.preview().includes('F:\\Moved'));
  assert.ok(a.preview().includes('G:\\Nights'));
  a.change('wav-settings-viewer', 'kaleidoscope', 'change');
  assert.equal(a.node('wav-settings-executable').value, 'C:\\New\\kaleidoscope.exe');
  assert.ok(a.preview().includes('C:\\New\\kaleidoscope.exe'));
  assert.ok(a.preview().includes('D:\\New\\ChiroSurf_4.6.exe'));
  assert.match(a.preview(), /Logiciel sélectionné : Kaleidoscope/);
  assert.match(a.preview(), /modifications non encore enregistrées/);
  a.unchanged();
  a.cancel(); a.reopen();
  assert.match(a.preview(), /Mode débogage : désactivé/);
  assert.match(a.preview(), /Pipistrelle commune par défaut dans les graphiques : oui/);
  assert.ok(a.preview().includes('C:\\Old\\kaleidoscope.exe'));
  assert.ok(a.preview().includes('D:\\Old\\ChiroSurf.exe'));
  assert.ok(a.preview().includes('E:\\Original'));
  assert.equal(a.preview().includes('F:\\Moved'), false);
  assert.match(a.preview(), /Paramètres enregistrés actuellement appliqués/);
  a.unchanged();
});

test('an invalid draft clears stale report contents and disables export until corrected without saving', () => {
  const a = settingsApp();
  for (const value of ['', '1.2']) {
    a.change('settings-ratio-threshold', value);
    assert.equal(a.preview(), '', 'an invalid form must not display an earlier valid report');
    assert.match(a.reportStatus(), /incomplets ou invalides/);
    assert.equal(a.reportButtons().length, 3);
    for (const button of a.reportButtons()) assert.equal(button.disabled, true);
  }
  a.unchanged();
  a.change('settings-ratio-threshold', '0.44');
  assert.match(a.preview(), /MATCH RATIO ≥ 0,44/);
  assert.match(a.preview(), /modifications non encore enregistrées/);
  assert.equal(a.reportStatus(), '');
  for (const button of a.reportButtons()) assert.equal(button.disabled, false);
  a.change('settings-majority-threshold', '101');
  assert.equal(a.preview(), '');
  a.change('settings-majority-threshold', '49');
  assert.match(a.preview(), /Au moins 49 %/);
  a.unchanged();
});

test('reviewer name typing updates the report immediately and only saving applies the trimmed name', () => {
  const a = settingsApp();
  assert.equal(a.node('settings-reviewer').value, 'AB');
  assert.match(a.preview(), /Vérificateur : AB/);
  assert.doesNotMatch(a.preview(), /modifications non encore enregistrées/);
  a.change('settings-reviewer', '  Marie Dupont  ');
  assert.match(a.preview(), /Vérificateur : Marie Dupont/);
  assert.match(a.preview(), /modifications non encore enregistrées/);
  a.unchanged();
  assert.equal(a.app.getPreferences().reviewer, 'AB');
  a.save();
  assert.equal(a.dialog.open, false);
  assert.equal(a.app.getConfiguration().reviewer, 'Marie Dupont');
  assert.equal(JSON.parse(a.storage.get(a.key)).reviewer, 'Marie Dupont');
  a.reopen();
  assert.equal(a.node('settings-reviewer').value, 'Marie Dupont');
  assert.match(a.preview(), /Vérificateur : Marie Dupont/);
  assert.match(a.preview(), /Paramètres enregistrés actuellement appliqués/);
  assert.doesNotMatch(a.preview(), /modifications non encore enregistrées/);
});

test('cancelling a reviewer edit restores the applied name and empty drafts show the report fallback', () => {
  const a = settingsApp();
  a.change('settings-reviewer', '   ');
  assert.match(a.preview(), /Vérificateur : non spécifié/);
  assert.match(a.preview(), /modifications non encore enregistrées/);
  a.unchanged();
  a.cancel();
  a.reopen();
  assert.equal(a.node('settings-reviewer').value, 'AB');
  assert.match(a.preview(), /Vérificateur : AB/);
  assert.doesNotMatch(a.preview(), /modifications non encore enregistrées/);
  a.unchanged();
});
