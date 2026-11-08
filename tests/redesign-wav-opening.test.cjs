const test = require('node:test');
const assert = require('node:assert/strict');
const Wav = require('../wav-opening.js');
const Settings = require('../review-settings.js');
const legacy = ({ reviewSettings, reviewer, ...preferences }) => preferences;

const key = 'plecotus.preferences.v1';
const kaleidoscope = 'C:\\Logiciels\\kaleidoscope.exe';
const chirosurf = 'D:\\Logiciels\\ChiroSurf_4.6.exe';
const imported = {
  headers: ['AUTO ID*', 'INDIR', 'FOLDER', 'IN FILE'],
  records: [['PIPPIP', 'C:\\Sons de terrain', 'Nuit 1', 'contact.wav'],
    ['PIPPIP', 'ignored', 'ignored', '\\\\serveur\\sons\\autre.wav']]
};

function ui(preferences = {}, options = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', checked: false, textContent: '', hidden: true, open: false,
      listeners: new Map(),
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      fire(name) { return this.listeners.get(name)?.({ preventDefault() {} }); },
      showModal() { this.open = true; },
      close() { this.open = false; },
      focus() { this.focused = true; }
    });
    return nodes.get(id);
  };
  const values = options.values || new Map([[key, JSON.stringify(preferences)]]);
  const calls = [], statuses = [], preferenceChanges = [];
  const storage = options.storage || { getItem: k => values.get(k) ?? null, setItem: (k, value) => values.set(k, value) };
  const reviewEditor = {
    draft: Settings.normalize(),
    set(value) { this.draft = Settings.normalize(value); },
    get() { return Settings.normalize(this.draft); },
    focusInvalid() { this.focused = true; }
  };
  const h = Wav.init({
    reviewSettingsUI: reviewEditor,
    document: { getElementById: node, querySelector: () => options.token === false ? null : { content: 'local-test-token' } },
    location: { origin: options.origin || 'http://127.0.0.1:4174' }, storage,
    onStatus: (message, isError) => statuses.push({ message, isError }),
    onPreferencesChange: (next, previous) => preferenceChanges.push({ next, previous }),
    fetch: async (url, request) => {
      calls.push({ url, ...request, body: JSON.parse(request.body) });
      if (options.fetch) return options.fetch(url, request);
      return options.response || { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
  });
  return { h, node, calls, statuses, values, preferenceChanges, reviewEditor,
    open: () => node('open-settings').fire('click'),
    choose: id => { node('wav-settings-viewer').value = id; node('wav-settings-viewer').fire('change'); },
    save: () => node('wav-settings-form').fire('submit'),
    saved: () => JSON.parse(values.get(key)) };
}

test('configured WAV opening resolves source INDIR and FOLDER and sends only the chosen paths to the same-origin companion', async () => {
  const app = ui({ kaleidoscopeExecutable: kaleidoscope });
  const before = JSON.stringify(imported);
  assert.equal(await app.h.openContact(imported, { recordIndex: 0 }), true);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].url, '/api/open-recording');
  assert.equal(app.calls[0].method, 'POST');
  assert.deepEqual(app.calls[0].headers, { 'Content-Type': 'application/json', 'X-Plecotus-Token': 'local-test-token' });
  assert.deepEqual(app.calls[0].body, { viewer: 'kaleidoscope', executable: kaleidoscope, file: 'C:\\Sons de terrain\\Nuit 1\\contact.wav', searchFolders: [] });
  assert.ok(app.calls[0].signal instanceof AbortSignal);
  assert.equal(JSON.stringify(imported), before);
  assert.match(app.statuses.at(-1).message, /Ouverture demandée dans Kaleidoscope/);
});

test('the selected ChiroSurf path is used and absolute WAV paths take precedence', async () => {
  const app = ui({ wavViewer: 'chirosurf', kaleidoscopeExecutable: kaleidoscope, chirosurfExecutable: chirosurf });
  await app.h.openContact(imported, { recordIndex: 1 });
  assert.deepEqual(app.calls[0].body, { viewer: 'chirosurf', executable: chirosurf, file: '\\\\serveur\\sons\\autre.wav', searchFolders: [] });
});

test('missing selected executable opens settings without falling back to another configured software', async () => {
  const app = ui({ wavViewer: 'chirosurf', kaleidoscopeExecutable: kaleidoscope });
  assert.equal(await app.h.openContact(imported, { recordIndex: 0 }), false);
  assert.equal(app.calls.length, 0);
  assert.equal(app.node('wav-settings').open, true);
  assert.equal(app.node('wav-settings-executable').focused, true);
  assert.equal(app.node('wav-settings-viewer').value, 'chirosurf');
  assert.match(app.node('wav-settings-error').textContent, /Renseignez.*ChiroSurf/);
});

test('settings preserve separate software paths, accept Explorer quotes and keep unrelated preferences', async () => {
  const app = ui({ reviewer: 'AB', kaleidoscopeExecutable: kaleidoscope });
  app.open();
  app.node('wav-settings-executable').value = '"E:\\Applications\\kaleidoscope.exe"';
  app.choose('chirosurf');
  app.node('wav-settings-executable').value = chirosurf;
  app.choose('kaleidoscope');
  assert.equal(app.node('wav-settings-executable').value, '"E:\\Applications\\kaleidoscope.exe"');
  app.choose('chirosurf');
  app.save();
  assert.equal(app.node('wav-settings').open, false);
  assert.deepEqual(app.saved(), { reviewer: 'AB', wavViewer: 'chirosurf',
    kaleidoscopeExecutable: 'E:\\Applications\\kaleidoscope.exe', chirosurfExecutable: chirosurf,
    debugMode: false, includeCommonPipistrelle: true, wavSearchFolders: [], reviewSettings: Settings.normalize() });
  assert.equal(app.calls.length, 0, 'saving does not launch a WAV');
  const reloaded = ui({}, { values: app.values });
  await reloaded.h.openContact(imported, { recordIndex: 0 });
  assert.equal(reloaded.calls[0].body.executable, chirosurf);
});

test('cancelling settings discards both software path drafts', () => {
  const app = ui({ kaleidoscopeExecutable: kaleidoscope, chirosurfExecutable: chirosurf });
  app.open();
  app.node('wav-settings-executable').value = 'E:\\Other\\kaleidoscope.exe';
  app.choose('chirosurf');
  app.node('wav-settings-executable').value = 'E:\\Other\\ChiroSurf.exe';
  app.node('wav-settings-cancel').fire('click');
  app.open();
  assert.equal(app.node('wav-settings-executable').value, kaleidoscope);
  app.choose('chirosurf');
  assert.equal(app.node('wav-settings-executable').value, chirosurf);
});

test('invalid path edits fail atomically and leave the previous saved software usable', async () => {
  const app = ui({ kaleidoscopeExecutable: kaleidoscope });
  app.open();
  app.node('wav-settings-executable').value = 'E:\\Apps\\kaleidoscope.exe';
  app.choose('chirosurf');
  app.node('wav-settings-executable').value = 'C:\\Windows\\System32\\cmd.exe';
  app.save();
  assert.equal(app.node('wav-settings').open, true);
  assert.match(app.node('wav-settings-error').textContent, /exécutable ChiroSurf/);
  assert.equal(app.saved().kaleidoscopeExecutable, kaleidoscope);
  app.node('wav-settings-cancel').fire('click');
  await app.h.openContact(imported, { recordIndex: 0 });
  assert.equal(app.calls[0].body.executable, kaleidoscope);
});

test('file URLs, previews, foreign hosts and missing launcher tokens cannot call a local opening endpoint', async () => {
  for (const options of [{ origin: 'null' }, { origin: 'http://127.0.0.1:4173' },
    { origin: 'https://example.org' }, { token: false }]) {
    const app = ui({ kaleidoscopeExecutable: kaleidoscope }, options);
    assert.equal(await app.h.openContact(imported, { recordIndex: 0 }), false);
    assert.equal(app.calls.length, 0);
    assert.equal(app.node('wav-settings').open, true);
    assert.match(app.node('wav-settings-error').textContent, /Demarrer-Plecotus.cmd/);
  }
});

test('invalid or incomplete WAV source paths and unknown contact indices never reach the launcher', async () => {
  for (const [data, best] of [
    [{ headers: ['IN FILE'], records: [['relative.wav']] }, { recordIndex: 0 }],
    [{ headers: ['IN FILE'], records: [['C:\\Sons\\not-wav.exe']] }, { recordIndex: 0 }],
    [imported, { recordIndex: -1 }], [imported, { recordIndex: 2 }]
  ]) {
    const app = ui({ kaleidoscopeExecutable: kaleidoscope });
    assert.equal(await app.h.openContact(data, best), false);
    assert.equal(app.calls.length, 0);
    assert.equal(app.statuses.at(-1).isError, true);
  }
});

test('launcher errors are shown clearly, including an outdated endpoint and an unavailable companion', async () => {
  for (const [options, message] of [
    [{ response: { ok: false, status: 404 } }, /lanceur doit être mis à jour/],
    [{ response: { ok: false, status: 422, json: async () => ({ ok: false, error: 'Fichier WAV introuvable.' }) } }, /Fichier WAV introuvable/],
    [{ fetch: async () => { throw new TypeError('network failure'); } }, /Lanceur local indisponible/],
    [{ fetch: async () => { const error = new Error('timeout'); error.name = 'AbortError'; throw error; } }, /Lanceur local indisponible/]
  ]) {
    const app = ui({ kaleidoscopeExecutable: kaleidoscope }, options);
    assert.equal(await app.h.openContact(imported, { recordIndex: 0 }), false);
    assert.match(app.statuses.at(-1).message, message);
    assert.equal(app.statuses.at(-1).isError, true);
  }
});

test('repeated clicks while opening make a single request, and the next click works after completion', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const app = ui({ kaleidoscopeExecutable: kaleidoscope }, { fetch: () => pending });
  const first = app.h.openContact(imported, { recordIndex: 0 });
  assert.equal(await app.h.openContact(imported, { recordIndex: 1 }), false);
  assert.equal(app.calls.length, 1);
  complete({ ok: true, status: 200, json: async () => ({ ok: true }) });
  assert.equal(await first, true);
  assert.equal(await app.h.openContact(imported, { recordIndex: 1 }), true);
  assert.equal(app.calls.length, 2);
});

test('settings remain usable for the session when browser storage is unavailable', async () => {
  const app = ui({}, { storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  app.open();
  app.node('wav-settings-executable').value = kaleidoscope;
  app.save();
  assert.match(app.statuses.at(-1).message, /cette session/);
  assert.equal(await app.h.openContact(imported, { recordIndex: 0 }), true);
});

test('malformed stored preferences can be replaced by valid settings', () => {
  const app = ui({}, { values: new Map([[key, '{bad-json']]) });
  app.open();
  app.node('wav-settings-executable').value = kaleidoscope;
  app.save();
  assert.equal(app.saved().kaleidoscopeExecutable, kaleidoscope);
  assert.match(app.statuses.at(-1).message, /enregistrés/);
});

test('new settings use strict boolean defaults and do not notify during initialization', () => {
  for (const preferences of [{}, { debugMode: 'true', includeCommonPipistrelle: 'false' },
    { debugMode: 1, includeCommonPipistrelle: 0 }, { debugMode: null, includeCommonPipistrelle: null }]) {
    const app = ui(preferences);
    assert.deepEqual(legacy(app.h.getPreferences()), { debugMode: false, includeCommonPipistrelle: true });
    assert.equal(app.preferenceChanges.length, 0);
    app.open();
    assert.equal(app.node('settings-debug-mode').checked, false);
    assert.equal(app.node('settings-common-pipistrelle').value, 'yes');
    const snapshot = app.h.getPreferences();
    snapshot.debugMode = true;
    assert.equal(app.h.getPreferences().debugMode, false, 'the returned snapshot cannot change active settings');
  }
});

test('debug and common pipistrelle preferences persist and hydrate false values without coercion', () => {
  const app = ui({ reviewer: 'AB', debugMode: false, includeCommonPipistrelle: false });
  assert.deepEqual(legacy(app.h.getPreferences()), { debugMode: false, includeCommonPipistrelle: false });
  app.open();
  assert.equal(app.node('settings-debug-mode').checked, false);
  assert.equal(app.node('settings-common-pipistrelle').value, 'no');
  app.node('settings-debug-mode').checked = true;
  app.node('settings-common-pipistrelle').value = 'yes';
  app.save();
  assert.deepEqual(legacy(app.h.getPreferences()), { debugMode: true, includeCommonPipistrelle: true });
  assert.deepEqual(app.preferenceChanges.map(({next, previous}) => ({next: legacy(next), previous: legacy(previous)})), [{ next: { debugMode: true, includeCommonPipistrelle: true },
    previous: { debugMode: false, includeCommonPipistrelle: false } }]);
  assert.equal(app.saved().reviewer, 'AB');
  const reloaded = ui({}, { values: app.values });
  assert.deepEqual(legacy(reloaded.h.getPreferences()), { debugMode: true, includeCommonPipistrelle: true });
  assert.equal(reloaded.preferenceChanges.length, 0);
  reloaded.open();
  reloaded.node('settings-debug-mode').checked = false;
  reloaded.node('settings-common-pipistrelle').value = 'no';
  reloaded.save();
  assert.equal(reloaded.saved().debugMode, false);
  assert.equal(reloaded.saved().includeCommonPipistrelle, false);
  assert.deepEqual(legacy(ui({}, { values: app.values }).h.getPreferences()), { debugMode: false, includeCommonPipistrelle: false });
});

test('viewer changes keep pending preference edits and cancelling discards them', () => {
  const app = ui({ kaleidoscopeExecutable: kaleidoscope });
  app.open();
  app.node('settings-debug-mode').checked = true;
  app.node('settings-common-pipistrelle').value = 'no';
  app.choose('chirosurf');
  app.choose('kaleidoscope');
  assert.equal(app.node('settings-debug-mode').checked, true);
  assert.equal(app.node('settings-common-pipistrelle').value, 'no');
  assert.deepEqual(legacy(app.h.getPreferences()), { debugMode: false, includeCommonPipistrelle: true });
  app.node('wav-settings-cancel').fire('click');
  app.open();
  assert.equal(app.node('settings-debug-mode').checked, false);
  assert.equal(app.node('settings-common-pipistrelle').value, 'yes');
  assert.equal(app.preferenceChanges.length, 0);
});

test('an invalid executable prevents partial preference saves and notifications', () => {
  const app = ui({ kaleidoscopeExecutable: kaleidoscope, debugMode: false, includeCommonPipistrelle: true });
  app.open();
  app.node('settings-debug-mode').checked = true;
  app.node('settings-common-pipistrelle').value = 'no';
  app.node('wav-settings-executable').value = 'C:\\Windows\\System32\\cmd.exe';
  app.save();
  assert.equal(app.node('wav-settings').open, true);
  assert.deepEqual(legacy(app.h.getPreferences()), { debugMode: false, includeCommonPipistrelle: true });
  assert.equal(app.saved().debugMode, false);
  assert.equal(app.saved().includeCommonPipistrelle, true);
  assert.equal(app.preferenceChanges.length, 0);
  assert.equal(app.node('settings-debug-mode').checked, true, 'failed validation leaves the pending edits visible');
  assert.equal(app.node('settings-common-pipistrelle').value, 'no');
  app.node('wav-settings-executable').value = kaleidoscope;
  app.save();
  assert.deepEqual(legacy(app.h.getPreferences()), { debugMode: true, includeCommonPipistrelle: false });
  assert.equal(app.preferenceChanges.length, 1);
});

test('a valid save notifies preference changes even when persistent storage is unavailable', () => {
  const app = ui({}, { storage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } } });
  app.open();
  app.node('settings-debug-mode').checked = true;
  app.node('settings-common-pipistrelle').value = 'no';
  app.save();
  assert.deepEqual(legacy(app.h.getPreferences()), { debugMode: true, includeCommonPipistrelle: false });
  assert.deepEqual(app.preferenceChanges.map(({next, previous}) => ({next: legacy(next), previous: legacy(previous)})), [{ next: { debugMode: true, includeCommonPipistrelle: false },
    previous: { debugMode: false, includeCommonPipistrelle: true } }]);
  assert.match(app.statuses.at(-1).message, /cette session/);
});

test('review rules save and hydrate with WAV search folders and independent preference snapshots', () => {
  const app = ui({ wavSearchFolders: ['D:\\Archives'], reviewer: 'AB' });
  app.open();
  app.reviewEditor.draft = Settings.normalize({ excludedSpecies: ['PIPPIP'], ratioThreshold: .8,
    majorityThreshold: .75, ranking: [{ key: 'qual', direction: 'asc' }] });
  app.save();
  assert.equal(app.saved().reviewSettings.ratioThreshold, .8);
  assert.deepEqual(app.saved().wavSearchFolders, ['D:\\Archives']);
  assert.equal(app.saved().reviewer, 'AB');
  const reloaded = ui({}, { values: app.values });
  assert.deepEqual(reloaded.h.getPreferences().reviewSettings, app.saved().reviewSettings);
  const snapshot = app.h.getPreferences();
  snapshot.reviewSettings.excludedSpecies.push('NYCNOC');
  snapshot.reviewSettings.ranking[0].direction = 'desc';
  assert.deepEqual(app.h.getPreferences().reviewSettings.excludedSpecies, ['PIPPIP', 'NoID']);
  assert.equal(app.h.getPreferences().reviewSettings.ranking[0].direction, 'asc');
  app.preferenceChanges[0].next.reviewSettings.ranking.length = 0;
  assert.equal(app.h.getPreferences().reviewSettings.ranking.length, 1);
});

test('invalid review rules cannot partially save software, thresholds or other preferences', () => {
  const app = ui({ kaleidoscopeExecutable: kaleidoscope });
  app.open();
  app.reviewEditor.draft.ratioThreshold = 1.01;
  app.node('settings-debug-mode').checked = true;
  app.node('wav-settings-executable').value = 'D:\\Applications\\kaleidoscope.exe';
  app.save();
  assert.equal(app.node('wav-settings').open, true);
  assert.equal(app.reviewEditor.focused, true);
  assert.match(app.node('wav-settings-error').textContent, /seuil MATCH RATIO/);
  assert.equal(app.h.getPreferences().debugMode, false);
  assert.equal(app.h.getPreferences().reviewSettings.ratioThreshold, .6);
  assert.equal(app.saved().kaleidoscopeExecutable, kaleidoscope);
  assert.equal(app.preferenceChanges.length, 0);
  app.node('wav-settings-cancel').fire('click');
  app.open();
  assert.deepEqual(app.reviewEditor.draft, Settings.normalize());
});

test('malformed saved review rules fall back to defaults while keeping valid unrelated preferences', () => {
  const app = ui({ reviewSettings: { excludedSpecies: ['not-a-species'], ratioThreshold: 99 }, debugMode: true });
  assert.deepEqual(app.h.getPreferences().reviewSettings, Settings.normalize());
  assert.equal(app.h.getPreferences().debugMode, true);
});
