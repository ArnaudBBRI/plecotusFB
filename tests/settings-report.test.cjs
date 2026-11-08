const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../review-settings.js');
const Report = require('../settings-report.js');
const UI = require('../settings-report-ui.js');
const Wav = require('../wav-opening.js');

const now = '2026-11-02T12:34:56Z';
const configuration = () => ({
  reviewer: '',
  reviewSettings: Settings.normalize({ ratioThreshold: .8, majorityThreshold: .75,
    excludedSpecies: ['PIPPIP'], ranking: [{ key: 'qual', direction: 'asc' }, { key: 'ratio', direction: 'desc' }] }),
  debugMode: true, includeCommonPipistrelle: false, wavViewer: 'chirosurf',
  kaleidoscopeExecutable: 'C:\\Logiciels\\kaleidoscope.exe',
  chirosurfExecutable: 'D:\\Sons\\ChiroSurf.exe', wavSearchFolders: ['E:\\Archives', '\\\\serveur\\sons\\']
});

test('report describes the applied thresholds, ordered ranking, exclusions and complete operational configuration', () => {
  const config = configuration();
  const before = structuredClone(config);
  const report = Report.build(config, { now });
  assert.match(report.text, /Plecotus v22/);
  assert.match(report.text, /Paramètres enregistrés actuellement appliqués/);
  assert.match(report.text, /Au moins 75 %.*MATCH RATIO supérieur ou égal à 0,8/);
  assert.match(report.text, /1\. Qual : ordre croissant\.\n2\. MATCH RATIO : ordre décroissant\./);
  assert.match(report.text, /PIPPIP — Pipistrelle commune \(Pipistrellus pipistrellus\)/);
  assert.match(report.text, /NoID — Chauve-souris non identifiée/);
  assert.match(report.text, /Mode débogage : activé/);
  assert.match(report.text, /Pipistrelle commune par défaut dans les graphiques : non/);
  assert.match(report.text, /Logiciel sélectionné : ChiroSurf/);
  for (const value of [config.kaleidoscopeExecutable, config.chirosurfExecutable, ...config.wavSearchFolders]) {
    assert.ok(report.text.includes(value), value);
  }
  assert.deepEqual(config, before, 'report generation must not modify the applied settings');
});

test('reports identify the reviewer and use an explicit fallback when no name is provided', () => {
  const named = Report.build({ ...configuration(), reviewer: 'Marie Dupont' }, { now });
  assert.match(named.text, /Vérificateur : Marie Dupont/);
  assert.match(named.fragment, /Vérificateur : Marie Dupont/);
  for (const reviewer of [undefined, '', '   ']) {
    assert.match(Report.build({ ...configuration(), reviewer }, { now }).text, /Vérificateur : non spécifié/);
  }
});

test('reviewer names remain plain text in HTML report exports', () => {
  const reviewer = '<img src=x onerror="alert(1)"> & Élodie';
  const report = Report.build({ ...configuration(), reviewer }, { now });
  assert.ok(report.text.includes('Vérificateur : ' + reviewer));
  assert.ok(report.html.includes('Vérificateur : &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Élodie'));
  assert.equal(report.html.includes('<img'), false);
});

test('reports distinguish the current unsaved form values from settings already applied', () => {
  const dirty = Report.build({ ...configuration(), hasUnsavedChanges: true }, { now });
  assert.match(dirty.text, /Paramètres affichés dans Réglages, modifications non encore enregistrées/);
  assert.doesNotMatch(dirty.text, /Paramètres enregistrés actuellement appliqués/);
  assert.match(dirty.html, /modifications non encore enregistrées/);
  const applied = Report.build({ ...configuration(), hasUnsavedChanges: false }, { now });
  assert.match(applied.text, /Paramètres enregistrés actuellement appliqués/);
  assert.doesNotMatch(applied.text, /modifications non encore enregistrées/);
});

test('methods report distinguishes pending identifications from completed NoID and explains sampling and calculated counts', () => {
  const report = Report.build({}, { now });
  assert.match(report.text, /Les valeurs absentes ou invalides passent après les valeurs valides/);
  assert.match(report.text, /ordre des lignes dans le fichier/);
  assert.match(report.text, /sans valeur numérique exploitable dans MATCHING, MATCH RATIO et Qual/);
  assert.match(report.text, /NoID.*échantillon de 20 %/);
  assert.match(report.text, /ceil\(20 % × effectif du groupe\)/);
  assert.match(report.text, /meilleur contact déjà contrôlé est compris dans ce quota/);
  assert.match(report.text, /ratios absents ou invalides/);
  assert.match(report.text, /décision « à identifier ».*reste en attente/);
  assert.match(report.text, /ne contribue pas aux proportions tant qu’elle n’est pas résolue/);
  assert.match(report.text, /Identification incertaine\/non résolue — À revoir/);
  assert.match(report.text, /poursuivre les autres contrôles en conservant la liste des contacts à revoir/);
  assert.match(report.text, /ne contribue ni aux proportions ni à la validation globale, et la finalisation reste bloquée/);
  assert.match(report.text, /NoID explicitement choisie.*catégorie terminée/);
  assert.match(report.text, /estimation des effectifs des contacts non écoutés/);
  assert.match(report.text, /plus forts restes/);
});

test('reports use the Brussels local date and time independently of the execution timezone', () => {
  const winter = Report.build({}, { now: '2026-11-02T23:30:00Z' });
  assert.equal(winter.fileStem, 'plecotus_v22_parametres_2026-11-03_0030');
  assert.match(winter.timestamp, /Europe\/Brussels/);
  const summer = Report.build({}, { now: '2026-07-02T12:00:00Z' });
  assert.equal(summer.fileStem, 'plecotus_v22_parametres_2026-07-02_1400');
});

test('small configured thresholds are reported without rounding them to zero', () => {
  const report = Report.build({ reviewSettings: { ratioThreshold: 1e-16, majorityThreshold: .333 } }, { now });
  assert.match(report.text, /MATCH RATIO ≥ 0,0000000000000001/);
  assert.match(report.text, /Au moins 33,3 %/);
});

test('HTML export escapes every configuration value and is a standalone French document', () => {
  const dangerous = '\\<img src=x onerror="alert(1)">&';
  const report = Report.build({ ...configuration(), wavSearchFolders: [dangerous] }, { now });
  assert.ok(report.text.includes(dangerous));
  assert.ok(report.html.startsWith('<!doctype html><html lang="fr">'));
  assert.match(report.html, /<meta charset="utf-8">/);
  assert.ok(report.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;'));
  assert.equal(report.html.includes('<img'), false);
  assert.equal(report.html.includes('<script'), false);
  assert.match(report.fragment, /<ol><li>Qual : ordre croissant/);
});

function view(overrides = {}) {
  class Node {
    constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    fire(name) { return this.listeners.get(name)?.(); }
    focus() { this.focused = true; }
    select() { this.selected = true; }
  }
  const host = new Node('section');
  let config = configuration();
  const downloads = [];
  const ui = UI.init({ document: { createElement: tag => new Node(tag) }, host,
    getConfiguration: () => { if (config instanceof Error) throw config; return config; }, now: () => now, clipboard: null,
    download: file => downloads.push(file), ...overrides });
  const button = label => host.children.find(node => node.className === 'settings-report-actions')
    .children.find(node => node.textContent === label);
  const preview = host.children.find(node => node.tagName === 'textarea');
  const status = host.children.find(node => node.className === 'settings-help settings-report-status');
  return { ui, button, preview, status, downloads, setConfiguration(value) { config = value; } };
}

test('copy provides rich HTML and plain text for Word from the latest applied configuration', async () => {
  let copied;
  class ClipboardItem { constructor(values) { this.values = values; } }
  const v = view({ ClipboardItem, clipboard: { write: async value => { copied = value; } } });
  v.ui.refresh();
  v.setConfiguration({ ...configuration(), reviewSettings: Settings.normalize({ ratioThreshold: .95 }) });
  assert.equal(await v.button('Copier pour Word').fire('click'), true);
  assert.equal(copied.length, 1);
  const plain = await copied[0].values['text/plain'].text();
  const html = await copied[0].values['text/html'].text();
  assert.match(plain, /MATCH RATIO ≥ 0,95/);
  assert.match(html, /<article><h1>/);
  assert.equal(v.preview.value, plain);
  assert.match(v.status.textContent, /copié avec sa mise en forme/);
});

test('plain clipboard is supported and unavailable or denied clipboard leaves a selected visible fallback', async () => {
  let copied;
  const plain = view({ clipboard: { writeText: async text => { copied = text; } } });
  assert.equal(await plain.button('Copier pour Word').fire('click'), true);
  assert.equal(copied, plain.preview.value);
  for (const clipboard of [null, { writeText: async () => { throw new Error('permission denied'); } }]) {
    const fallback = view({ clipboard });
    assert.equal(await fallback.button('Copier pour Word').fire('click'), false);
    assert.equal(fallback.preview.readOnly, true);
    assert.equal(fallback.preview.focused, true);
    assert.equal(fallback.preview.selected, true);
    assert.match(fallback.status.textContent, /Ctrl\+C/);
    assert.equal(fallback.button('Copier pour Word').disabled, false);
  }
  class ClipboardItem { constructor(values) { this.values = values; } }
  const deniedRich = view({ ClipboardItem, clipboard: { write: async () => { throw new Error('denied'); } } });
  assert.equal(await deniedRich.button('Copier pour Word').fire('click'), false);
  assert.equal(deniedRich.preview.selected, true);
  assert.match(deniedRich.status.textContent, /refusé/);
});

test('TXT and HTML download contain the same applied method and have local dated filenames', () => {
  const v = view();
  v.button('Exporter en TXT').fire('click');
  v.button('Exporter en HTML').fire('click');
  assert.equal(v.downloads.length, 2);
  assert.equal(v.downloads[0].fileName, 'plecotus_v22_parametres_2026-11-02_1334.txt');
  assert.equal(v.downloads[0].content.charCodeAt(0), 0xfeff);
  assert.equal(v.downloads[0].content.slice(1), v.preview.value);
  assert.equal(v.downloads[1].fileName, 'plecotus_v22_parametres_2026-11-02_1334.html');
  assert.match(v.downloads[1].content, /Au moins 75 %/);
  assert.match(v.status.textContent, /Rapport exporté/);
});

test('live refresh clears an invalid draft and disables every action until the form becomes valid again', () => {
  const v = view();
  v.ui.refresh();
  assert.match(v.preview.value, /MATCH RATIO ≥ 0,8/);
  v.setConfiguration(new Error('Le seuil MATCH RATIO doit être un nombre entre 0 et 1.'));
  assert.doesNotThrow(() => v.ui.refresh());
  assert.equal(v.preview.value, '');
  assert.match(v.status.textContent, /incomplets ou invalides/);
  assert.match(v.status.textContent, /MATCH RATIO/);
  for (const label of ['Copier pour Word', 'Exporter en TXT', 'Exporter en HTML']) assert.equal(v.button(label).disabled, true);
  v.setConfiguration({ ...configuration(), hasUnsavedChanges: true,
    reviewSettings: Settings.normalize({ ratioThreshold: .95 }) });
  v.ui.refresh();
  assert.match(v.preview.value, /MATCH RATIO ≥ 0,95/);
  assert.match(v.preview.value, /modifications non encore enregistrées/);
  assert.equal(v.status.textContent, '');
  for (const label of ['Copier pour Word', 'Exporter en TXT', 'Exporter en HTML']) assert.equal(v.button(label).disabled, false);
});

test('copy and export refuse an invalid current draft instead of using the last valid report', async () => {
  const copied = [];
  const v = view({ clipboard: { writeText: async text => copied.push(text) } });
  v.ui.refresh();
  v.setConfiguration(new Error('Renseignez le pourcentage minimal.'));
  assert.equal(await v.button('Copier pour Word').fire('click'), false);
  assert.doesNotThrow(() => v.button('Exporter en TXT').fire('click'));
  assert.doesNotThrow(() => v.button('Exporter en HTML').fire('click'));
  assert.deepEqual(copied, []);
  assert.deepEqual(v.downloads, []);
  assert.equal(v.preview.value, '');
  assert.match(v.status.textContent, /pourcentage/);
});

test('TXT and HTML exports use the latest visible draft even without an earlier refresh', () => {
  const v = view();
  v.ui.refresh();
  v.setConfiguration({ ...configuration(), hasUnsavedChanges: true,
    reviewSettings: Settings.normalize({ ratioThreshold: .91 }) });
  v.button('Exporter en TXT').fire('click');
  assert.match(v.downloads[0].content, /MATCH RATIO ≥ 0,91/);
  assert.match(v.downloads[0].content, /modifications non encore enregistrées/);
  v.setConfiguration({ ...configuration(), hasUnsavedChanges: true,
    reviewSettings: Settings.normalize({ ratioThreshold: .92 }) });
  v.button('Exporter en HTML').fire('click');
  assert.match(v.downloads[1].content, /MATCH RATIO ≥ 0,92/);
  assert.match(v.preview.value, /MATCH RATIO ≥ 0,92/);
});

test('a pending clipboard completion cannot re-enable actions or replace an invalid-draft message', async () => {
  let finishCopy;
  const v = view({ clipboard: { writeText: () => new Promise(resolve => { finishCopy = resolve; }) } });
  const copying = v.button('Copier pour Word').fire('click');
  v.setConfiguration(new Error('Renseignez le seuil MATCH RATIO.'));
  assert.doesNotThrow(() => v.ui.refresh());
  const message = v.status.textContent;
  finishCopy();
  assert.equal(await copying, false);
  assert.equal(v.preview.value, '');
  assert.equal(v.status.textContent, message);
  for (const label of ['Copier pour Word', 'Exporter en TXT', 'Exporter en HTML']) assert.equal(v.button(label).disabled, true);
});

test('WAV settings expose only applied deep snapshots and refresh the report after an atomic save', () => {
  const config = configuration();
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, listeners: new Map(),
      addEventListener(name, callback) { this.listeners.set(name, callback); },
      fire(name) { return this.listeners.get(name)?.({ preventDefault() {} }); },
      showModal() { this.open = true; }, close() { this.open = false; }, focus() {} });
    return nodes.get(id);
  };
  const snapshots = [];
  const editor = { draft: null, set(value) { this.draft = Settings.normalize(value); },
    get() { return Settings.normalize(this.draft); }, focusInvalid() {} };
  let app;
  app = Wav.init({ document: { getElementById: node, querySelector: () => null },
    location: { origin: 'file://' }, fetch: async () => {},
    storage: { getItem: () => JSON.stringify(config), setItem() {} }, reviewSettingsUI: editor,
    settingsReportUI: { refresh: () => snapshots.push(app.getConfiguration()) } });
  app.openSettings();
  assert.deepEqual(snapshots[0], config);
  const detached = app.getConfiguration();
  detached.reviewSettings.ranking[0].direction = 'desc';
  detached.wavSearchFolders.push('C:\\Other');
  assert.deepEqual(app.getConfiguration(), config);
  editor.draft.ratioThreshold = .95;
  node('settings-debug-mode').checked = false;
  node('wav-settings-executable').value = 'D:\\New\\ChiroSurf.exe';
  assert.equal(app.getConfiguration().reviewSettings.ratioThreshold, .8, 'the saved configuration getter remains unchanged by draft edits');
  node('wav-settings-form').fire('submit');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].reviewSettings.ratioThreshold, .95);
  assert.equal(snapshots[1].debugMode, false);
  assert.equal(snapshots[1].chirosurfExecutable, 'D:\\New\\ChiroSurf.exe');
});
