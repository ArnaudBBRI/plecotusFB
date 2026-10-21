(() => {
  'use strict';

  const welcome = document.getElementById('welcome');
  const bat = document.getElementById('enter-dashboard');
  const logo = document.getElementById('bat-logo');
  const fallback = document.getElementById('logo-fallback');
  const status = document.getElementById('welcome-status');
  const dashboard = document.getElementById('dashboard');
  const loadFile = document.getElementById('load-file');
  const fileInput = document.getElementById('data-file');
  const fileStatus = document.getElementById('selected-file');
  const overview = document.getElementById('file-overview');
  const importError = document.getElementById('import-error');
  const sheetPicker = document.getElementById('sheet-picker');
  const contactSheet = document.getElementById('contact-sheet');
  const startReview = document.getElementById('start-review');
  const speciesOverview = document.getElementById('species-overview');
  const backToSummary = document.getElementById('back-to-summary');
  const chartHost = document.getElementById('distribution-chart');
  const chartStatus = document.getElementById('chart-export-status');
  const chartModes = [...document.querySelectorAll('[data-chart-mode]')];
  const chartExports = [...document.querySelectorAll('[data-chart-export]')];
  const numbers = new Intl.NumberFormat('fr-FR');
  const rankingNumbers = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 15 });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let state = 'loading';
  let cancelAnimation = () => {};
  let currentFile = null;
  let currentImport = null;
  let importVersion = 0;
  let chartMode = 'pie';
  let chartData = null;
  let chartExporting = false;
  const hiddenChartKeys = new Set();
  const chartTitle = 'Répartition des contacts selon les AUTO-ID';

  function renderDistribution() {
    if (!chartData) return;
    const selection = BatActivityChart.select(chartData.rows, hiddenChartKeys);
    chartHost.innerHTML = chartData.total
      ? BatActivityChart.render(chartData.rows, chartMode, {
        interactive: true, hiddenKeys: hiddenChartKeys,
        hasAutoId: currentImport.summary.hasAutoIdColumn, title: chartTitle
      })
      : '<p class="activity-chart-empty">Aucun contact hors bruit à représenter.</p>';
    const source = currentImport.summary.hasAutoIdColumn
      ? 'AUTO-ID, hors Noise'
      : 'Colonne AUTO-ID absente · contacts sans identification automatique';
    document.getElementById('distribution-caption').textContent = source + ' · ' + numbers.format(selection.total) + (selection.total === 1 ? ' contact représenté' : ' contacts représentés')
      + (selection.hiddenCount ? ' · ' + numbers.format(selection.hiddenCount) + ' catégorie' + (selection.hiddenCount > 1 ? 's masquées' : ' masquée')
        + ' (' + numbers.format(selection.hiddenContacts) + (selection.hiddenContacts === 1 ? ' contact)' : ' contacts)') : '');
    for (const scrollable of chartHost.querySelectorAll('.activity-legend, .activity-bar-list')) scrollable.tabIndex = 0;
    for (const button of chartModes) button.setAttribute('aria-pressed', String(button.dataset.chartMode === chartMode));
    for (const button of chartExports) button.disabled = !selection.total || chartExporting;
  }

  async function exportDistribution(format) {
    if (!currentImport || !chartData || chartExporting) return;
    const selection = BatActivityChart.select(chartData.rows, hiddenChartKeys);
    if (!selection.total) return;
    const imported = currentImport;
    const data = chartData;
    const mode = chartMode;
    const version = importVersion;
    chartExporting = true;
    renderDistribution();
    chartStatus.textContent = 'Préparation de l’image…';
    try {
      const result = await BatActivityExport.exportBlob(selection.rows, mode, format, {
        title: chartTitle, source: 'auto-id',
        noiseContacts: data.noiseCount, totalContacts: imported.summary.totalContacts,
        hasAutoId: imported.summary.hasAutoIdColumn,
        hiddenContacts: selection.hiddenContacts, hiddenCategories: selection.hiddenCount
      });
      const stem = imported.fileName.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'contacts';
      const link = document.createElement('a');
      const url = URL.createObjectURL(result.blob);
      link.href = url;
      link.download = stem + '_autoid_' + (mode === 'bar' ? 'barres' : 'camembert') + (selection.hiddenCount ? '_filtre' : '') + '.' + result.extension;
      document.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
      if (version === importVersion) chartStatus.textContent = 'Image ' + result.extension.toUpperCase() + ' exportée.';
    } catch (error) {
      if (version === importVersion) chartStatus.textContent = error.message || 'Impossible d’exporter le graphique.';
    } finally {
      chartExporting = false;
      renderDistribution();
    }
  }

  function renderImport(result) {
    const summary = result.summary;
    const sheetName = document.getElementById('sheet-name');
    sheetName.textContent = result.sheetName ? 'Feuille : ' + result.sheetName : '';
    sheetName.hidden = !result.sheetName;
    const kind = document.getElementById('file-kind');
    kind.textContent = summary.vanilla ? 'Fichier vierge' : 'Vérification déjà commencée';
    kind.classList.toggle('is-vanilla', summary.vanilla);
    document.getElementById('manual-summary').textContent = summary.vanilla
      ? 'Aucune identification manuelle n’a encore été renseignée.'
      : numbers.format(summary.manualIdCount) + ' contact' + (summary.manualIdCount > 1 ? 's comportent' : ' comporte') + ' déjà une identification manuelle.';
    document.getElementById('total-contacts').textContent = numbers.format(summary.totalContacts);
    document.getElementById('contacts-without-noise').textContent = summary.contactsExcludingNoise == null ? '—' : numbers.format(summary.contactsExcludingNoise);
    document.getElementById('manual-identifications').textContent = numbers.format(summary.manualIdCount);
    document.getElementById('noise-detail').textContent = summary.hasAutoIdColumn
      ? 'Hors lignes classées « Noise » dans AUTO-ID'
      : 'Non disponible : colonne AUTO-ID absente';
    const warningList = document.getElementById('import-warning-list');
    warningList.replaceChildren();
    for (const warning of [...new Set(result.warnings)]) {
      const item = document.createElement('li');
      item.textContent = warning;
      warningList.append(item);
    }
    document.getElementById('import-warnings').hidden = !warningList.childElementCount;
    startReview.hidden = !summary.vanilla;
    startReview.disabled = summary.totalContacts === 0;
    startReview.title = summary.totalContacts === 0 ? 'Le fichier ne contient aucun contact.' : '';
    chartData = PlecotusImportChart.build(result);
    hiddenChartKeys.clear();
    chartStatus.textContent = '';
    renderDistribution();
    overview.hidden = false;
  }

  async function readFile(file, sheetName) {
    const version = ++importVersion;
    currentFile = file;
    currentImport = null;
    chartData = null;
    overview.hidden = true;
    speciesOverview.hidden = true;
    sheetPicker.hidden = true;
    importError.hidden = true;
    fileStatus.hidden = false;
    fileStatus.textContent = 'Lecture du fichier : ' + file.name + '…';
    try {
      const result = await PlecotusFileImport.read(file, { sheetName });
      if (version !== importVersion) return;
      currentImport = result;
      renderImport(result);
      fileStatus.textContent = 'Fichier chargé : ' + result.fileName;
    } catch (error) {
      if (version !== importVersion) return;
      if (error.code === 'SHEET_SELECTION_REQUIRED') {
        contactSheet.replaceChildren();
        const prompt = document.createElement('option');
        prompt.value = '';
        prompt.textContent = 'Sélectionner une feuille';
        prompt.disabled = true;
        prompt.selected = true;
        contactSheet.append(prompt);
        for (const name of error.sheets) {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          contactSheet.append(option);
        }
        sheetPicker.hidden = false;
        fileStatus.textContent = 'Choisissez une feuille de contacts : ' + file.name;
      } else {
        importError.textContent = error.message || 'Impossible de lire ce fichier.';
        importError.hidden = false;
        fileStatus.textContent = 'Le fichier n’a pas pu être chargé : ' + file.name;
      }
    }
  }

  function showSpecies() {
    if (!currentImport || !currentImport.summary.vanilla || !currentImport.summary.totalContacts) return;
    let review;
    try { review = PlecotusBestContacts.build(currentImport); }
    catch (error) {
      importError.textContent = error.message || 'Impossible de sélectionner les meilleurs contacts.';
      importError.hidden = false;
      return;
    }
    const list = document.getElementById('species-groups');
    list.replaceChildren();
    document.getElementById('species-review-summary').textContent = numbers.format(review.groups.length)
      + (review.groups.length === 1 ? ' groupe AUTO-ID' : ' groupes AUTO-ID')
      + ' · ' + numbers.format(review.excludedNoiseCount) + (review.excludedNoiseCount === 1 ? ' contact Noise exclu' : ' contacts Noise exclus');
    const missingColumns = document.getElementById('best-missing-columns');
    missingColumns.textContent = review.missingColumns.length
      ? 'Colonnes absentes : ' + review.missingColumns.join(', ') + '. Les autres critères conservent le même ordre de priorité.' : '';
    missingColumns.hidden = !review.missingColumns.length;

    for (const group of review.groups) {
      const card = document.createElement('article');
      card.className = 'species-group';
      const heading = document.createElement('div');
      heading.className = 'species-group-heading';
      const title = document.createElement('h3');
      const taxon = BatSpeciesNames.resolve(group.label);
      title.textContent = group.kind === 'unclassified' ? 'Sans identification automatique'
        : group.kind === 'noid' ? 'Non identifié (NoID)'
          : group.label + (taxon.known && taxon.category !== 'noise' && taxon.frenchName ? ' · ' + taxon.frenchName : '');
      const count = document.createElement('p');
      count.className = 'species-group-count';
      count.textContent = numbers.format(group.count) + (group.count === 1 ? ' contact' : ' contacts');
      heading.append(title, count);
      card.append(heading);

      if (group.best) {
        const best = group.best;
        const filename = document.createElement('p');
        filename.className = 'best-contact-file';
        filename.textContent = 'Meilleur contact : ' + (best.fileName || 'Fichier non renseigné');
        card.append(filename);
        const wrapper = document.createElement('div');
        wrapper.className = 'best-contact-table-wrap';
        wrapper.tabIndex = 0;
        wrapper.setAttribute('role', 'region');
        wrapper.setAttribute('aria-label', 'Valeurs du meilleur contact : ' + title.textContent);
        const table = document.createElement('table');
        table.className = 'best-contact-table';
        const header = document.createElement('thead');
        const labels = document.createElement('tr');
        for (const label of ['Ligne source', 'MATCH RATIO', 'Qual', 'PULSES', 'Date', 'Heure']) {
          const cell = document.createElement('th');
          cell.scope = 'col';
          cell.textContent = label;
          labels.append(cell);
        }
        header.append(labels);
        const body = document.createElement('tbody');
        const row = document.createElement('tr');
        const values = [numbers.format(best.lineNumber),
          best.ratio == null ? '—' : rankingNumbers.format(best.ratio),
          best.qual == null ? '—' : rankingNumbers.format(best.qual),
          best.pulses == null ? '—' : rankingNumbers.format(best.pulses),
          best.dateValue == null ? '—' : best.date,
          best.timeValue == null ? '—' : best.time];
        for (const value of values) {
          const cell = document.createElement('td');
          cell.textContent = value;
          row.append(cell);
        }
        body.append(row);
        table.append(header, body);
        wrapper.append(table);
        card.append(wrapper);
      } else {
        const empty = document.createElement('p');
        empty.className = 'best-contact-empty';
        empty.textContent = 'Aucun contact ne dispose d’une valeur exploitable dans MATCHING, MATCH RATIO ou Qual. Aucun meilleur contact ne peut être retenu.';
        card.append(empty);
      }
      list.append(card);
    }
    if (!review.groups.length) {
      const empty = document.createElement('p');
      empty.className = 'best-contact-empty';
      empty.textContent = 'Aucun groupe hors Noise à vérifier dans ce fichier.';
      list.append(empty);
    }
    overview.hidden = true;
    speciesOverview.hidden = false;
    document.getElementById('species-heading').focus();
  }

  function setState(next) {
    state = next;
    welcome.dataset.state = next;
  }

  function afterAnimation(element, name, finish) {
    const style = getComputedStyle(element);
    const milliseconds = value => parseFloat(value) * (value.endsWith('ms') ? 1 : 1000);
    const duration = milliseconds(style.animationDuration) + milliseconds(style.animationDelay);
    const complete = event => {
      if (event && (event.target !== element || event.animationName !== name)) return;
      cleanup();
      finish();
    };
    // Keep navigation usable if an animation event is lost or animations are disabled.
    const timer = setTimeout(complete, duration + 100);
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener('animationend', complete);
    };
    element.addEventListener('animationend', complete);
    return cleanup;
  }

  function ready() {
    if (state !== 'illuminating') return;
    cancelAnimation();
    logo.classList.remove('is-illuminating');
    setState('ready');
    bat.disabled = false;
    status.textContent = 'Plecotus est prêt. Sélectionnez la chauve-souris pour ouvrir le tableau de bord.';
  }

  function showDashboard() {
    if (state !== 'leaving') return;
    cancelAnimation();
    setState('dashboard');
    welcome.hidden = true;
    dashboard.hidden = false;
    document.title = 'Plecotus · Tableau de bord';
    document.querySelector('meta[name="theme-color"]').content = '#ffffff';
    dashboard.focus({ preventScroll: true });
  }

  function enter() {
    if (state !== 'ready') return;
    setState('leaving');
    bat.disabled = true;
    status.textContent = 'Ouverture du tableau de bord.';
    if (reducedMotion.matches) showDashboard();
    else cancelAnimation = afterAnimation(bat, 'plecotus-depart', showDashboard);
  }

  function illuminate() {
    setState('illuminating');
    if (reducedMotion.matches) ready();
    else {
      logo.classList.add('is-illuminating');
      cancelAnimation = afterAnimation(logo, 'plecotus-light-on', ready);
    }
  }

  bat.addEventListener('click', enter);
  loadFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    readFile(file);
  });
  contactSheet.addEventListener('change', () => {
    if (currentFile && contactSheet.value) readFile(currentFile, contactSheet.value);
  });
  startReview.addEventListener('click', showSpecies);
  for (const button of chartModes) button.addEventListener('click', () => {
    chartMode = button.dataset.chartMode;
    chartStatus.textContent = '';
    renderDistribution();
  });
  for (const button of chartExports) button.addEventListener('click', () => exportDistribution(button.dataset.chartExport));
  chartHost.addEventListener('click', event => {
    const button = event.target.closest('button[data-chart-key]');
    if (!button || !chartHost.contains(button)) return;
    const key = button.dataset.chartKey;
    const list = button.closest('.activity-legend, .activity-bar-list');
    const scrollTop = list ? list.scrollTop : 0;
    if (hiddenChartKeys.has(key)) hiddenChartKeys.delete(key);
    else hiddenChartKeys.add(key);
    chartStatus.textContent = '';
    renderDistribution();
    const restored = [...chartHost.querySelectorAll('button[data-chart-key]')].find(item => item.dataset.chartKey === key);
    if (restored) {
      restored.focus({ preventScroll: true });
      const restoredList = restored.closest('.activity-legend, .activity-bar-list');
      if (restoredList) restoredList.scrollTop = scrollTop;
    }
  });
  backToSummary.addEventListener('click', () => {
    speciesOverview.hidden = true;
    overview.hidden = false;
    startReview.focus();
  });
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    if (state === 'illuminating') ready();
    else if (state === 'leaving') showDashboard();
  });

  logo.decode().then(illuminate, () => {
    logo.hidden = true;
    fallback.hidden = false;
    setState('illuminating');
    ready();
  });
})();
