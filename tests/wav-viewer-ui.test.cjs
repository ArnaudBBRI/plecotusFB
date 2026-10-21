const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');
const A = require('../automation.js');
const P = require('../review-plan.js');
const K = require('../kaleidoscope.js');

const PREFS = 'plecotus.preferences.v1';
const kaleidoscope = 'C:\\Applications\\Kaleidoscope\\kaleidoscope.exe';
const chirosurf = 'D:\\Logiciels\\ChiroSurf_4.6.exe';
const plain = value => JSON.parse(JSON.stringify(value));

// Execute the production settings and opening handlers with a small DOM double.
// Only rendering/persistence unrelated to these handlers is replaced at the closure boundary.
function ui(preferences = {}, options = {}) {
  const storage = options.storage || new Map([[PREFS, JSON.stringify(preferences)]]);
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', textContent: '', hidden: true, disabled: false, dataset: {},
      classList: { toggle() {}, remove() {} },
      querySelectorAll() { return []; },
      setAttribute(name, value) { this[name] = value; },
      focus() { this.focused = true; },
      showModal() { this.open = true; },
      close() { this.open = false; }
    });
    return nodes.get(id);
  };
  const cancel = node('cancel-settings'); cancel.dataset.close = 'reviewer-dialog';
  const calls = [];
  const window = { BatReviewCore: C, BatClassification: A, BatReviewPlan: P, BatKaleidoscope: K, addEventListener() {} };
  const document = {
    getElementById: node, body: node('body'),
    querySelector(selector) { return selector === 'meta[name="plecotus-local-token"]' ? { content: 'test-local-token' } : null; },
    querySelectorAll(selector) { return selector === '[data-close]' ? [cancel] : []; },
    addEventListener() {}
  };
  let source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(source.endsWith('})();\n'), 'The test attaches hooks at the app closure boundary.');
  source = source.slice(0, -6) + `
    renderFocusedContact = () => {};
    persist = () => {};
    window.wavViewerTest = {state, recalculate, openRecording};
  })();`;
  vm.runInNewContext(source, {
    window, document, location: { origin: 'http://127.0.0.1:4174' }, AbortController,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    setTimeout() { return 1; }, clearTimeout() {},
    async fetch(url, request) {
      calls.push({ url, method: request.method, headers: plain(request.headers), body: JSON.parse(request.body), signal: request.signal });
      return options.response || { status: 200, ok: true, async json() { return { ok: true }; } };
    }
  }, { filename: 'app.js' });
  const open = () => node('reviewer-settings').onclick();
  const choose = viewer => { node('wav-viewer').value = viewer; node('wav-viewer').onchange(); };
  const save = () => node('reviewer-form').onsubmit({ preventDefault() {} });
  return { h: window.wavViewerTest, node, storage, calls, open, choose, save, cancel: () => cancel.onclick(), saved: () => JSON.parse(storage.get(PREFS)) };
}

function loadContacts(h) {
  const headers = ['INDIR', 'IN FILE', 'AUTO ID', 'PULSES', 'MATCHING', 'MATCH RATIO', 'MANUAL ID'];
  const records = [
    ['C:\\Sons de terrain', 'premier.wav', 'PIPPIP', '10', '9', '.9', ''],
    ['C:\\Sons de terrain', 'second.wav', 'PIPPIP', '10', '8', '.8', ''],
    ['C:\\Sons de terrain', 'troisieme.wav', 'MYODAS', '10', '6', '.6', '']
  ];
  const data = { headers, ...C.analyze(headers, records) };
  Object.assign(h.state, {
    data, rowById: new Map(data.rows.map(row => [row.id, row])),
    reviews: { [data.rows[0].id]: { status: 'confirmed', label: 'PIPPIP', reviewer: 'AB' } },
    drafts: { [data.rows[2].id]: { status: 'corrected', label: 'Myotis sp.', notes: 'À écouter' } }
  });
  h.recalculate();
  return data.rows[1];
}

function classificationSnapshot(state) {
  return JSON.stringify({
    data: state.data, reviews: state.reviews, drafts: state.drafts, selections: state.selections,
    policy: state.policy, classification: { ...state.classification, byId: [...state.classification.byId] },
    reviewPlan: state.reviewPlan
  });
}

test('legacy reviewer and executable preferences migrate to the Kaleidoscope default', () => {
  const app = ui({ reviewer: 'Ancien vérificateur', kaleidoscopeExecutable: kaleidoscope });
  app.open();
  assert.equal(app.node('wav-viewer').value, 'kaleidoscope');
  assert.equal(app.node('default-reviewer').value, 'Ancien vérificateur');
  assert.equal(app.node('wav-viewer-executable').value, kaleidoscope);
  app.save();
  assert.deepEqual(app.saved(), { reviewer: 'Ancien vérificateur', wavViewer: 'kaleidoscope', kaleidoscopeExecutable: kaleidoscope, chirosurfExecutable: '' });
});

test('choosing a viewer keeps separate executable paths through switching, saving and reloading', () => {
  const app = ui({ reviewer: 'AB', kaleidoscopeExecutable: kaleidoscope });
  app.open();
  const newKaleidoscope = 'E:\\Logiciels\\kaleidoscope.exe';
  app.node('wav-viewer-executable').value = newKaleidoscope;
  app.choose('chirosurf');
  assert.equal(app.node('wav-viewer-executable').value, '');
  app.node('wav-viewer-executable').value = chirosurf;
  app.choose('kaleidoscope');
  assert.equal(app.node('wav-viewer-executable').value, newKaleidoscope);
  app.choose('chirosurf');
  assert.equal(app.node('wav-viewer-executable').value, chirosurf);
  app.node('default-reviewer').value = '  CD  ';
  app.save();
  assert.equal(app.node('reviewer-dialog').open, false);
  assert.deepEqual(app.saved(), { reviewer: 'CD', wavViewer: 'chirosurf', kaleidoscopeExecutable: newKaleidoscope, chirosurfExecutable: chirosurf });

  const reloaded = ui({}, { storage: app.storage }); reloaded.open();
  assert.equal(reloaded.node('wav-viewer').value, 'chirosurf');
  assert.equal(reloaded.node('wav-viewer-executable').value, chirosurf);
  assert.equal(reloaded.node('default-reviewer').value, 'CD');
  reloaded.choose('kaleidoscope');
  assert.equal(reloaded.node('wav-viewer-executable').value, newKaleidoscope);
  reloaded.save();
  const again = ui({}, { storage: app.storage }); again.open();
  assert.equal(again.node('wav-viewer').value, 'kaleidoscope');
  again.choose('chirosurf');
  assert.equal(again.node('wav-viewer-executable').value, chirosurf);
});

test('closing settings discards draft viewer, paths and reviewer changes', () => {
  const app = ui({ reviewer: 'AB', wavViewer: 'kaleidoscope', kaleidoscopeExecutable: kaleidoscope, chirosurfExecutable: chirosurf });
  const before = app.storage.get(PREFS);
  app.open();
  app.node('wav-viewer-executable').value = 'E:\\Autre\\kaleidoscope.exe';
  app.choose('chirosurf');
  app.node('wav-viewer-executable').value = 'E:\\Autre\\ChiroSurf.exe';
  app.node('default-reviewer').value = 'CD';
  app.cancel();
  assert.equal(app.node('reviewer-dialog').open, false);
  assert.equal(app.storage.get(PREFS), before);
  app.open();
  assert.equal(app.node('wav-viewer').value, 'kaleidoscope');
  assert.equal(app.node('wav-viewer-executable').value, kaleidoscope);
  assert.equal(app.node('default-reviewer').value, 'AB');
  app.choose('chirosurf');
  assert.equal(app.node('wav-viewer-executable').value, chirosurf);
});

test('an invalid executable in either viewer prevents partially saving valid changes', async () => {
  const app = ui({ reviewer: 'AB', wavViewer: 'kaleidoscope', kaleidoscopeExecutable: kaleidoscope, chirosurfExecutable: chirosurf });
  const before = app.storage.get(PREFS);
  app.open();
  app.node('default-reviewer').value = 'CD';
  app.node('wav-viewer-executable').value = 'E:\\Nouveau\\kaleidoscope.exe';
  app.choose('chirosurf');
  app.node('wav-viewer-executable').value = 'E:\\Nouveau\\other.exe';
  app.choose('kaleidoscope');
  app.save();
  assert.equal(app.node('reviewer-dialog').open, true);
  assert.equal(app.node('wav-viewer').value, 'chirosurf', 'The invalid path is presented for correction even when another viewer was selected.');
  assert.equal(app.node('wav-viewer-executable').focused, true);
  assert.match(app.node('settings-error').textContent, /exécutable ChiroSurf/);
  assert.equal(app.storage.get(PREFS), before);
  assert.equal(app.h.state.reviewer, 'AB');
  await app.h.openRecording({ file: 'C:\\Sons\\son.wav' });
  assert.equal(app.calls[0].body.viewer, 'kaleidoscope');
  assert.equal(app.calls[0].body.executable, kaleidoscope);
});

test('opening uses the selected viewer and its own path without changing classification', async () => {
  for (const viewer of ['kaleidoscope', 'chirosurf']) {
    const app = ui({ reviewer: 'AB', wavViewer: viewer, kaleidoscopeExecutable: kaleidoscope, chirosurfExecutable: chirosurf });
    const row = loadContacts(app.h);
    const classification = app.h.state.classification;
    const before = classificationSnapshot(app.h.state);
    await app.h.openRecording(row);
    assert.equal(app.calls.length, 1);
    const call = app.calls[0];
    assert.equal(call.url, '/api/open-recording');
    assert.equal(call.method, 'POST');
    assert.deepEqual(call.headers, { 'Content-Type': 'application/json', 'X-Plecotus-Token': 'test-local-token' });
    assert.deepEqual(call.body, { viewer, executable: viewer === 'chirosurf' ? chirosurf : kaleidoscope, file: 'C:\\Sons de terrain\\second.wav' });
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(app.h.state.classification, classification);
    assert.equal(classificationSnapshot(app.h.state), before);
    assert.equal(app.node('open-recording').disabled, false);
    assert.match(app.node('toast').textContent, new RegExp('Ouverture demandée dans ' + (viewer === 'chirosurf' ? 'ChiroSurf' : 'Kaleidoscope')));
  }
});

test('an empty selected ChiroSurf path opens settings without falling back to Kaleidoscope', async () => {
  const app = ui({ reviewer: 'AB', wavViewer: 'chirosurf', kaleidoscopeExecutable: kaleidoscope, chirosurfExecutable: '' });
  const row = loadContacts(app.h); const before = classificationSnapshot(app.h.state);
  await app.h.openRecording(row);
  assert.equal(app.calls.length, 0);
  assert.equal(app.node('reviewer-dialog').open, true);
  assert.equal(app.node('wav-viewer').value, 'chirosurf');
  assert.equal(app.node('wav-viewer-executable').value, '');
  assert.equal(app.node('wav-viewer-executable').focused, true);
  assert.match(app.node('settings-error').textContent, /Renseignez.*ChiroSurf/);
  assert.equal(classificationSnapshot(app.h.state), before);
});

test('an older launcher returns a clear update and restart instruction for the new endpoint', async () => {
  const app = ui({ wavViewer: 'chirosurf', chirosurfExecutable: chirosurf }, {
    response: { status: 404, ok: false, async json() { throw new Error('The legacy HTML response must not be parsed as JSON.'); } }
  });
  const row = loadContacts(app.h); const before = classificationSnapshot(app.h.state);
  await app.h.openRecording(row);
  assert.equal(app.calls.length, 1);
  assert.match(app.node('toast').textContent, /lanceur doit être mis à jour/);
  assert.match(app.node('toast').textContent, /Réglages.*arrêtez-le.*relancez Demarrer-Plecotus\.cmd.*nouvelle version.*rechargez la page/);
  assert.equal(app.node('open-recording').disabled, false);
  assert.equal(classificationSnapshot(app.h.state), before);
});
