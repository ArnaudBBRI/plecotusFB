(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./species.js'));
  else root.PlecotusManualReviewUI = factory(root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Names) {
  'use strict';

  const numbers = new Intl.NumberFormat('fr-FR');
  const count = (value, singular, plural) => numbers.format(value) + ' ' + (value === 1 ? singular : plural);

  function groupLabel(group) {
    if (group.kind === 'unclassified') return 'Sans identification automatique';
    if (group.kind === 'noid') return 'Non identifié (NoID)';
    const name = Names.resolve(group.label);
    return group.label + (name.known && name.frenchName ? ' · ' + name.frenchName : '');
  }

  function init(options) {
    const doc = options.document;
    const node = id => doc.getElementById(id);
    const overview = node('manual-plan-overview');
    const detail = node('manual-species-detail');
    const rows = node('manual-species-rows');
    const debug = node('manual-plan-debug');
    const debugButton = node('manual-plan-debug-all');
    const list = node('manual-contact-list');
    let screen = 'hidden';
    let selectedKey = null;
    let detailSignature = null;

    function summary(group) {
      const total = count(group.total, 'contact', 'contacts');
      if (!group.requiredIndices.length) {
        return total + (group.mode === 'auto'
          ? ' · Validation automatique : aucun contrôle supplémentaire requis.'
          : ' · Aucun contrôle supplémentaire requis ; le meilleur contact a déjà été contrôlé.');
      }
      return total + ' · ' + numbers.format(group.completed) + ' / '
        + count(group.requiredIndices.length, 'contrôle supplémentaire effectué', 'contrôles supplémentaires effectués')
        + ' · ' + count(group.remaining, 'restant', 'restants');
    }

    function renderRows(plan) {
      // Returning from a contact keeps its decisions in the model; no DOM row is
      // used as the source of truth for counts or progress.
      rows.replaceChildren();
      for (const group of plan.groups) {
        const row = doc.createElement('tr');
        row.dataset.speciesKey = group.key;
        const name = doc.createElement('td');
        name.className = 'manual-species-name';
        const label = doc.createElement('span');
        label.className = 'manual-species-code';
        label.textContent = groupLabel(group);
        label.title = label.textContent;
        const total = doc.createElement('small');
        total.className = 'manual-species-count';
        total.textContent = count(group.total, 'contact', 'contacts');
        name.append(label, total);

        const progressCell = doc.createElement('td');
        progressCell.className = 'manual-progress-cell';
        const progressLine = doc.createElement('div');
        progressLine.className = 'manual-progress';
        const bar = doc.createElement('progress');
        bar.className = 'manual-progress-track';
        bar.max = 1;
        bar.value = group.requiredIndices.length ? Math.min(1, Math.max(0, group.progress)) : 1;
        bar.setAttribute('aria-label', 'Avancement des contrôles supplémentaires pour ' + label.textContent);
        bar.setAttribute('aria-valuetext', count(group.remaining, 'contrôle restant', 'contrôles restants'));
        const remaining = doc.createElement('span');
        remaining.className = 'manual-remaining';
        remaining.textContent = numbers.format(group.remaining) + ' à vérifier';
        const open = doc.createElement('button');
        open.type = 'button';
        open.className = 'manual-species-open';
        open.textContent = '→';
        open.setAttribute('aria-label', 'Vérifier ' + label.textContent);
        open.title = 'Ouvrir les contrôles de cette espèce';
        open.addEventListener('click', () => showDetail(group.key));
        progressLine.append(bar, remaining, open);
        progressCell.append(progressLine);
        row.append(name, progressCell);
        rows.append(row);
      }
    }

    function renderOverview(plan) {
      renderRows(plan);
      const automatic = plan.groups.filter(group => group.mode === 'auto').length;
      node('manual-plan-summary').textContent = plan.groups.length
        ? count(plan.groups.length, 'espèce ou groupe', 'espèces ou groupes') + ' · '
          + count(plan.remaining, 'contrôle supplémentaire à effectuer', 'contrôles supplémentaires à effectuer')
          + (automatic ? ' · ' + count(automatic, 'groupe validé automatiquement', 'groupes validés automatiquement') : '')
        : 'Aucune espèce hors Noise à vérifier.';
      debug.hidden = !options.getPreferences().debugMode;
      debugButton.disabled = !plan.requiredIndices.length;
    }

    function renderDetail(plan) {
      const group = plan.groups.find(item => item.key === selectedKey);
      if (!group) return false;
      const label = groupLabel(group);
      node('manual-species-heading').textContent = label;
      node('manual-species-summary').textContent = summary(group);
      node('manual-species-method').textContent = group.reasons.join(' ');
      const signature = JSON.stringify([group.key, group.requiredIndices]);
      if (signature !== detailSignature) {
        list.replaceChildren();
        if (!group.requiredIndices.length) {
          const empty = doc.createElement('p');
          empty.className = 'manual-empty-message';
          empty.textContent = group.mode === 'auto'
            ? 'Tous les contacts de cette espèce sont validés automatiquement selon la méthode. Aucun contrôle supplémentaire n’est nécessaire.'
            : 'Le quota de vérification est atteint avec le meilleur contact déjà contrôlé.';
          list.append(empty);
        } else {
          const contacts = new Map(group.contacts.map(contact => [contact.recordIndex, contact]));
          for (const index of group.requiredIndices) {
            const contact = contacts.get(index);
            if (!contact) throw new Error('Un contact sélectionné est introuvable dans le plan de vérification.');
            list.append(options.renderContactCard(contact, label));
          }
        }
        detailSignature = signature;
      }
      return true;
    }

    function refresh() {
      const plan = options.getPlan();
      if (!plan) return;
      renderOverview(plan);
      if (screen === 'detail' && !renderDetail(plan)) showPlan();
    }

    function showPlan() {
      const plan = options.getPlan();
      if (!plan || !plan.ready) return false;
      screen = 'plan';
      selectedKey = null;
      detailSignature = null;
      renderOverview(plan);
      detail.hidden = true;
      overview.hidden = false;
      node('manual-plan-heading').focus();
      return true;
    }

    function showDetail(key) {
      const plan = options.getPlan();
      if (!plan || !plan.ready) return;
      selectedKey = key;
      detailSignature = null;
      if (!renderDetail(plan)) return;
      screen = 'detail';
      overview.hidden = true;
      detail.hidden = false;
      node('manual-species-heading').focus();
    }

    function hide() {
      screen = 'hidden';
      selectedKey = null;
      detailSignature = null;
      overview.hidden = true;
      detail.hidden = true;
      // Contact identities belong to the current import. Keeping hidden cards
      // after navigation could let a later import refresh stale row indices.
      list.replaceChildren();
      rows.replaceChildren();
    }

    node('manual-plan-back').addEventListener('click', () => {
      hide();
      options.onBackToBest();
    });
    node('manual-species-back').addEventListener('click', showPlan);
    debugButton.addEventListener('click', () => {
      if (screen !== 'plan' || !options.getPreferences().debugMode) return;
      const plan = options.getPlan();
      if (!plan || !plan.ready || !plan.requiredIndices.length) return;
      options.setMany(plan.requiredIndices, 'validated');
      options.onDecisionsChanged();
      refresh();
    });

    return Object.freeze({ showPlan, refresh, hide });
  }

  return Object.freeze({ init });
});
