(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./species.js'), root);
  else root.PlecotusContactDecisions = factory(root.BatReviewCore, root.BatSpeciesNames, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Names, root) {
  'use strict';

  const prefix = 'plecotus.review-decisions.v1.';
  const statuses = new Set(['validated', 'invalidated', 'unresolved']);
  const UNRESOLVED_LABEL = 'Identification incertaine/non résolue';
  const COMMENT_HEADER = 'COMMENTAIRE PLECOTUS';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isUnresolvedLabel = value => Names.resolve(value).category === 'uncertain';
  const isComplete = decision => Boolean(decision && ['validated', 'invalidated'].includes(decision.status)
    && typeof decision.manualId === 'string' && decision.manualId.trim() && !isUnresolvedLabel(decision.manualId));
  function manualLabel(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) {
      throw new TypeError('Renseignez une identification manuelle sur une seule ligne.');
    }
    return value.trim();
  }
  function commentText(value) {
    if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) {
      throw new TypeError('Le commentaire doit être du texte sans caractère de contrôle, avec tabulations et sauts de ligne autorisés.');
    }
    return value;
  }
  const normalizedIdentity = value => value.replace(/\s+/g, ' ').trim();
  function defaultManualId(sourceAutoId) {
    const label = normalizedIdentity(sourceAutoId);
    try { return manualLabel(label); }
    catch { return null; }
  }
  function sameIdentity(left, right) {
    const sourceLabel = normalizedIdentity(left);
    const manual = normalizedIdentity(right);
    if (!sourceLabel || !manual) return false;
    if (Names && typeof Names.resolve === 'function') {
      const source = Names.resolve(sourceLabel);
      const identified = Names.resolve(manual);
      if (source.known && identified.known) return source.key === identified.key;
    }
    return sourceLabel.toUpperCase() === manual.toUpperCase();
  }
  function denseArray(value) {
    if (!Array.isArray(value)) return false;
    for (let index = 0; index < value.length; index++) if (!own(value, index)) return false;
    return true;
  }

  function sourceData(imported) {
    if (!imported || !denseArray(imported.headers) || !denseArray(imported.records)
      || !imported.headers.length || imported.headers.some(header => typeof header !== 'string')) {
      throw new TypeError('Les décisions exigent les en-têtes et les contacts du fichier importé.');
    }
    const headers = imported.headers.slice();
    const columns = Core.canonicalColumns(headers);
    const commentColumns = headers.map((header, index) => ({ index,
      key: header.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') }))
      .filter(item => item.key === 'COMMENTAIREPLECOTUS');
    if (commentColumns.length > 1) throw new Error('Plusieurs colonnes désignent ' + COMMENT_HEADER + '. Gardez une seule colonne sans ambiguïté.');
    const records = imported.records.map(record => {
      if (!denseArray(record) || record.length !== headers.length || record.some(cell =>
        cell !== null && !['string', 'boolean', 'number'].includes(typeof cell)
        || typeof cell === 'number' && !Number.isFinite(cell))) {
        throw new TypeError('Chaque contact doit conserver les cellules et les colonnes du fichier importé.');
      }
      return record.slice();
    });
    if (imported.sourceRows != null && (!denseArray(imported.sourceRows)
      || imported.sourceRows.length !== records.length
      || imported.sourceRows.some(row => !Number.isInteger(row) || row < 1))) {
      throw new TypeError('Les numéros de ligne source des contacts sont invalides.');
    }
    const sourceRows = imported.sourceRows ? imported.sourceRows.slice() : records.map((_, index) => index + 2);
    return { headers, records, sourceRows, columns, commentColumn: commentColumns.length ? commentColumns[0].index : -1,
      resumeIdentity: typeof imported.resumeIdentity === 'string' ? imported.resumeIdentity : null,
      fileName: String(imported.fileName == null ? '' : imported.fileName),
      sheetName: imported.sheetName == null ? null : String(imported.sheetName) };
  }

  async function fingerprint(data, crypto) {
    try {
      if (!crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function') return null;
      const parts = [data.fileName, data.sheetName, data.headers, data.records, data.sourceRows];
      if (data.resumeIdentity != null) parts.push(data.resumeIdentity);
      const identity = JSON.stringify(parts);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
      if (!hash || hash.byteLength !== 32) return null;
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  async function create(imported, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Les options des décisions sont invalides.');
    const data = sourceData(imported);
    let comments = new Map();
    if (data.commentColumn >= 0) data.records.forEach((record, recordIndex) => {
      const value = commentText(String(record[data.commentColumn] == null ? '' : record[data.commentColumn]));
      if (value !== '') comments.set(recordIndex, value);
    });
    let storage = null;
    try { storage = own(options, 'storage') ? options.storage : root.localStorage; } catch {}
    const crypto = own(options, 'crypto') ? options.crypto : root.crypto;
    const fileId = await fingerprint(data, crypto);
    let persistenceAvailable = Boolean(fileId && storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
    const key = fileId ? prefix + fileId : null;
    let decisions = new Map();

    function checkIndex(recordIndex) {
      if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= data.records.length) {
        throw new RangeError('Le numéro du contact à vérifier est invalide.');
      }
    }

    function autoIdFor(recordIndex) {
      const record = data.records[recordIndex];
      return data.columns.autoId < 0 ? '' : String(record[data.columns.autoId] == null ? '' : record[data.columns.autoId]);
    }

    function decisionFor(recordIndex, status, updatedAt, manualId = status === 'validated' ? defaultManualId(autoIdFor(recordIndex)) : null) {
      const sourceAutoId = autoIdFor(recordIndex);
      return Object.freeze({ recordIndex, sourceRow: data.sourceRows[recordIndex], sourceAutoId,
        status, validated: status === 'validated',
        suggestedId: status === 'validated' && sourceAutoId.trim() ? sourceAutoId.trim() : null,
        manualId,
        updatedAt });
    }

    function restoreComments(saved) {
      if (!own(saved, 'comments') || !denseArray(saved.comments)) return;
      try {
        const restored = new Map(), seen = new Set();
        for (const item of saved.comments) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return;
          checkIndex(item.recordIndex);
          if (seen.has(item.recordIndex)) return;
          seen.add(item.recordIndex);
          const value = commentText(item.text);
          if (value !== '') restored.set(item.recordIndex, value);
        }
        // A complete saved map is authoritative, including omissions for
        // comments explicitly cleared since importing the source file.
        comments = restored;
      } catch { /* Invalid comment data cannot discard valid saved decisions. */ }
    }

    function restore(source) {
      try {
        const saved = JSON.parse(source);
        if (!saved || saved.version !== 1 || saved.fileId !== fileId || !Array.isArray(saved.decisions)) return;
        const restored = new Map();
        for (const item of saved.decisions) {
          if (!item || !statuses.has(item.status) || typeof item.updatedAt !== 'string'
            || !Number.isFinite(Date.parse(item.updatedAt))) return;
          checkIndex(item.recordIndex);
          if (restored.has(item.recordIndex)) return;
          const sourceAutoId = autoIdFor(item.recordIndex);
          // Version 1 reviews saved before manual corrections only carried the binary choice.
          const manualId = own(item, 'manualId') ? item.manualId
            : item.status === 'validated' ? defaultManualId(sourceAutoId) : null;
          if (item.status === 'unresolved' && manualId !== null) return;
          if (manualId !== null && (manualLabel(manualId) !== manualId
            || sameIdentity(sourceAutoId, manualId) !== (item.status === 'validated'))) return;
          if (manualId === null && item.status === 'validated' && defaultManualId(sourceAutoId) !== null) return;
          const expected = decisionFor(item.recordIndex, item.status, item.updatedAt, manualId);
          if (item.sourceRow !== expected.sourceRow || item.sourceAutoId !== expected.sourceAutoId
            || item.validated !== expected.validated || item.suggestedId !== expected.suggestedId) return;
          restored.set(item.recordIndex, manualId !== null && isUnresolvedLabel(manualId)
            ? decisionFor(item.recordIndex, 'unresolved', item.updatedAt) : expected);
        }
        decisions = restored;
        restoreComments(saved);
      } catch { /* A damaged or unrelated saved review never supplies decisions. */ }
    }

    if (persistenceAvailable) {
      try {
        const saved = storage.getItem(key);
        if (saved != null) restore(saved);
      } catch { persistenceAvailable = false; }
    }

    function snapshot() {
      return { version: 1, fileId, decisions: [...decisions.values()]
        .sort((left, right) => left.recordIndex - right.recordIndex).map(item => ({ ...item })),
        comments: [...comments].sort(([left], [right]) => left - right).map(([recordIndex, text]) => ({ recordIndex, text })) };
    }

    function persist() {
      if (!persistenceAvailable) return;
      try { storage.setItem(key, JSON.stringify(snapshot())); }
      catch { persistenceAvailable = false; }
    }

    function setMany(recordIndices, status) {
      if (!denseArray(recordIndices)) throw new TypeError('La sélection des contacts doit être une liste complète de numéros.');
      if (!statuses.has(status)) throw new TypeError('Choisissez de valider ou d’invalider le contact, ou de différer son identification.');
      // Check the entire selection before replacing any existing decisions.
      for (const recordIndex of recordIndices) checkIndex(recordIndex);
      const indices = [...new Set(recordIndices)];
      const updatedAt = new Date().toISOString();
      const changes = [];
      const result = indices.map(recordIndex => {
        const nextStatus = status === 'validated' && isUnresolvedLabel(autoIdFor(recordIndex)) ? 'unresolved' : status;
        const previous = decisions.get(recordIndex);
        if (previous && previous.status === nextStatus) return previous;
        const decision = decisionFor(recordIndex, nextStatus, updatedAt);
        changes.push(decision);
        return decision;
      });
      for (const decision of changes) decisions.set(decision.recordIndex, decision);
      if (changes.length) persist();
      return Object.freeze(result);
    }

    function setManualIds(entries) {
      if (!denseArray(entries)) throw new TypeError('Les identifications manuelles doivent être une liste complète de contacts.');
      const seen = new Set();
      // Validate the complete batch before changing a choice or saving it.
      const prepared = entries.map(entry => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new TypeError('Chaque identification manuelle doit préciser le contact et son identification.');
        }
        const recordIndex = entry.recordIndex;
        checkIndex(recordIndex);
        if (seen.has(recordIndex)) throw new TypeError('Un contact ne peut recevoir qu’une identification manuelle par lot.');
        seen.add(recordIndex);
        const manualId = manualLabel(entry.manualId);
        if (isUnresolvedLabel(manualId)) return { recordIndex, manualId: null, status: 'unresolved' };
        return { recordIndex, manualId, status: sameIdentity(autoIdFor(recordIndex), manualId) ? 'validated' : 'invalidated' };
      });
      const updatedAt = new Date().toISOString();
      const changes = [];
      const result = prepared.map(({ recordIndex, manualId, status }) => {
        const previous = decisions.get(recordIndex);
        if (previous && previous.status === status && previous.manualId === manualId) return previous;
        const decision = decisionFor(recordIndex, status, updatedAt, manualId);
        changes.push(decision);
        return decision;
      });
      for (const decision of changes) decisions.set(decision.recordIndex, decision);
      if (changes.length) persist();
      return Object.freeze(result);
    }

    function setManualId(recordIndex, value) {
      return setManualIds([{ recordIndex, manualId: value }])[0];
    }

    function setComment(recordIndex, value) {
      checkIndex(recordIndex);
      const text = commentText(value);
      if ((comments.get(recordIndex) || '') === text) return text;
      if (text === '') comments.delete(recordIndex);
      else comments.set(recordIndex, text);
      persist();
      return text;
    }

    return Object.freeze({
      get persistenceAvailable() { return persistenceAvailable; },
      get(recordIndex) {
        checkIndex(recordIndex);
        return decisions.get(recordIndex) || null;
      },
      set(recordIndex, status) {
        checkIndex(recordIndex);
        return setMany([recordIndex], status)[0];
      },
      setMany,
      setManualId,
      setManualIds,
      getComment(recordIndex) {
        checkIndex(recordIndex);
        return comments.get(recordIndex) || '';
      },
      setComment,
      snapshot
    });
  }

  return Object.freeze({ create, isComplete, isUnresolvedLabel, UNRESOLVED_LABEL, COMMENT_HEADER });
});
