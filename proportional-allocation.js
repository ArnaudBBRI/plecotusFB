(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlecotusProportionalAllocation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

  function denseArray(value) {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index++) if (!own(value, index)) return false;
    return true;
  }

  function validIndex(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function compareLabels(left, right) {
    return left.localeCompare(right, 'fr') || (left < right ? -1 : left > right ? 1 : 0);
  }

  // Allocate only contacts supplied by the caller. Human identifications are
  // observations, not candidates whose known species should be reassigned.
  function allocate(recordIndices, observations) {
    if (!denseArray(recordIndices) || !denseArray(observations)) {
      throw new TypeError('La répartition exige deux listes complètes : contacts à attribuer et identifications manuelles.');
    }
    const indices = recordIndices.slice();
    const pending = new Set();
    for (const index of indices) {
      if (!validIndex(index) || pending.has(index)) {
        throw new TypeError('Chaque contact à attribuer doit avoir un numéro entier positif ou nul, unique.');
      }
      pending.add(index);
    }

    const totals = new Map();
    const observedIndices = new Set();
    for (const observation of observations) {
      if (!observation || typeof observation !== 'object' || Array.isArray(observation)
        || typeof observation.label !== 'string' || !observation.label.trim()) {
        throw new TypeError('Chaque identification manuelle doit fournir une espèce ou une étiquette non vide.');
      }
      if (own(observation, 'recordIndex')) {
        const index = observation.recordIndex;
        if (!validIndex(index) || observedIndices.has(index) || pending.has(index)) {
          throw new TypeError('Un contact manuel doit avoir un numéro unique et ne peut pas être réattribué au prorata.');
        }
        observedIndices.add(index);
      }
      // Trimming never merges labels through case changes or taxonomic guesses.
      const label = observation.label.trim();
      totals.set(label, (totals.get(label) || 0) + 1);
    }

    const distribution = [...totals].sort(([left], [right]) => compareLabels(left, right))
      .map(([label, manualCount]) => ({ label, manualCount,
        share: manualCount / observations.length, assignedCount: 0 }));
    if (!observations.length) {
      return { assignments: [], distribution, total: 0, complete: !indices.length, unassignedIndices: indices };
    }

    // Integer numerators keep equal remainders equal even at decimal borders.
    const denominator = BigInt(observations.length);
    const count = BigInt(indices.length);
    let assigned = 0;
    const remainders = distribution.map((entry, index) => {
      const numerator = count * BigInt(entry.manualCount);
      entry.assignedCount = Number(numerator / denominator);
      assigned += entry.assignedCount;
      return { index, remainder: numerator % denominator };
    }).sort((left, right) => left.remainder === right.remainder
      ? left.index - right.index : left.remainder > right.remainder ? -1 : 1);
    for (let index = 0; index < indices.length - assigned; index++) {
      distribution[remainders[index].index].assignedCount++;
    }

    const sorted = indices.slice().sort((left, right) => left - right);
    const labelsByIndex = new Map();
    let position = 0;
    for (const entry of distribution) {
      for (let index = 0; index < entry.assignedCount; index++) labelsByIndex.set(sorted[position++], entry.label);
    }
    const assignments = indices.map(recordIndex => ({ recordIndex, label: labelsByIndex.get(recordIndex) }));
    return { assignments, distribution, total: assignments.length, complete: true, unassignedIndices: [] };
  }

  return Object.freeze({ allocate });
});
