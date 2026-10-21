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
  const reviewSaveStatus = document.getElementById('review-save-status');
  const debugReviewActions = document.getElementById('debug-review-actions');
  const debugValidateAll = document.getElementById('debug-validate-all');
  const nextReviewStep = document.getElementById('review-next-button');
  const nextReviewStatus = document.getElementById('review-next-status');
  const wavOpeningStatus = document.getElementById('wav-opening-status');
  const wavOpening = PlecotusWavOpening.init({
    document,
    onStatus(message, isError) {
      wavOpeningStatus.textContent = message;
      wavOpeningStatus.dataset.error = String(Boolean(isError));
      wavOpeningStatus.hidden = !message;
    },
    onPreferencesChange(next, previous) {
      uiPreferences = next;
      updateDebugControls();
      if (currentManualPlan) manualScreens.refresh();
      finalScreens.refresh();
      if (next.includeCommonPipistrelle !== previous.includeCommonPipistrelle) {
        applyPipistrelleDefault();
        chartStatus.textContent = '';
        renderDistribution();
      }
    }
  });
  let uiPreferences = wavOpening.getPreferences();
  const numbers = new Intl.NumberFormat('fr-FR');
  const rankingNumbers = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 15 });
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let state = 'loading';
  let cancelAnimation = () => {};
  let currentFile = null;
  let currentImport = null;
  let currentDecisions = null;
  let currentBestContacts = [];
  let currentManualPlan = null;
  let importVersion = 0;
  let chartMode = 'pie';
  let chartData = null;
  let chartExporting = false;
  const hiddenChartKeys = new Set();
  const chartTitle = 'Répartition des contacts selon les AUTO-ID';
  const manualScreens = PlecotusManualReviewUI.init({
    document,
    getPlan: buildManualPlan,
    getPreferences: () => uiPreferences,
    renderContactCard: createManualContactCard,
    setMany: (indices, status) => currentDecisions.setMany(indices, status),
    setManualIds: entries => currentDecisions.setManualIds(entries),
    onDecisionsChanged: () => syncDecisions(false),
    onBackToBest: showSpecies,
    onFinalize() {
      try {
        if (finalScreens.show()) manualScreens.hide();
      } catch (error) {
        document.getElementById('manual-finalize-status').textContent = error.message || 'Impossible de préparer le récapitulatif.';
      }
    }
  });
  const finalScreens = PlecotusFinalSummaryUI.init({
    document,
    getData: () => PlecotusFinalSummaryData.build(currentImport, buildManualPlan()),
    getPreferences: () => uiPreferences,
    onBack: () => manualScreens.showPlan()
  });

  function buildManualPlan() {
    if (!currentImport || !currentDecisions) return null;
    currentManualPlan = PlecotusManualWorkflow.build(currentImport, currentDecisions);
    currentImport.processed = currentManualPlan.processed;
    return currentManualPlan;
  }

  function updateNextStep() {
    const pending = pendingBestContacts();
    nextReviewStep.setAttribute('aria-disabled', String(!currentImport || Boolean(pending.length)));
    nextReviewStatus.textContent = pending.length
      ? numbers.format(pending.length) + (pending.length === 1 ? ' meilleur contact reste à identifier.' : ' meilleurs contacts restent à identifier.')
        + ' Validez l’AUTO-ID ou invalidez-le puis renseignez l’identification réelle.'
      : 'Tous les meilleurs contacts ont été contrôlés. Vous pouvez continuer.';
  }

  function pendingBestContacts() {
    return currentBestContacts.filter(contact => {
      const decision = currentDecisions && currentDecisions.get(contact.recordIndex);
      return !decision || !decision.manualId;
    });
  }

  function syncDecisions(refreshManual = true) {
    if (!currentImport || !currentDecisions) return;
    currentImport.reviewDecisions = currentDecisions.snapshot();
    for (const row of document.querySelectorAll('tr[data-contact-index]')) {
      refreshContactDecision(row, Number(row.dataset.contactIndex));
    }
    for (const editor of document.querySelectorAll('[data-identification-index]')) refreshIdentification(editor);
    updateNextStep();
    if (currentManualPlan) {
      if (refreshManual) manualScreens.refresh();
      else buildManualPlan();
    }
  }

  function decideContact(recordIndex, status, card) {
    currentDecisions.set(recordIndex, status);
    syncDecisions();
    const sourceLine = currentDecisions.get(recordIndex).sourceRow;
    reviewSaveStatus.textContent = 'Contact de la ligne ' + numbers.format(sourceLine)
      + (status === 'validated' ? ' validé.' : ' invalidé : renseignez son identification réelle ci-dessous.') + decisionPersistenceMessage();
    reviewSaveStatus.hidden = false;
    if (status === 'invalidated') {
      const editor = card.querySelector('[data-identification-index="' + recordIndex + '"]');
      if (editor && !editor.hidden) editor.querySelector('select').focus({ preventScroll: true });
    }
  }

  function refreshIdentification(editor) {
    const decision = currentDecisions.get(Number(editor.dataset.identificationIndex));
    editor.hidden = !decision || decision.status !== 'invalidated' && Boolean(decision.manualId);
    const select = editor.querySelector('select');
    select.value = decision && decision.manualId || '';
    select.setAttribute('aria-invalid', String(Boolean(decision && !decision.manualId)));
    const message = editor.querySelector('p');
    message.textContent = decision && decision.manualId
      ? 'Identification enregistrée : ' + decision.manualId + '. Ce contrôle est terminé.'
      : 'Choisissez l’espèce réelle, ou une catégorie non identifiée si nécessaire. Ce contrôle reste à compléter.';
    editor.dataset.pending = String(Boolean(decision && !decision.manualId));
  }

  function appendIdentificationEditor(card, contact) {
    const editor = document.createElement('div');
    editor.className = 'contact-identification';
    editor.dataset.identificationIndex = String(contact.recordIndex);
    const label = document.createElement('label');
    label.textContent = 'Identification réelle · ligne ' + numbers.format(contact.lineNumber);
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Identification réelle du contact de la ligne ' + contact.lineNumber);
    select.required = true;
    const choices = [['', 'Choisir l’identification réelle…'],
      ...BatSpeciesNames.SPECIES.map(species => [species.code, species.code + ' · ' + species.frenchName]),
      ...BatSpeciesNames.IDENTIFICATION_LABELS.map(item => [item.label, item.label + ' · ' + item.description]),
      ['Noise', 'Noise · Bruit']];
    const existing = currentDecisions.get(contact.recordIndex);
    if (existing && existing.manualId && !choices.some(([value]) => value === existing.manualId)) {
      choices.push([existing.manualId, existing.manualId]);
    }
    for (const [value, text] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.disabled = !value;
      select.append(option);
    }
    select.addEventListener('change', () => {
      if (!select.value) return;
      currentDecisions.setManualId(contact.recordIndex, select.value);
      syncDecisions();
      if (editor.hidden) card.querySelector('button[data-decision="validated"]').focus({ preventScroll: true });
      reviewSaveStatus.textContent = 'Identification réelle enregistrée pour la ligne ' + numbers.format(contact.lineNumber)
        + '.' + decisionPersistenceMessage();
      reviewSaveStatus.hidden = false;
    });
    const message = document.createElement('p');
    message.setAttribute('role', 'status');
    label.append(select);
    editor.append(label, message);
    card.append(editor);
    refreshIdentification(editor);
  }

  function createManualContactCard(contact, groupLabel) {
    const card = document.createElement('article');
    card.className = 'species-group';
    const heading = document.createElement('h3');
    heading.className = 'manual-contact-heading';
    heading.textContent = 'Contact · ligne source ' + numbers.format(contact.lineNumber);
    card.append(heading);
    appendContactContent(card, contact, groupLabel);
    return card;
  }

  function applyPipistrelleDefault() {
    if (!chartData) return;
    const otherRows = new Set(BatSpeciesNames.chartRows(chartData.rows, false).rows);
    for (const row of chartData.rows) {
      if (otherRows.has(row)) continue;
      const key = BatActivityChart.rowKey(row);
      if (uiPreferences.includeCommonPipistrelle) hiddenChartKeys.delete(key);
      else hiddenChartKeys.add(key);
    }
  }

  function updateDebugControls() {
    debugReviewActions.hidden = !uiPreferences.debugMode;
    debugValidateAll.disabled = !currentBestContacts.length;
  }

  function refreshContactDecision(row, recordIndex) {
    const decision = currentDecisions.get(recordIndex);
    row.dataset.reviewStatus = decision ? decision.status : 'pending';
    for (const control of row.querySelectorAll('button[data-decision]')) {
      control.setAttribute('aria-pressed', String(Boolean(decision && decision.status === control.dataset.decision)));
    }
  }

  function decisionPersistenceMessage() {
    return currentDecisions.persistenceAvailable
      ? ' Décision enregistrée dans ce navigateur.'
      : ' Décision conservée pour cette session ; la mémorisation dans le navigateur est indisponible.';
  }

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
    applyPipistrelleDefault();
    chartStatus.textContent = '';
    renderDistribution();
    overview.hidden = false;
  }

  async function readFile(file, sheetName) {
    const version = ++importVersion;
    currentFile = file;
    currentImport = null;
    currentDecisions = null;
    currentBestContacts = [];
    currentManualPlan = null;
    finalScreens.hide();
    manualScreens.hide();
    updateDebugControls();
    chartData = null;
    overview.hidden = true;
    speciesOverview.hidden = true;
    sheetPicker.hidden = true;
    importError.hidden = true;
    wavOpeningStatus.hidden = true;
    reviewSaveStatus.hidden = true;
    fileStatus.hidden = false;
    fileStatus.textContent = 'Lecture du fichier : ' + file.name + '…';
    try {
      const result = await PlecotusFileImport.read(file, { sheetName });
      if (version !== importVersion) return;
      const decisions = await PlecotusContactDecisions.create(result);
      if (version !== importVersion) return;
      currentImport = result;
      currentDecisions = decisions;
      currentImport.reviewDecisions = decisions.snapshot();
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

  function appendContactContent(card, contact, label, isBest = false) {
    const filename = document.createElement('p');
    filename.className = 'best-contact-file';
    filename.append(document.createTextNode(isBest ? 'Meilleur contact : ' : 'Fichier WAV : '));
    if (contact.fileName) {
      const wavLink = document.createElement('button');
      wavLink.type = 'button';
      wavLink.className = 'wav-file-link';
      wavLink.textContent = contact.fileName + ' ↗';
      wavLink.title = 'Ouvrir ce WAV dans le logiciel configuré';
      const imported = currentImport;
      wavLink.addEventListener('click', () => wavOpening.openContact(imported, contact));
      filename.append(wavLink);
    } else filename.append(document.createTextNode('Fichier non renseigné'));
    card.append(filename);
    const wrapper = document.createElement('div');
    wrapper.className = 'best-contact-table-wrap';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Valeurs du contact : ' + label);
    const table = document.createElement('table');
    table.className = 'best-contact-table';
    const header = document.createElement('thead');
    const labels = document.createElement('tr');
    for (const label of ['Ligne source', 'MATCH RATIO', 'Qual', 'PULSES', 'Date', 'Heure', 'Décision']) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      labels.append(cell);
    }
    header.append(labels);
    const body = document.createElement('tbody');
    const row = document.createElement('tr');
    row.dataset.contactIndex = String(contact.recordIndex);
    const values = [numbers.format(contact.lineNumber),
      contact.ratio == null ? '—' : rankingNumbers.format(contact.ratio),
      contact.qual == null ? '—' : rankingNumbers.format(contact.qual),
      contact.pulses == null ? '—' : rankingNumbers.format(contact.pulses),
      contact.dateValue == null ? '—' : contact.date,
      contact.timeValue == null ? '—' : contact.time];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    const actions = document.createElement('td');
    actions.className = 'contact-actions';
    const actionGroup = document.createElement('div');
    actionGroup.setAttribute('role', 'group');
    actionGroup.setAttribute('aria-label', 'Décision pour le contact de la ligne ' + contact.lineNumber);
    for (const [status, label] of [['validated', 'Valider'], ['invalidated', 'Invalider']]) {
      const control = document.createElement('button');
      control.type = 'button';
      control.className = 'contact-decision-button';
      control.dataset.decision = status;
      control.textContent = label;
      control.addEventListener('click', () => decideContact(contact.recordIndex, status, card));
      actionGroup.append(control);
    }
    actions.append(actionGroup);
    row.append(actions);
    refreshContactDecision(row, contact.recordIndex);
    body.append(row);
    table.append(header, body);
    wrapper.append(table);
    card.append(wrapper);
    appendIdentificationEditor(card, contact);
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
    currentBestContacts = review.groups.flatMap(group => group.best ? [group.best] : []);
    updateDebugControls();
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
        appendContactContent(card, group.best, title.textContent, true);
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
    manualScreens.hide();
    speciesOverview.hidden = false;
    updateNextStep();
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
    status.textContent = 'La chauve-souris s’efface. Ouverture du tableau de bord…';
    cancelAnimation = afterAnimation(logo.hidden ? fallback : logo, 'plecotus-welcome-fade', showDashboard);
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
  nextReviewStep.addEventListener('click', () => {
    if (!currentImport || !currentDecisions || speciesOverview.hidden) return;
    const pending = pendingBestContacts();
    if (pending.length) {
      nextReviewStatus.textContent = 'Impossible de continuer : validez l’AUTO-ID ou renseignez l’identification réelle de chaque meilleur contact ('
        + numbers.format(pending.length) + (pending.length === 1 ? ' restant).' : ' restants).');
      return;
    }
    try {
      if (manualScreens.showPlan()) {
        speciesOverview.hidden = true;
        overview.hidden = true;
      }
    } catch (error) {
      nextReviewStatus.textContent = error.message || 'Impossible de préparer les contrôles manuels.';
    }
  });
  debugValidateAll.addEventListener('click', () => {
    if (!uiPreferences.debugMode || speciesOverview.hidden || !currentDecisions || !currentBestContacts.length) return;
    currentDecisions.setMany(currentBestContacts.map(best => best.recordIndex), 'validated');
    syncDecisions();
    reviewSaveStatus.textContent = numbers.format(currentBestContacts.length)
      + (currentBestContacts.length === 1 ? ' meilleur contact validé.' : ' meilleurs contacts validés.')
      + decisionPersistenceMessage();
    reviewSaveStatus.hidden = false;
  });
  updateDebugControls();
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
  });

  logo.decode().then(() => {
    welcome.style.setProperty('--welcome-artwork', 'url(' + JSON.stringify(logo.currentSrc || logo.src) + ')');
    welcome.classList.add('has-logo');
    illuminate();
  }, () => {
    logo.hidden = true;
    fallback.hidden = false;
    setState('illuminating');
    ready();
  });
})();
