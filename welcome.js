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
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let state = 'loading';
  let cancelAnimation = () => {};

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
    fileStatus.textContent = 'Fichier sélectionné : ' + file.name;
    fileStatus.hidden = false;
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
