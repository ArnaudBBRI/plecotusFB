(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BatReviewPlan = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const valueAt = (collection, key) => collection instanceof Map ? collection.get(key) : collection && collection[key];

  // This describes the human workload without changing the classifier's
  // current queue. A reference may unlock a sample after it is checked; count
  // that sample now whenever direct validation is already impossible.
  function summarize(classification) {
    if (!classification || !Array.isArray(classification.groups) || !classification.byId) {
      throw new TypeError('Le plan de vérification exige un résultat de classification.');
    }
    const groups = classification.groups.map(group => {
      const required = new Set();
      for (const row of group.rows) {
        const assignment = valueAt(classification.byId, row.id);
        if (assignment && assignment.requiresReview) required.add(row.id);
      }
      const awaitingReference = group.mode === 'reference';
      const conditional = awaitingReference && group.kind === 'species' && group.majorityPass && !group.excluded;
      const sampling = group.kind === 'species' && (group.mode === 'proportion' && !group.canInfer || awaitingReference && !conditional);
      let remaining = required.size;
      if (sampling) {
        // Explicit sample picks remain mandatory even when imported labels or
        // additional reviews have already fulfilled the numeric quota.
        for (const id of group.selectedIds) {
          const assignment = valueAt(classification.byId, id);
          if (assignment && assignment.origin === 'pending') required.add(id);
        }
        // A user can remove picks while retaining a larger target. Preserve
        // that deficit in the plan instead of claiming the task is finished.
        remaining = Math.max(required.size, group.remainingSampleCount);
      }
      // Excluded Noise contacts are neither completed human reviews nor
      // remaining work. Genuine human decisions in their group still count.
      const completed = group.manualCount;
      const selected = new Set(group.selectedIds);
      const pending = [...required].map(id => valueAt(classification.byId, id));
      return {
        key: group.key, autoId: group.autoId, kind: group.kind,
        completed, remaining, total: completed + remaining,
        awaitingReference, conditional,
        selectedRemaining: [...required].filter(id => selected.has(id)).length,
        additionalRemaining: [...required].filter(id => !selected.has(id)).length,
        selectionNeeded: remaining - required.size,
        draftRemaining: pending.filter(assignment => assignment && assignment.status === 'draft').length,
        importedCount: group.rows.filter(row => {
          const assignment = valueAt(classification.byId, row.id);
          return assignment && assignment.origin === 'manual' && assignment.decisionSource === 'source';
        }).length,
        ignoreNoise: Boolean(classification.policy && classification.policy.ignoreNoise),
        ignored: group.ignoredCount
      };
    });
    const completed = groups.reduce((sum, group) => sum + group.completed, 0);
    const remaining = groups.reduce((sum, group) => sum + group.remaining, 0);
    return { groups, completed, remaining, total: completed + remaining };
  }

  const number = value => new Intl.NumberFormat('fr', { maximumFractionDigits: 2 }).format(value);
  const checks = value => `${number(value)} contrôle${value === 1 ? '' : 's'}`;

  // Present the same workflow and counts as summarize, rather than introducing
  // a second rule engine in the UI. The optional assignment describes the
  // displayed row; no source labels, selections or decisions are modified.
  function explain(group, workload, assignment) {
    if (!group || !workload || group.key !== workload.key) {
      throw new TypeError('L’explication exige le groupe et son plan de vérification correspondant.');
    }
    const progress = `${checks(workload.completed)} enregistré${workload.completed === 1 ? '' : 's'} et ${checks(workload.remaining)} restant${workload.remaining === 1 ? '' : 's'} (${checks(workload.total)} au total)`;
    const contactReason = !assignment ? '' : assignment.status === 'draft'
      ? 'Ce contact a un brouillon : enregistrez sa décision pour que le contrôle compte.'
      : assignment.isAnchor
        ? 'Ce contact est la référence : le meilleur contact selon le classement MATCHING, MATCH RATIO puis MARGIN.'
        : group.kind !== 'species'
          ? 'Ce contact nécessite une décision individuelle.'
          : assignment.role === 'audit'
            ? group.customSelection
              ? 'Ce contact fait partie de votre sélection manuelle personnalisée.'
              : 'Ce contact appartient à la sélection manuelle répartie entre les classes de MATCH RATIO.'
            : assignment.requiresReview
              ? 'Ce contrôle supplémentaire est obligatoire parce qu’une décision reste à finaliser ou à corriger.'
              : 'Ce contact est consulté en dehors des contrôles obligatoires.';

    if (group.kind !== 'species') {
      const reason = group.kind === 'noise'
        ? workload.ignoreNoise
          ? 'Les Noise sont ignorés par défaut ; les brouillons de contrôles volontaires et les décisions à corriger restent à vérifier individuellement.'
          : 'L’exclusion des Noise est désactivée : chaque contact Noise doit être vérifié individuellement.'
        : `Chaque contact ${group.kind === 'noid' ? 'NoID' : 'sans AUTO-ID'} doit être vérifié individuellement, car aucune espèce de référence ne permet la validation directe ou le prorata.`;
      const ignored = group.kind === 'noise' && workload.ignored ? ` ; ${number(workload.ignored)} Noise ignoré${workload.ignored === 1 ? '' : 's'}` : '';
      return { reason, calculation: `Sur ${number(group.total)} contacts : ${progress}${ignored}.`, contactReason };
    }

    const ratio = `${number(group.ratioAboveThresholdCount)} / ${number(group.total)} contacts ont un MATCH RATIO > 0,6`;
    const objective = group.explicitTarget
      ? `Objectif personnalisé : ${checks(group.sampleTarget)}, référence comprise`
      : group.samplePercent === 0
        ? `Objectif réglé à 0 %, avec le minimum d’un contrôle pour inclure la référence : ${checks(group.sampleTarget)}`
        : `Objectif : ${number(group.samplePercent)} % de ${number(group.total)} contacts, arrondi au supérieur, soit ${checks(group.sampleTarget)}, référence comprise`;

    if (workload.conditional) {
      const reason = `La confirmation du meilleur contact peut permettre la validation directe : ${ratio} (strictement plus de 50 %) et l’espèce est hors de votre liste d’exclusion.`;
      const calculation = `Plan actuel : ${progress}${workload.draftRemaining ? `, dont ${number(workload.draftRemaining)} brouillon${workload.draftRemaining === 1 ? '' : 's'} à finaliser` : ''}. Si cette référence diffère de l’AUTO-ID ou reste incertaine, ${objective.toLowerCase()}.`;
      return { reason, calculation, contactReason };
    }

    if (group.mode === 'autoid') {
      const reason = `La validation directe est acquise : la référence confirme l’AUTO-ID, ${ratio} (strictement plus de 50 %) et l’espèce est hors de votre liste d’exclusion.`;
      const calculation = workload.remaining
        ? `Les autres contacts sont validés automatiquement ; ${progress}, car des brouillons ou décisions à corriger restent à finaliser.`
        : `Les autres contacts sont validés automatiquement ; ${progress}.`;
      return { reason, calculation, contactReason };
    }

    const failures = [];
    if (group.excluded) failures.push(`l’espèce ${group.autoId} figure dans votre liste d’exclusion de la validation directe`);
    if (!group.majorityPass) failures.push(`${ratio}, alors qu’il en faut strictement plus de 50 %`);
    if (group.mode === 'proportion' && !group.referenceMatches) failures.push('l’identification du meilleur contact diffère de l’AUTO-ID ou reste incertaine');
    const reason = `Un échantillon manuel est requis car ${failures.join(' ; ')}.`;
    let detail = '';
    if (group.canInfer) {
      detail = workload.remaining
        ? ' L’échantillon est terminé ; les contrôles restants concernent seulement des brouillons ou décisions à corriger.'
        : ' L’échantillon est terminé ; les autres contacts sont attribués au prorata des identifications manuelles.';
    } else {
      const additions = [];
      if (workload.selectionNeeded) additions.push(`${checks(workload.selectionNeeded)} à ajouter à la sélection pour atteindre l’objectif`);
      if (group.targetMet && workload.selectedRemaining) additions.push(`quota atteint, mais ${checks(workload.selectedRemaining)} sélectionné${workload.selectedRemaining === 1 ? '' : 's'} encore obligatoire${workload.selectedRemaining === 1 ? '' : 's'}`);
      if (workload.additionalRemaining) additions.push(`${checks(workload.additionalRemaining)} supplémentaire${workload.additionalRemaining === 1 ? '' : 's'} à finaliser hors sélection`);
      if (group.selectedIds.length > group.sampleTarget && !group.targetMet) additions.push(`la sélection comprend ${number(group.selectedIds.length)} contacts, tous obligatoires`);
      if (workload.importedCount) additions.push(`${number(workload.importedCount)} décision${workload.importedCount === 1 ? '' : 's'} importée${workload.importedCount === 1 ? '' : 's'} du CSV déjà comptée${workload.importedCount === 1 ? '' : 's'}`);
      if (additions.length) detail = ` ${additions.join(' ; ')}.`;
    }
    const selection = group.customSelection
      ? 'sélection de contacts personnalisée'
      : 'sélection représentative des classes de MATCH RATIO';
    return { reason, calculation: `${objective} ; ${selection} ; ${progress}.${detail}`, contactReason };
  }

  return { summarize, explain };
});
