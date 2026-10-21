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
  const numbers = new Intl.NumberFormat('fr-FR');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let state = 'loading';
  let cancelAnimation = () => {};
  let currentFile = null;
  let currentImport = null;
  let importVersion = 0;

  function renderImport(result) {
    const summary = result.summary;
    document.getElementById('file-heading').textContent = result.fileName;
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
    overview.hidden = false;
  }

  async function readFile(file, sheetName) {
    const version = ++importVersion;
    currentFile = file;
    currentImport = null;
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
    const groups = new Map();
    for (const record of currentImport.records) {
      const auto = BatReviewCore.normalizeAutoId(record[currentImport.columns.autoId]);
      const label = auto.kind === 'noise' ? 'Bruit (Noise)' : auto.kind === 'noid' ? 'Non identifié (NoID)' : auto.kind === 'unclassified' ? 'Sans identification automatique' : auto.autoId;
      if (!groups.has(auto.key)) groups.set(auto.key, { label, count: 0 });
      groups.get(auto.key).count++;
    }
    const body = document.getElementById('species-groups');
    body.replaceChildren();
    for (const group of [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'))) {
      const row = document.createElement('tr');
      const name = document.createElement('td');
      const count = document.createElement('td');
      name.textContent = group.label;
      count.textContent = numbers.format(group.count);
      row.append(name, count);
      body.append(row);
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
