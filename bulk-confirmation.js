(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BatBulkConfirmation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const identity = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ').toUpperCase();
  const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const snapshot = value => value == null ? null : { ...value };

  function recordMap(value, name) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Map) {
      throw new TypeError(name + ' doit être un objet.');
    }
    return value;
  }

  function apply({ rows, reviews = {}, drafts = {}, groupKey, reviewer = '', timestamp = new Date().toISOString() } = {}) {
    if (!Array.isArray(rows)) throw new TypeError('Les contacts doivent être une liste.');
    recordMap(reviews, 'Les vérifications');
    recordMap(drafts, 'Les brouillons');
    if (typeof reviewer !== 'string' || typeof timestamp !== 'string' || !timestamp.trim()) {
      throw new TypeError('Le vérificateur et la date doivent être des chaînes de caractères, avec une date renseignée.');
    }
    if (typeof groupKey !== 'string' || !groupKey.startsWith('species:') || !groupKey.slice(8).trim()) {
      throw new Error('La confirmation globale doit concerner une espèce identifiée.');
    }
    const contacts = rows.filter(row => row.kind === 'species' && 'species:' + identity(row.autoId) === groupKey);
    if (!contacts.length) throw new Error('Aucun contact ne correspond à cette espèce.');

    const nextReviews = { ...reviews };
    const nextDrafts = { ...drafts };
    const changes = [];
    for (const row of contacts) {
      const previous = reviews[row.id];
      const draft = drafts[row.id];
      const priorNotes = draft && owns(draft, 'notes') ? draft.notes : previous && previous.notes;
      const notes = priorNotes == null ? '' : String(priorNotes);
      const trace = 'Confirmation globale des contacts de cette espèce (AUTO-ID : ' + row.autoId + ').';
      changes.push({ id: row.id, previous: snapshot(previous), previousDraft: snapshot(draft) });
      nextReviews[row.id] = { status: 'confirmed', label: row.autoId, notes: notes ? notes + '\n' + trace : trace, reviewer, timestamp };
      delete nextDrafts[row.id];
    }
    return { reviews: nextReviews, drafts: nextDrafts, changes };
  }

  function restore({ reviews = {}, drafts = {}, changes } = {}) {
    recordMap(reviews, 'Les vérifications');
    recordMap(drafts, 'Les brouillons');
    if (!Array.isArray(changes)) throw new TypeError('Les modifications doivent être une liste.');
    const nextReviews = { ...reviews };
    const nextDrafts = { ...drafts };
    for (const change of changes) {
      if (!change || (typeof change.id !== 'string' && typeof change.id !== 'number')) {
        throw new TypeError('Chaque modification doit identifier un contact.');
      }
      if (change.previous == null) delete nextReviews[change.id];
      else nextReviews[change.id] = snapshot(change.previous);
      if (change.previousDraft == null) delete nextDrafts[change.id];
      else nextDrafts[change.id] = snapshot(change.previousDraft);
    }
    return { reviews: nextReviews, drafts: nextDrafts };
  }

  return { apply, restore };
});
