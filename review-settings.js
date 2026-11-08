(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./species.js'));
  else root.PlecotusReviewSettings = factory(root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Names) {
  'use strict';

  const CRITERIA = Object.freeze([
    { key: 'ratio', label: 'MATCH RATIO' },
    { key: 'qual', label: 'Qual' },
    { key: 'pulses', label: 'PULSES' },
    { key: 'dateValue', label: 'DATE' },
    { key: 'timeValue', label: 'TIME' },
    { key: 'matching', label: 'MATCHING' },
    { key: 'margin', label: 'MARGIN' }
  ].map(Object.freeze));
  const DEFAULTS = Object.freeze({
    excludedSpecies: Object.freeze(['BARBAR', 'RHIFER', 'RHIHIP', 'MYOBEC', 'MYODAS', 'MYOMYO', 'MYOEMA', 'NYCNOC', 'NYCLEI', 'NoID']),
    ratioThreshold: .6,
    majorityThreshold: .5,
    ranking: Object.freeze([
      { key: 'ratio', direction: 'desc' },
      { key: 'qual', direction: 'desc' },
      { key: 'pulses', direction: 'desc' },
      { key: 'dateValue', direction: 'asc' },
      { key: 'timeValue', direction: 'asc' }
    ].map(Object.freeze))
  });
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const keys = new Set(CRITERIA.map(item => item.key));

  function normalize(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Les réglages de vérification doivent être un objet.');
    }
    const normalized = {};
    const species = own(input, 'excludedSpecies') ? input.excludedSpecies : DEFAULTS.excludedSpecies;
    if (!Array.isArray(species)) throw new TypeError('La liste d’exclusion doit être une liste d’espèces.');
    normalized.excludedSpecies = [];
    for (const label of species) {
      const resolved = typeof label === 'string' ? Names.resolve(label) : null;
      if (!resolved || !resolved.known || !resolved.isSpecies && resolved.key !== 'unidentified') {
        throw new TypeError('Espèce inconnue dans la liste d’exclusion : « ' + String(label) + ' ».');
      }
      if (resolved.key !== 'unidentified' && !normalized.excludedSpecies.includes(resolved.code)) normalized.excludedSpecies.push(resolved.code);
    }
    // Generic NoID is always sampled rather than globally confirmed, including
    // preferences saved before this fixed exclusion was introduced.
    normalized.excludedSpecies.push('NoID');
    for (const [key, label] of [['ratioThreshold', 'Le seuil MATCH RATIO'], ['majorityThreshold', 'La proportion minimale']]) {
      const value = own(input, key) ? input[key] : DEFAULTS[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError(label + ' doit être un nombre compris entre 0 et 1, bornes incluses.');
      }
      normalized[key] = value;
    }
    const ranking = own(input, 'ranking') ? input.ranking : DEFAULTS.ranking;
    if (!Array.isArray(ranking) || !ranking.length) throw new TypeError('Choisissez au moins un critère de classement.');
    const seen = new Set();
    normalized.ranking = ranking.map(item => {
      if (!item || typeof item !== 'object' || !keys.has(item.key) || seen.has(item.key)
        || !['asc', 'desc'].includes(item.direction)) {
        throw new TypeError('Chaque critère de classement doit être unique, connu et associé au sens ascendant ou descendant.');
      }
      seen.add(item.key);
      return { key: item.key, direction: item.direction };
    });
    return normalized;
  }

  function rankingDescription(input = {}) {
    return normalize(input).ranking.map(item => CRITERIA.find(criterion => criterion.key === item.key).label
      + ' ' + (item.direction === 'asc' ? 'croissant' : 'décroissant')).join(', puis ');
  }

  return Object.freeze({ DEFAULTS, CRITERIA, normalize, rankingDescription });
});
