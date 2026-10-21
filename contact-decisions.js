(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), root);
  else root.PlecotusContactDecisions = factory(root.BatReviewCore, root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, root) {
  'use strict';

  const prefix = 'plecotus.review-decisions.v1.';
  const statuses = new Set(['validated', 'invalidated']);
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
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
    return { headers, records, sourceRows, columns,
      fileName: String(imported.fileName == null ? '' : imported.fileName),
      sheetName: imported.sheetName == null ? null : String(imported.sheetName) };
  }

  async function fingerprint(data, crypto) {
    try {
      if (!crypto || !crypto.subtle || typeof crypto.subtle.digest !== 'function') return null;
      const identity = JSON.stringify([data.fileName, data.sheetName, data.headers, data.records, data.sourceRows]);
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
      if (!hash || hash.byteLength !== 32) return null;
      return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    } catch { return null; }
  }

  async function create(imported, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Les options des décisions sont invalides.');
    const data = sourceData(imported);
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

    function decisionFor(recordIndex, status, updatedAt) {
      const record = data.records[recordIndex];
      const sourceAutoId = data.columns.autoId < 0 ? '' : String(record[data.columns.autoId] == null ? '' : record[data.columns.autoId]);
      return Object.freeze({ recordIndex, sourceRow: data.sourceRows[recordIndex], sourceAutoId,
        status, validated: status === 'validated',
        suggestedId: status === 'validated' && sourceAutoId.trim() ? sourceAutoId.trim() : null,
        updatedAt });
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
          const expected = decisionFor(item.recordIndex, item.status, item.updatedAt);
          if (item.sourceRow !== expected.sourceRow || item.sourceAutoId !== expected.sourceAutoId
            || item.validated !== expected.validated || item.suggestedId !== expected.suggestedId) return;
          restored.set(item.recordIndex, expected);
        }
        decisions = restored;
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
        .sort((left, right) => left.recordIndex - right.recordIndex).map(item => ({ ...item })) };
    }

    return Object.freeze({
      get persistenceAvailable() { return persistenceAvailable; },
      get(recordIndex) {
        checkIndex(recordIndex);
        return decisions.get(recordIndex) || null;
      },
      set(recordIndex, status) {
        checkIndex(recordIndex);
        if (!statuses.has(status)) throw new TypeError('Choisissez de valider ou d’invalider le contact.');
        const previous = decisions.get(recordIndex);
        if (previous && previous.status === status) return previous;
        const decision = decisionFor(recordIndex, status, new Date().toISOString());
        decisions.set(recordIndex, decision);
        if (persistenceAvailable) {
          try { storage.setItem(key, JSON.stringify(snapshot())); }
          catch { persistenceAvailable = false; }
        }
        return decision;
      },
      snapshot
    });
  }

  return Object.freeze({ create });
});
