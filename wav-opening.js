(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./kaleidoscope.js'), require('./review-settings.js'), require('./review-settings-ui.js'), require('./settings-report-ui.js'));
  else root.PlecotusWavOpening = factory(root.BatReviewCore, root.BatKaleidoscope, root.PlecotusReviewSettings, root.PlecotusReviewSettingsUI, root.PlecotusSettingsReportUI);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, K, Settings, SettingsUI, ReportUI) {
  'use strict';

  const preferencesKey = 'plecotus.preferences.v1';
  const viewers = ['kaleidoscope', 'chirosurf'];
  const MAX_SEARCH_FOLDERS = 20;
  const reviewerName = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
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
    const searchInput = node('wav-settings-search-folders');
    const reviewerInput = node('settings-reviewer');
    let settingsReportUI = null;
    const reviewSettingsUI = options.reviewSettingsUI || SettingsUI.init({ document: doc, onChange: refreshSettingsReport });
    const token = doc.querySelector('meta[name="plecotus-local-token"]')?.content || '';
    const localLauncher = Boolean(token) && location?.origin === 'http://127.0.0.1:4174';
    let viewer = 'kaleidoscope';
    let executables = { kaleidoscope: '', chirosurf: '' };
    let searchFolders = [];
    let preferences = { reviewer: '', debugMode: false, includeCommonPipistrelle: true, reviewSettings: Settings.normalize() };
    let draftViewer, drafts, draftBaseline, opening = false;

    function savedPreferences() {
      try {
        const saved = JSON.parse(storage?.getItem(preferencesKey) || 'null');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
      } catch { return {}; }
    }

    try {
      const saved = savedPreferences();
      preferences.reviewer = reviewerName(saved.reviewer);
      for (const id of viewers) {
        if (typeof saved?.[id + 'Executable'] === 'string') {
          try { executables[id] = K.normalizeExecutable(saved[id + 'Executable'], id); } catch {}
        }
      }
      if (typeof saved?.wavViewer === 'string') try { viewer = K.viewerInfo(saved.wavViewer).id; } catch {}
      if (Array.isArray(saved?.wavSearchFolders)) {
        for (const folder of saved.wavSearchFolders) {
          try {
            const normalized = typeof folder === 'string' ? K.normalizeFolder(folder) : '';
            if (normalized && !searchFolders.some(known => known.toLowerCase() === normalized.toLowerCase())
              && searchFolders.length < MAX_SEARCH_FOLDERS) searchFolders.push(normalized);
          } catch {}
        }
      }
      for (const name of ['debugMode', 'includeCommonPipistrelle']) {
        if (typeof saved[name] === 'boolean') preferences[name] = saved[name];
      }
      try { preferences.reviewSettings = Settings.normalize(saved.reviewSettings); } catch {}
    } catch {}

    settingsReportUI = options.settingsReportUI || ReportUI.init({ document: doc, getConfiguration: getDraftConfiguration });

    function refreshSettingsReport() {
      settingsReportUI?.refresh();
    }

    function parseSearchFolders(text) {
      const folders = [];
      const lines = String(text || '').split(/\r?\n/);
      for (let index = 0; index < lines.length; index++) {
        if (!lines[index].trim()) continue;
        let normalized;
        try { normalized = K.normalizeFolder(lines[index]); }
        catch (problem) { throw new Error('Dossier de recherche, ligne ' + (index + 1) + ' : ' + problem.message); }
        if (!folders.some(known => known.toLowerCase() === normalized.toLowerCase())) folders.push(normalized);
      }
      if (folders.length > MAX_SEARCH_FOLDERS) {
        throw new Error('Indiquez au maximum ' + MAX_SEARCH_FOLDERS + ' dossiers de recherche.');
      }
      return folders;
    }

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
      searchInput.value = searchFolders.join('\n');
      reviewerInput.value = preferences.reviewer;
      node('settings-debug-mode').checked = preferences.debugMode;
      node('settings-common-pipistrelle').value = preferences.includeCommonPipistrelle ? 'yes' : 'no';
      reviewSettingsUI.set(preferences.reviewSettings);
      // Compare with the form's initial representation, including its displayed
      // decimal percentage, so simply opening the dialog is never a change.
      draftBaseline = readDraftConfiguration();
      refreshSettingsReport();
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
          refreshSettingsReport();
          showError(problem.message);
          input.focus();
          return;
        }
      }
      let nextSearchFolders;
      try { nextSearchFolders = parseSearchFolders(searchInput.value); }
      catch (problem) {
        refreshSettingsReport();
        showError(problem.message);
        searchInput.focus();
        return;
      }
      let reviewSettings;
      try { reviewSettings = reviewSettingsUI.get(); }
      catch (problem) {
        refreshSettingsReport();
        showError(problem.message);
        reviewSettingsUI.focusInvalid();
        return;
      }
      const previousPreferences = getPreferences();
      viewer = K.viewerInfo(select.value).id;
      executables = next;
      searchFolders = nextSearchFolders;
      preferences = {
        reviewer: reviewerName(reviewerInput.value),
        debugMode: node('settings-debug-mode').checked === true,
        includeCommonPipistrelle: node('settings-common-pipistrelle').value === 'yes',
        reviewSettings
      };
      let stored = false;
      try {
        if (storage) {
          storage.setItem(preferencesKey, JSON.stringify({ ...savedPreferences(), wavViewer: viewer,
            kaleidoscopeExecutable: next.kaleidoscope, chirosurfExecutable: next.chirosurf,
            wavSearchFolders: nextSearchFolders, ...preferences }));
          stored = true;
        }
      } catch {}
      draftBaseline = readDraftConfiguration();
      refreshSettingsReport();
      dialog.close();
      onPreferencesChange(getPreferences(), previousPreferences);
      onStatus(stored ? 'Réglages enregistrés dans ce navigateur.' : 'Réglages conservés pour cette session. Le stockage du navigateur est indisponible.', !stored);
    }

    function getPreferences() {
      return { ...preferences, reviewSettings: Settings.normalize(preferences.reviewSettings) };
    }

    function getConfiguration() {
      return { ...getPreferences(), wavViewer: viewer,
        kaleidoscopeExecutable: executables.kaleidoscope,
        chirosurfExecutable: executables.chirosurf,
        wavSearchFolders: searchFolders.slice() };
    }

    function readDraftConfiguration() {
      if (!drafts) return getConfiguration();
      const paths = { ...drafts, [draftViewer]: input.value };
      for (const id of viewers) {
        try { paths[id] = K.normalizeExecutable(paths[id], id); }
        catch { paths[id] = String(paths[id] || '').trim(); }
      }
      let folders;
      try { folders = parseSearchFolders(searchInput.value); }
      catch { folders = String(searchInput.value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean); }
      return {
        reviewer: reviewerName(reviewerInput.value),
        debugMode: node('settings-debug-mode').checked === true,
        includeCommonPipistrelle: node('settings-common-pipistrelle').value === 'yes',
        reviewSettings: reviewSettingsUI.get(),
        wavViewer: K.viewerInfo(select.value).id,
        kaleidoscopeExecutable: paths.kaleidoscope,
        chirosurfExecutable: paths.chirosurf,
        wavSearchFolders: folders
      };
    }

    function getDraftConfiguration() {
      const configuration = readDraftConfiguration();
      return { ...configuration, hasUnsavedChanges: JSON.stringify(configuration)
        !== JSON.stringify(draftBaseline || getConfiguration()) };
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
      const folders = searchFolders.slice();
      onStatus('Ouverture du WAV dans ' + info.name + '…' + (folders.length
        ? ' Si le chemin du fichier id n’est plus valable, recherche dans les dossiers indiqués (la première recherche peut prendre du temps).' : ''), false);
      const controller = new AbortController();
      // La recherche dans de grands dossiers peut durer : délai allongé seulement si des dossiers sont indiqués.
      const timeout = setTimeout(() => controller.abort(), folders.length ? 300000 : 10000);
      try {
        const response = await request('/api/open-recording', { method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Plecotus-Token': token },
          body: JSON.stringify({ viewer, executable, file, searchFolders: folders }), signal: controller.signal });
        if (response.status === 404) throw new Error('Le lanceur doit être mis à jour. Fermez son ancienne version, relancez Demarrer-Plecotus.cmd depuis le dossier de la nouvelle version, puis rechargez la page.');
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'L’ouverture dans ' + info.name + ' a échoué.');
        onStatus(result.relocated && typeof result.file === 'string'
          ? 'WAV retrouvé à un autre emplacement que celui du fichier id :\n' + result.file + '\nOuverture demandée dans ' + info.name + '.'
          : 'Ouverture demandée dans ' + info.name + '.', false);
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
    dialog.addEventListener('close', () => { drafts = null; draftBaseline = null; });
    for (const field of [input, searchInput, reviewerInput, node('settings-debug-mode'), node('settings-common-pipistrelle')]) {
      field.addEventListener('input', refreshSettingsReport);
      field.addEventListener('change', refreshSettingsReport);
    }
    select.addEventListener('change', () => {
      drafts[draftViewer] = input.value;
      draftViewer = K.viewerInfo(select.value).id;
      renderSettings();
      showError('');
      refreshSettingsReport();
    });

    return Object.freeze({ openSettings, openContact, getPreferences, getConfiguration });
  }

  return Object.freeze({ init });
});
