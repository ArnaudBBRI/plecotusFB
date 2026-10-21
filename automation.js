(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BatClassification = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Project workflow rules. Proportional labels estimate contact counts; they
  // are not individual acoustic identifications or calibrated probabilities.
  const VERSION = 2;
  const EXCLUDED_SPECIES = Object.freeze(['BARBAR', 'RHIFER', 'RHIHIP', 'MYOBEC', 'MYODAS', 'MYOMYO', 'MYOEMA', 'NYCNOC', 'NYCLEI']);
  const EXCLUDED_ALIASES = Object.freeze({
    BARBAR: Object.freeze(['Barbastella barbastellus']), RHIFER: Object.freeze(['Rhinolophus ferrumequinum']),
    RHIHIP: Object.freeze(['Rhinolophus hipposideros']), MYOBEC: Object.freeze(['Myotis bechsteinii', 'Myotis bechsteini']),
    MYODAS: Object.freeze(['Myotis dasycneme']), MYOMYO: Object.freeze(['Myotis myotis']), MYOEMA: Object.freeze(['Myotis emarginatus']),
    NYCNOC: Object.freeze(['Nyctalus noctula']), NYCLEI: Object.freeze(['Nyctalus leisleri'])
  });
  const EXCLUDED = new Set([...EXCLUDED_SPECIES, ...Object.values(EXCLUDED_ALIASES).flat().map(label => label.toUpperCase())]);
  const RATIO_THRESHOLD = 0.6;
  const MAJORITY_THRESHOLD = 0.5;
  const RATIO_BINS = Object.freeze([
    Object.freeze({ key: '0-0.2', label: '[0 ; 0,2]', min: 0, max: 0.2 }),
    Object.freeze({ key: '0.2-0.4', label: ']0,2 ; 0,4]', min: 0.2, max: 0.4 }),
    Object.freeze({ key: '0.4-0.6', label: ']0,4 ; 0,6]', min: 0.4, max: 0.6 }),
    Object.freeze({ key: '0.6-0.8', label: ']0,6 ; 0,8]', min: 0.6, max: 0.8 }),
    Object.freeze({ key: '0.8-1', label: ']0,8 ; 1]', min: 0.8, max: 1 }),
    Object.freeze({ key: 'missing', label: 'Ratio absent ou invalide', min: null, max: null })
  ]);
  const MANUAL = new Set(['confirmed', 'corrected', 'uncertain', 'noise']);
  const identity = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();
  const specialIdentity = value => identity(value).replace(/[\s_-]+/g, '');
  // A reviewed NoID outcome is an explicit countable bat-identification label.
  // Keep it even when an older project saved that choice as "uncertain".
  // Other uncertain labels remain unconfirmed and must not become NoID counts.
  const noIdIdentity = value => specialIdentity(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const NOID_DESCRIPTIONS = new Set([
    'Chauve-souris non identifiée', 'Pipistrelle non identifiée', 'Sérotule non identifiée',
    'Murin non identifié', 'Oreillard non identifié', 'Unidentified bat',
    'Chiroptère non identifié', 'Chiroptère indéterminé', 'Chiroptera sp.', 'Chiroptera indet.'
  ].map(noIdIdentity));
  const explicitNoId = value => /^(?:NOID(?:PIP|SER|MYO|PLE)?)$/.test(noIdIdentity(value)) || NOID_DESCRIPTIONS.has(noIdIdentity(value));
  const validNumber = value => typeof value === 'number' && Number.isFinite(value);
  const valueAt = (collection, key) => collection instanceof Map ? collection.get(key) : collection && collection[key];
  const groupKey = row => row.kind + ':' + identity(row.autoId);

  function percentage(value, fallback) {
    if (value == null) return fallback;
    if (!validNumber(value) || value < 0 || value > 100) throw new Error('Le pourcentage de vérification doit être un nombre entre 0 et 100.');
    return value;
  }
  function normalizePolicy(input) {
    const source = input == null ? {} : input;
    if (typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Les règles de classification doivent être un objet.');
    if (source.ignoreNoise != null && typeof source.ignoreNoise !== 'boolean') throw new TypeError('Le réglage d’exclusion des contacts Noise doit être un booléen.');
    const ignoreNoise = source.ignoreNoise == null ? true : source.ignoreNoise;
    // Legacy intensity settings are deliberately retired rather than silently
    // converted into a different minimum sample percentage.
    if (source.version === 1 || source.preset != null) return { version: VERSION, samplePercent: 20, ignoreNoise };
    if (source.version != null && source.version !== VERSION) throw new Error('Version des règles de classification non prise en charge.');
    return { version: VERSION, samplePercent: percentage(source.samplePercent, 20), ignoreNoise };
  }

  function savedDecision(review) {
    if (!review || !MANUAL.has(review.status) || typeof review.label !== 'string' || !review.label.trim()) return null;
    if (review.status === 'noise' && specialIdentity(review.label) !== 'NOISE') return null;
    return { ...review, label: review.label.trim(), decisionSource: 'project' };
  }
  function decisionFor(row, reviews) {
    const review = valueAt(reviews, row.id);
    if (review != null) return savedDecision(review);
    const label = String(row.manualId || '').trim();
    return label ? { status: 'imported', label, decisionSource: 'source' } : null;
  }
  function agreed(decision, label) {
    return Boolean(decision && decision.status !== 'uncertain' && identity(decision.label) === identity(label));
  }
  function descending(left, right) {
    const a = validNumber(left), b = validNumber(right);
    return a && b ? right - left : a ? -1 : b ? 1 : 0;
  }
  function compareContacts(left, right) {
    return descending(left.matching, right.matching) || descending(left.ratio, right.ratio) || descending(left.margin, right.margin) || left.index - right.index;
  }
  function hash(text) {
    let value = 2166136261;
    for (let index = 0; index < text.length; index++) { value ^= text.charCodeAt(index); value = Math.imul(value, 16777619); }
    return value >>> 0;
  }
  function seed(row, purpose) {
    return hash(JSON.stringify([purpose, groupKey(row), row.indir, row.rawFolder, row.file, row.channel, row.offset, row.id]));
  }
  function ratioBin(row) {
    if (!validNumber(row.ratio) || row.ratio < 0 || row.ratio > 1) return RATIO_BINS.length - 1;
    return RATIO_BINS.findIndex(bin => bin.max != null && row.ratio <= bin.max);
  }

  // Allocate whole units to weighted classes using largest remainders, with
  // fixed lower bounds (the reference) and capacity limits (class sizes).
  function quotas(weights, total, minimums) {
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    const exact = weights.map(value => weightTotal ? total * value / weightTotal : 0);
    const result = exact.map((value, index) => Math.min(weights[index], Math.max(minimums[index] || 0, Math.floor(value))));
    let assigned = result.reduce((sum, value) => sum + value, 0);
    while (assigned < total) {
      const candidates = result.map((value, index) => index).filter(index => result[index] < weights[index]);
      candidates.sort((a, b) => (exact[b] - result[b]) - (exact[a] - result[a]) || a - b);
      if (!candidates.length) break;
      result[candidates[0]]++; assigned++;
    }
    while (assigned > total) {
      const candidates = result.map((value, index) => index).filter(index => result[index] > (minimums[index] || 0));
      candidates.sort((a, b) => (result[b] - exact[b]) - (result[a] - exact[a]) || b - a);
      if (!candidates.length) break;
      result[candidates[0]]--; assigned--;
    }
    return result;
  }
  function representativeSample(rows, anchor, target) {
    const bins = RATIO_BINS.map(() => []);
    for (const row of rows) bins[ratioBin(row)].push(row);
    const minimums = RATIO_BINS.map((_, index) => anchor && ratioBin(anchor) === index ? 1 : 0);
    const counts = quotas(bins.map(bin => bin.length), target, minimums);
    const selected = [];
    bins.forEach((bin, index) => {
      const others = bin.filter(row => !anchor || row.id !== anchor.id).sort((a, b) => seed(a, 'sample') - seed(b, 'sample') || a.index - b.index);
      if (minimums[index]) selected.push(anchor);
      selected.push(...others.slice(0, counts[index] - minimums[index]));
    });
    return {
      rows: selected.sort(compareContacts),
      bins: RATIO_BINS.map((bin, index) => ({ ...bin, count: bins[index].length, recommendedCount: counts[index] }))
    };
  }

  function selectionFor(selections, key, rows, anchor, defaultPercent) {
    const supplied = valueAt(selections, key);
    const override = Array.isArray(supplied) ? { selectedIds: supplied } : supplied;
    if (override != null && (typeof override !== 'object' || Array.isArray(override))) throw new Error('La sélection de contrôles doit être un objet ou une liste de contacts.');
    const samplePercent = percentage(override && override.samplePercent, defaultPercent);
    const explicitTarget = override && override.sampleTarget;
    if (explicitTarget != null && (!Number.isInteger(explicitTarget) || explicitTarget < 1 || explicitTarget > rows.length)) throw new Error('L’objectif de vérification doit être un entier entre 1 et le nombre de contacts de cette espèce.');
    const sampleTarget = explicitTarget == null ? Math.min(rows.length, Math.max(1, Math.ceil(rows.length * samplePercent / 100))) : explicitTarget;
    const sample = representativeSample(rows, anchor, sampleTarget);
    const custom = Boolean(override && Object.prototype.hasOwnProperty.call(override, 'selectedIds'));
    const ids = new Set(rows.map(row => row.id));
    let selectedIds = sample.rows.map(row => row.id);
    if (custom) {
      if (!Array.isArray(override.selectedIds) || override.selectedIds.some(id => typeof id !== 'string' || !ids.has(id))) throw new Error('La sélection contient un contact absent de cette espèce.');
      const chosen = new Set([anchor.id, ...override.selectedIds]);
      selectedIds = [...chosen];
      // Keep the user's custom selection, even below the declared minimum.
      // Completion still requires the manual quota; the UI exposes the deficit
      // and an explicit action to lower the target to the chosen sample size.
    }
    const positions = new Map(rows.map((row, index) => [row.id, index]));
    selectedIds.sort((a, b) => positions.get(a) - positions.get(b));
    return { samplePercent, sampleTarget, explicitTarget: explicitTarget != null, selectedIds, customSelection: custom, recommendedIds: sample.rows.map(row => row.id), bins: sample.bins };
  }

  function distributionFor(rows, info, remainingCount) {
    const observed = new Map();
    for (const row of rows.slice().sort((a, b) => a.index - b.index)) {
      const decision = info.get(row.id).decision;
      if (!decision) continue;
      const uncertain = decision.status === 'uncertain' && !explicitNoId(decision.label);
      const label = uncertain ? 'Chauve-souris non identifiée' : decision.label;
      const key = JSON.stringify([uncertain, identity(label)]);
      if (!observed.has(key)) observed.set(key, { label, uncertain, manualCount: 0, share: 0, inferredCount: 0, idealInferredCount: 0 });
      observed.get(key).manualCount++;
    }
    const entries = [...observed.values()].sort((a, b) => identity(a.label).localeCompare(identity(b.label)) || Number(a.uncertain) - Number(b.uncertain));
    const manualCount = entries.reduce((sum, entry) => sum + entry.manualCount, 0);
    let allocated = 0;
    for (const entry of entries) {
      entry.share = manualCount ? entry.manualCount / manualCount : 0;
      entry.idealInferredCount = remainingCount * entry.share;
      entry.inferredCount = Math.floor(entry.idealInferredCount);
      allocated += entry.inferredCount;
    }
    const remainders = entries.map((entry, index) => ({ index, remainder: entry.idealInferredCount - entry.inferredCount }));
    remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let index = 0; index < remainingCount - allocated; index++) entries[remainders[index].index].inferredCount++;
    return entries;
  }

  function classify(data, reviews, inputPolicy, drafts, selections) {
    if (!data || !Array.isArray(data.rows)) throw new TypeError('La classification exige des lignes CSV analysées.');
    const policy = normalizePolicy(inputPolicy);
    const info = new Map(), grouped = new Map();
    for (const row of data.rows) {
      if (!row || typeof row.id !== 'string' || info.has(row.id)) throw new Error('Chaque contact analysé doit avoir un identifiant de ligne source unique.');
      const decision = decisionFor(row, reviews);
      info.set(row.id, { decision, draft: valueAt(drafts, row.id), invalidReview: valueAt(reviews, row.id) != null && !decision });
      const key = groupKey(row);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(row);
    }
    const groups = [], byId = new Map();
    for (const [key, sourceRows] of grouped) {
      const rows = sourceRows.slice().sort(compareContacts), first = rows[0];
      const species = first.kind === 'species', anchor = species ? first : null;
      const ignoredIds = new Set(policy.ignoreNoise && first.kind === 'noise' ? rows.filter(row => {
        const item = info.get(row.id);
        return !item.decision && !item.draft && !item.invalidReview;
      }).map(row => row.id) : []);
      const manualRows = rows.filter(row => !ignoredIds.has(row.id));
      const manualCount = rows.filter(row => info.get(row.id).decision).length;
      const above = rows.filter(row => validNumber(row.ratio) && row.ratio > RATIO_THRESHOLD && row.ratio <= 1).length;
      const share = rows.length ? above / rows.length : 0;
      const majorityPass = share > MAJORITY_THRESHOLD;
      const excluded = species && EXCLUDED.has(identity(first.autoId));
      const referenceDecision = anchor ? info.get(anchor.id).decision : null;
      const referenceMatches = anchor ? agreed(referenceDecision, first.autoId) : false;
      const fastEligible = species && referenceMatches && majorityPass && !excluded;
      const selection = species ? selectionFor(selections, key, rows, anchor, policy.samplePercent) : { samplePercent: null, sampleTarget: manualRows.length, selectedIds: manualRows.map(row => row.id), customSelection: false, recommendedIds: manualRows.map(row => row.id), bins: [] };
      const mode = !species ? 'manual' : !referenceDecision ? 'reference' : fastEligible ? 'autoid' : 'proportion';
      const selectedSet = new Set(selection.selectedIds);
      const requiredIds = new Set(mode === 'reference' ? [anchor.id] : mode === 'autoid' ? [] : selection.selectedIds);
      const pendingValidation = [...requiredIds].filter(id => !info.get(id).decision);
      const targetMet = !species || manualCount >= selection.sampleTarget;
      const canInfer = mode === 'autoid' || mode === 'proportion' && targetMet && pendingValidation.length === 0;
      const inferenceRows = canInfer ? rows.filter(row => !info.get(row.id).decision && !info.get(row.id).draft && !info.get(row.id).invalidReview) : [];
      const distribution = species && manualCount ? distributionFor(rows, info, mode === 'proportion' && canInfer ? inferenceRows.length : 0) : [];
      const allocation = new Map();
      if (mode === 'proportion' && canInfer) {
        const shuffled = inferenceRows.slice().sort((a, b) => seed(a, 'allocation') - seed(b, 'allocation') || a.index - b.index);
        let next = 0;
        for (const entry of distribution) for (let index = 0; index < entry.inferredCount; index++) allocation.set(shuffled[next++].id, entry);
      }
      const failureReasons = [];
      if (species && referenceDecision && !referenceMatches) failureReasons.push('L’identification manuelle du meilleur contact diffère de l’AUTO-ID ou reste incertaine.');
      if (species && !majorityPass) failureReasons.push('Il faut strictement plus de 50 % des contacts avec MATCH RATIO strictement supérieur à 0,6.');
      if (excluded) failureReasons.push('Cette espèce figure dans la liste exclue de la validation directe (Natura 2000 ou sensibilité à l’éolien).');
      const group = {
        key, groupKey: key, autoId: first.autoId, kind: first.kind, count: rows.length, total: rows.length,
        rows, anchorId: anchor ? anchor.id : null, mode, state: mode === 'reference' ? 'reference' : canInfer ? 'ready' : species ? 'validation' : ignoredIds.size === rows.length ? 'ignored' : 'manual',
        enabled: species, blocked: false, groupBlocked: false, blockingIds: [], blockReasons: [],
        ratioThreshold: RATIO_THRESHOLD, majorityThreshold: MAJORITY_THRESHOLD,
        ratioAboveThresholdCount: above, ratioAboveThresholdShare: share, majorityPass, excluded, referenceMatches,
        fastEligible, referenceDecisionSource: referenceDecision && referenceDecision.decisionSource,
        ...selection, selectionMeetsTarget: selection.selectedIds.length >= selection.sampleTarget, selectionDeficit: Math.max(0, selection.sampleTarget - selection.selectedIds.length),
        strata: RATIO_BINS.map((bin, binIndex) => ({ key: bin.key, label: bin.label, total: rows.filter(row => ratioBin(row) === binIndex).length, selectedCount: rows.filter(row => ratioBin(row) === binIndex && selectedSet.has(row.id)).length, manualCount: rows.filter(row => ratioBin(row) === binIndex && info.get(row.id).decision).length })),
        recommendedAuditIds: selection.recommendedIds.filter(id => !anchor || id !== anchor.id),
        auditIds: selection.selectedIds.filter(id => !anchor || id !== anchor.id), auditCount: Math.max(0, selection.selectedIds.length - (anchor ? 1 : 0)),
        candidateIds: rows.map(row => row.id), eligibleCount: rows.length,
        pendingValidation, pendingValidationCount: pendingValidation.length,
        remainingSampleCount: Math.max(0, selection.sampleTarget - manualCount), targetMet,
        canInfer, validated: canInfer, reasons: failureReasons, distribution,
        manualCount: 0, inferredCount: 0, ignoredCount: 0, requiredCount: 0, waitingCount: 0
      };
      rows.forEach((row, index) => {
        const item = info.get(row.id), isAnchor = anchor && row.id === anchor.id;
        let role = isAnchor ? 'reference' : requiredIds.has(row.id) ? species ? 'audit' : 'manual' : 'waiting';
        let assignment;
        if (item.decision) {
          assignment = { status: item.decision.status, label: item.decision.label, origin: 'manual', requiresReview: false,
            role: isAnchor ? 'reference' : selectedSet.has(row.id) && species ? 'audit' : 'manual', decisionSource: item.decision.decisionSource,
            reasons: [item.decision.decisionSource === 'source' ? 'Identification manuelle reprise de la colonne MANUAL ID du CSV source.' : item.decision.status === 'uncertain' ? 'Décision manuelle enregistrée ; l’identification reste incertaine.' : 'Décision manuelle enregistrée pour ce contact.'] };
          group.manualCount++;
        } else if (ignoredIds.has(row.id)) {
          assignment = { status: 'ignored-noise', label: 'Noise', origin: 'ignored', requiresReview: false, role: 'ignored',
            reasons: ['Contact Noise exclu des contrôles obligatoires par défaut ; la ligne source reste conservée et peut être vérifiée volontairement.'] };
          group.ignoredCount++;
        } else if (canInfer && !item.draft && !item.invalidReview) {
          const entry = allocation.get(row.id);
          const label = mode === 'autoid' ? row.autoId : entry.label;
          assignment = { status: entry && entry.uncertain ? 'inferred-uncertain' : specialIdentity(label) === 'NOISE' ? 'inferred-noise' : 'inferred',
            label, origin: 'inferred', requiresReview: false, role: 'inferred', inferredMethod: mode,
            reasons: [mode === 'autoid' ? 'Validation directe : meilleur contact confirmé, plus de 50 % des MATCH RATIO > 0,6 et espèce hors liste d’exclusion. AUTO-ID repris dans SEMIMANUAL ID.' : 'Répartition au prorata des identifications manuelles de cette espèce AUTO-ID, avec arrondi aux plus grands restes. Cette étiquette est une attribution statistique, pas une identification acoustique individuelle.'] };
          group.inferredCount++;
        } else {
          const mandatory = requiredIds.has(row.id) || Boolean(item.draft) || item.invalidReview;
          if (!mandatory) { role = 'waiting'; group.waitingCount++; }
          else group.requiredCount++;
          const reasons = [];
          if (isAnchor) reasons.push('Vérifiez le meilleur contact pour déterminer la règle applicable à toute cette espèce AUTO-ID du CSV.');
          else if (mandatory && species) reasons.push('Contact sélectionné pour l’échantillon manuel représentatif des classes de MATCH RATIO.');
          else if (mandatory) reasons.push(row.kind === 'noise' ? 'Contact Noise à vérifier individuellement : contrôle volontaire ou exclusion des Noise désactivée.' : 'Les contacts NoID et non classés restent à vérifier individuellement.');
          else if (mode === 'reference') reasons.push('En attente de l’identification manuelle du meilleur contact de cette espèce.');
          else reasons.push('En attente de la fin de l’échantillon manuel sélectionné pour cette espèce.');
          if (item.draft) reasons.push('Brouillon non enregistré : enregistrez une décision pour compter ce contrôle.');
          if (item.invalidReview) reasons.push('Décision enregistrée invalide ; vérifiez à nouveau ce contact.');
          assignment = { status: item.draft ? 'draft' : 'needs-review', label: item.draft ? String(item.draft.label || '') : '', origin: 'pending', requiresReview: mandatory, role, reasons };
        }
        assignment = { id: row.id, row, ...assignment, semimanualLabel: mode === 'autoid' ? String(row.importedAutoId == null ? row.autoId : row.importedAutoId) : assignment.origin === 'inferred' ? assignment.label : '',
          method: assignment.origin === 'ignored' ? 'ignored-noise' : assignment.origin === 'manual' ? 'manual' : assignment.inferredMethod || (mode === 'autoid' ? 'autoid' : 'manual'),
          semimanualMethod: mode === 'autoid' ? 'autoid' : assignment.origin === 'inferred' ? 'proportion' : '',
          reason: assignment.reasons.join(' '), groupBlocked: false, groupKey: key, rank: index + 1, isAnchor: Boolean(isAnchor), ratioClass: RATIO_BINS[ratioBin(row)].key };
        byId.set(row.id, assignment);
      });
      groups.push(group);
    }
    const assignments = data.rows.map(row => byId.get(row.id));
    const metrics = { total: assignments.length, manual: 0, inferred: 0, ignored: 0, required: 0, waiting: 0, uncertain: 0, unresolved: 0, pending: 0, noise: 0, classified: 0, taxon: 0, blockedGroups: 0 };
    const summaryMap = new Map();
    for (const assignment of assignments) {
      let label = assignment.label, category = 'taxon';
      const uncertain = assignment.status === 'inferred-uncertain' || assignment.status === 'uncertain' && !explicitNoId(assignment.label);
      if (assignment.origin === 'pending') { label = 'Pending classification'; category = 'pending'; metrics.pending++; metrics.unresolved++; }
      else if (uncertain) { label = 'Uncertain / unresolved'; category = 'uncertain'; metrics.uncertain++; metrics.unresolved++; }
      else if (specialIdentity(label) === 'NOISE') { label = 'Noise'; category = 'noise'; metrics.noise++; metrics.classified++; }
      else if (explicitNoId(label) || ['UNIDENTIFIEDBAT', 'CHAUVESOURISNONIDENTIFIÉE', 'CHAUVESOURISNONIDENTIFIEE', 'NOID', 'UNCLASSIFIED', 'UNRESOLVED', 'UNKNOWN'].includes(specialIdentity(label))) { category = 'unresolved'; metrics.unresolved++; }
      else { metrics.taxon++; metrics.classified++; }
      if (assignment.origin === 'manual') metrics.manual++;
      if (assignment.origin === 'inferred') metrics.inferred++;
      if (assignment.origin === 'ignored') metrics.ignored++;
      if (assignment.requiresReview) metrics.required++;
      if (assignment.origin === 'pending' && !assignment.requiresReview) metrics.waiting++;
      const key = JSON.stringify([category, identity(label)]);
      if (!summaryMap.has(key)) summaryMap.set(key, { label, category, manual: 0, inferred: 0, ignored: 0, pending: 0, total: 0, uncertain: 0 });
      const entry = summaryMap.get(key); entry.total++; entry[assignment.origin]++;
      if (uncertain) entry.uncertain++;
    }
    const categoryOrder = { taxon: 0, noise: 1, unresolved: 2, uncertain: 3, pending: 4 };
    const summary = [...summaryMap.values()].sort((a, b) => categoryOrder[a.category] - categoryOrder[b.category] || a.label.localeCompare(b.label));
    metrics.complete = metrics.unresolved === 0;
    return { assignments, byId, summary, metrics, groups, policy };
  }

  return { VERSION, EXCLUDED_SPECIES, EXCLUDED_ALIASES, RATIO_BINS, RATIO_THRESHOLD, MAJORITY_THRESHOLD, normalizePolicy, classify, compareContacts, groupKey };
});
