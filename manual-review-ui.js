(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./species.js'));
  else root.PlecotusManualReviewUI = factory(root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Names) {
  'use strict';

  const numbers = new Intl.NumberFormat('fr-FR');
  const percentages = new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 1 });
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
    const debugRandomButton = node('manual-plan-debug-random');
    const debugResult = node('manual-plan-debug-result');
    const finalizeButton = node('manual-finalize-button');
    const finalizeStatus = node('manual-finalize-status');
    const random = options.random || Math.random;
    const list = node('manual-contact-list');
    let screen = 'hidden';
    let selectedKey = null;
    let detailSignature = null;

    function canFinalize(plan) {
      return Boolean(plan && plan.ready && plan.assignmentReady === true && plan.remaining === 0
        && !(plan.pendingIdentificationIndices || []).length && !(plan.unresolvedIndices || []).length);
    }

    function updateFinalization(plan) {
      finalizeButton.disabled = !canFinalize(plan);
      if (canFinalize(plan)) {
        finalizeStatus.textContent = 'Tous les contrôles sont terminés. Vous pouvez finaliser et consulter le récapitulatif.';
      } else if (!plan || !plan.ready) {
        finalizeStatus.textContent = 'Terminez l’identification de chaque meilleur contact avant de finaliser.';
      } else if ((plan.unresolvedIndices || []).length) {
        finalizeStatus.textContent = count(plan.unresolvedIndices.length, 'identification incertaine/non résolue reste à reprendre', 'identifications incertaines/non résolues restent à reprendre')
          + ' dans « Identifications à reprendre » avant de finaliser. Une décision « À revoir » ne participe pas au prorata.';
      } else if (plan.remaining > 0) {
        finalizeStatus.textContent = count(plan.remaining, 'contrôle supplémentaire reste à terminer', 'contrôles supplémentaires restent à terminer')
          + '. Après une invalidation, renseignez l’identification réelle.';
      } else if ((plan.pendingIdentificationIndices || []).length) {
        finalizeStatus.textContent = count(plan.pendingIdentificationIndices.length, 'identification réelle reste à renseigner', 'identifications réelles restent à renseigner')
          + ' avant de finaliser.';
      } else {
        finalizeStatus.textContent = 'Les identifications doivent être entièrement calculées avant de finaliser.';
      }
    }

    function assignmentStatus(group, compact = false) {
      if (typeof group.assignmentReady !== 'boolean') return '';
      if (!group.assignmentReady) {
        if ((group.unresolvedIndices || []).length) {
          return count(group.unresolvedIndices.length, 'identification à reprendre', 'identifications à reprendre')
            + (compact ? '' : ' ; aucun prorata n’est appliqué avant leur résolution.');
        }
        const pending = (group.pendingIdentificationIndices || []).length;
        return count(pending, 'identification réelle à renseigner', 'identifications réelles à renseigner')
          + (compact ? '' : (group.mode === 'sample' ? ' avant de calculer le prorata.' : '.'));
      }
      if (group.mode === 'auto') {
        return compact ? 'SEMIMANUAL ID = AUTO-ID' : 'SEMIMANUAL ID reprend l’AUTO-ID de chacun des '
          + count(group.total, 'contact', 'contacts') + '.';
      }
      if (group.mode === 'individual') {
        return compact ? 'Identifications manuelles reprises' : 'Les identifications manuelles sont reprises dans SEMIMANUAL ID.';
      }
      if (compact) return 'Prorata appliqué';
      const distribution = (group.distribution || []).map(item => percentages.format(item.share) + ' ' + item.label).join(' · ');
      return (distribution ? 'Répartition manuelle : ' + distribution + '. ' : '')
        + count((group.proportionalAssignments || []).length, 'contact attribué au prorata', 'contacts attribués au prorata')
        + ' ; les identifications manuelles sont conservées.';
    }

    function summary(group) {
      const total = count(group.total, 'contact', 'contacts');
      const assignment = assignmentStatus(group, true);
      const suffix = assignment ? ' · ' + assignment : '';
      if (!group.requiredIndices.length) {
        return total + (group.mode === 'auto'
          ? ' · Validation automatique : aucun contrôle supplémentaire requis.'
          : ' · Aucun contrôle supplémentaire requis ; le meilleur contact a déjà été contrôlé.') + suffix;
      }
      return total + ' · ' + numbers.format(group.completed) + ' / '
        + count(group.requiredIndices.length, 'contrôle supplémentaire effectué', 'contrôles supplémentaires effectués')
        + ' · ' + count(group.remaining, 'restant', 'restants') + suffix;
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
        const assignment = assignmentStatus(group, true);
        if (assignment) {
          const assignmentNote = doc.createElement('small');
          assignmentNote.className = 'manual-assignment-status';
          assignmentNote.textContent = assignment;
          name.append(assignmentNote);
        }

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
      if (typeof plan.assignmentReady === 'boolean') {
        const assigned = (plan.proportionalAssignments || []).length;
        const pending = (plan.pendingIdentificationIndices || []).length;
        const unresolved = (plan.unresolvedIndices || []).length;
        if (assigned) node('manual-plan-summary').textContent += ' · '
          + count(assigned, 'contact attribué au prorata', 'contacts attribués au prorata');
        if (unresolved) node('manual-plan-summary').textContent += ' · '
          + count(unresolved, 'identification à reprendre', 'identifications à reprendre');
        if (pending > unresolved) node('manual-plan-summary').textContent += ' · '
          + count(pending - unresolved, 'identification réelle à renseigner', 'identifications réelles à renseigner');
      }
      debug.hidden = !options.getPreferences().debugMode;
      debugButton.disabled = !plan.requiredIndices.length;
      debugRandomButton.disabled = !plan.requiredIndices.length;
      updateFinalization(plan);
    }

    function renderDetail(plan) {
      const group = plan.groups.find(item => item.key === selectedKey);
      if (!group) return false;
      const label = groupLabel(group);
      node('manual-species-heading').textContent = label;
      node('manual-species-summary').textContent = summary(group);
      node('manual-species-method').textContent = [...group.reasons, assignmentStatus(group)].filter(Boolean).join(' ');
      const signature = JSON.stringify([group.key, group.requiredIndices,
        group.requiredIndices.length ? null : [group.mode, group.assignmentReady]]);
      if (signature !== detailSignature) {
        list.replaceChildren();
        if (!group.requiredIndices.length) {
          const empty = doc.createElement('p');
          empty.className = 'manual-empty-message';
          empty.textContent = group.mode === 'auto'
            ? 'Tous les contacts de cette espèce sont validés automatiquement selon la méthode. Aucun contrôle supplémentaire n’est nécessaire.'
            : group.assignmentReady === false
              ? 'Renseignez l’identification réelle du meilleur contact avant de calculer les attributions.'
              : 'Le quota de vérification est atteint avec le meilleur contact déjà contrôlé.'
                + (group.assignmentReady === true ? ' Les autres contacts sont attribués au prorata de son identification manuelle.' : '');
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

    function refresh({ resetDetail = false } = {}) {
      if (resetDetail) detailSignature = null;
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
      clearDebugResult();
      finalizeButton.disabled = true;
      finalizeStatus.textContent = '';
    }

    function clearDebugResult() {
      debugResult.textContent = '';
      debugResult.hidden = true;
    }

    node('manual-plan-back').addEventListener('click', () => {
      hide();
      options.onBackToBest();
    });
    node('manual-species-back').addEventListener('click', showPlan);
    finalizeButton.addEventListener('click', () => {
      if (screen !== 'plan') return;
      // Check the fresh plan as decisions may have changed since the button
      // became available. A filled progress bar alone is not enough.
      const plan = options.getPlan();
      updateFinalization(plan);
      if (!canFinalize(plan)) return;
      if (typeof options.onFinalize === 'function') options.onFinalize(plan);
    });
    debugButton.addEventListener('click', () => {
      if (screen !== 'plan' || !options.getPreferences().debugMode) return;
      const plan = options.getPlan();
      if (!plan || !plan.ready || !plan.requiredIndices.length) return;
      clearDebugResult();
      options.setMany(plan.requiredIndices, 'validated');
      options.onDecisionsChanged();
      refresh();
    });
    debugRandomButton.addEventListener('click', () => {
      if (screen !== 'plan' || !options.getPreferences().debugMode) return;
      const plan = options.getPlan();
      if (!plan || !plan.ready || !plan.requiredIndices.length) return;
      const indices = [...new Set(plan.requiredIndices)];
      const sourceLabels = new Map(plan.groups.flatMap(group => group.requiredIndices.map(index => [index, group.label])));
      const canConfirm = index => {
        const label = String(sourceLabels.get(index) || '').replace(/\s+/g, ' ').trim();
        return Boolean(label && !/[\u0000-\u001f\u007f-\u009f]/.test(label));
      };
      const validated = [], invalidated = [];
      for (const index of indices) {
        const draw = random();
        (draw < 0.5 && canConfirm(index) ? validated : invalidated).push(index);
      }
      // With multiple contacts this debug action must exercise both outcomes,
      // when there is a nonempty AUTO-ID that can actually be confirmed.
      if (indices.length > 1 && !invalidated.length) invalidated.push(validated.pop());
      else if (indices.length > 1 && !validated.length) {
        const confirmable = invalidated.slice().reverse().find(canConfirm);
        if (confirmable !== undefined) validated.push(...invalidated.splice(invalidated.indexOf(confirmable), 1));
      }
      const identifications = invalidated.map(recordIndex => {
        const original = Names.resolve(sourceLabels.get(recordIndex));
        const candidates = Names.SPECIES.filter(species => species.key !== original.key);
        const position = Math.min(candidates.length - 1, Math.max(0, Math.floor(random() * candidates.length)));
        return { recordIndex, manualId: candidates[position].code };
      });
      if (validated.length) options.setMany(validated, 'validated');
      if (identifications.length) options.setManualIds(identifications);
      options.onDecisionsChanged();
      refresh();
      debugResult.textContent = 'Simulation de débogage : ' + count(validated.length, 'contact validé', 'contacts validés')
        + ' et ' + count(invalidated.length, 'contact invalidé', 'contacts invalidés') + '.'
        + (identifications.length ? ' ' + count(identifications.length, 'espèce attribuée au hasard', 'espèces attribuées au hasard')
          + ' aux contacts invalidés pour terminer les contrôles et calculer le prorata.' : '');
      debugResult.hidden = false;
    });

    return Object.freeze({ showPlan, refresh, hide });
  }

  return Object.freeze({ init });
});
