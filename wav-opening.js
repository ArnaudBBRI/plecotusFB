(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./kaleidoscope.js'));
  else root.PlecotusWavOpening = factory(root.BatReviewCore, root.BatKaleidoscope);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, K) {
  'use strict';

  const preferencesKey = 'plecotus.preferences.v1';
  const viewers = ['kaleidoscope', 'chirosurf'];
  const launcherHelp = 'Pour ouvrir les WAV en un clic, démarrez Plecotus avec Demarrer-Plecotus.cmd. Le navigateur seul ne peut pas lancer un logiciel Windows.';

  function init(options = {}) {
    const doc = options.document || globalThis.document;
    const location = options.location || globalThis.location;
    const request = options.fetch || globalThis.fetch.bind(globalThis);
    const onStatus = options.onStatus || (() => {});
    const onPreferencesChange = options.onPreferencesChange || (() => {});
    let storage = options.storage;
    if (storage === undefined) try { storage = globalThis.localStorage; } catch { storage = null; }
    const node = id => doc.getElementById(id);
    const dialog = node('wav-settings');
    const input = node('wav-settings-executable');
    const select = node('wav-settings-viewer');
    const error = node('wav-settings-error');
    const token = doc.querySelector('meta[name="plecotus-local-token"]')?.content || '';
    const localLauncher = Boolean(token) && location?.origin === 'http://127.0.0.1:4174';
    let viewer = 'kaleidoscope';
    let executables = { kaleidoscope: '', chirosurf: '' };
    let preferences = { debugMode: false, includeCommonPipistrelle: true };
    let draftViewer, drafts, opening = false;

    function savedPreferences() {
      try {
        const saved = JSON.parse(storage?.getItem(preferencesKey) || 'null');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
      } catch { return {}; }
    }

    try {
      const saved = savedPreferences();
      for (const id of viewers) {
        if (typeof saved?.[id + 'Executable'] === 'string') {
          try { executables[id] = K.normalizeExecutable(saved[id + 'Executable'], id); } catch {}
        }
      }
      if (typeof saved?.wavViewer === 'string') try { viewer = K.viewerInfo(saved.wavViewer).id; } catch {}
      for (const name of ['debugMode', 'includeCommonPipistrelle']) {
        if (typeof saved[name] === 'boolean') preferences[name] = saved[name];
      }
    } catch {}

    function showError(message) {
      error.textContent = message;
      error.hidden = !message;
    }

    function renderSettings() {
      const info = K.viewerInfo(draftViewer);
      select.value = info.id;
      node('wav-settings-executable-label').textContent = 'Chemin de l’exécutable ' + info.name;
      input.value = drafts[info.id];
      input.placeholder = 'C:\\Logiciels\\' + info.executableHint;
      node('wav-settings-help').textContent = 'Dans l’Explorateur Windows, faites Maj + clic droit sur ' + info.executableHint
        + (info.id === 'chirosurf' ? ' (ou sa version numérotée)' : '') + ', puis « Copier en tant que chemin d’accès ». Collez le chemin ici.';
      node('wav-settings-connection').textContent = localLauncher
        ? 'Lanceur Windows actif. Les WAV s’ouvriront dans ' + info.name + '.' : launcherHelp;
    }

    function openSettings(message = '') {
      draftViewer = viewer;
      drafts = { ...executables };
      renderSettings();
      node('settings-debug-mode').checked = preferences.debugMode;
      node('settings-common-pipistrelle').value = preferences.includeCommonPipistrelle ? 'yes' : 'no';
      showError(message);
      if (!dialog.open) dialog.showModal();
    }

    function saveSettings(event) {
      event.preventDefault();
      drafts[draftViewer] = input.value;
      const next = {};
      for (const id of viewers) {
        try { next[id] = K.normalizeExecutable(drafts[id], id); }
        catch (problem) {
          draftViewer = id;
          renderSettings();
          showError(problem.message);
          input.focus();
          return;
        }
      }
      const previousPreferences = getPreferences();
      viewer = K.viewerInfo(select.value).id;
      executables = next;
      preferences = {
        debugMode: node('settings-debug-mode').checked === true,
        includeCommonPipistrelle: node('settings-common-pipistrelle').value === 'yes'
      };
      let stored = false;
      try {
        if (storage) {
          storage.setItem(preferencesKey, JSON.stringify({ ...savedPreferences(), wavViewer: viewer,
            kaleidoscopeExecutable: next.kaleidoscope, chirosurfExecutable: next.chirosurf,
            ...preferences }));
          stored = true;
        }
      } catch {}
      dialog.close();
      onPreferencesChange(getPreferences(), previousPreferences);
      onStatus(stored ? 'Réglages enregistrés dans ce navigateur.' : 'Réglages conservés pour cette session. Le stockage du navigateur est indisponible.', !stored);
    }

    function getPreferences() {
      return { ...preferences };
    }

    function contactPath(imported, best) {
      if (!imported || !Array.isArray(imported.records) || !Number.isInteger(best?.recordIndex)
        || best.recordIndex < 0 || !Array.isArray(imported.records[best.recordIndex])) {
        throw new Error('Le contact à ouvrir est introuvable dans le fichier importé.');
      }
      const columns = Core.canonicalColumns(imported.headers);
      const record = imported.records[best.recordIndex];
      const field = name => columns[name] < 0 ? '' : record[columns[name]];
      return K.recordingPath({ file: field('file'), indir: field('indir'), rawFolder: field('folder') });
    }

    async function openContact(imported, best) {
      if (opening) return false;
      const info = K.viewerInfo(viewer);
      const executable = executables[viewer];
      if (!executable) {
        openSettings('Renseignez d’abord le chemin de l’exécutable ' + info.name + '.');
        input.focus();
        return false;
      }
      if (!localLauncher) {
        openSettings('L’ouverture directe nécessite le lanceur Windows Demarrer-Plecotus.cmd.');
        onStatus(launcherHelp, true);
        return false;
      }
      let file;
      try { file = contactPath(imported, best); }
      catch (problem) { onStatus(problem.message, true); return false; }
      opening = true;
      onStatus('Ouverture du WAV dans ' + info.name + '…', false);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await request('/api/open-recording', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Plecotus-Token': token },
          body: JSON.stringify({ viewer, executable, file }), signal: controller.signal });
        if (response.status === 404) throw new Error('Le lanceur doit être mis à jour. Fermez son ancienne version, relancez Demarrer-Plecotus.cmd depuis le dossier de la nouvelle version, puis rechargez la page.');
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'L’ouverture dans ' + info.name + ' a échoué.');
        onStatus('Ouverture demandée dans ' + info.name + '.', false);
        return true;
      } catch (problem) {
        const message = problem.name === 'AbortError' || problem instanceof TypeError || problem instanceof SyntaxError
          ? 'Lanceur local indisponible. Relancez Demarrer-Plecotus.cmd, puis rechargez la page.' : problem.message;
        onStatus(message, true);
        return false;
      } finally {
        clearTimeout(timeout);
        opening = false;
      }
    }

    node('open-settings').addEventListener('click', () => openSettings());
    node('wav-settings-form').addEventListener('submit', saveSettings);
    node('wav-settings-cancel').addEventListener('click', () => dialog.close());
    select.addEventListener('change', () => {
      drafts[draftViewer] = input.value;
      draftViewer = K.viewerInfo(select.value).id;
      renderSettings();
      showError('');
    });

    return Object.freeze({ openSettings, openContact, getPreferences });
  }

  return Object.freeze({ init });
});
