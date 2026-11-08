(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./timeline-data.js'), require('./species.js'));
  else root.PlecotusContactContextData = factory(root.BatReviewCore, root.PlecotusTimelineData, root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, Timeline, Names) {
  'use strict';

  const cache = new WeakMap();
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const text = value => String(value == null ? '' : value);

  function manualIdentification(sourceManual, autoId, decision) {
    let label;
    if (decision == null) label = sourceManual;
    else {
      if (decision.status === 'unresolved') return { manualId: '', manualStatus: 'unresolved' };
      // A present null MANUAL ID explicitly removes an old source label. Only
      // binary reviews from older versions may confirm AUTO-ID without a field.
      label = own(decision, 'manualId') ? typeof decision.manualId === 'string' ? decision.manualId : ''
        : decision.status === 'validated' ? autoId.replace(/\s+/g, ' ').trim() : '';
    }
    if (Names.resolve(label).category === 'uncertain') return { manualId: '', manualStatus: 'unresolved' };
    if (label.trim()) return { manualId: label, manualStatus: 'identified' };
    return { manualId: '', manualStatus: decision == null ? 'unreviewed' : 'pending' };
  }

  function create(imported) {
    const previous = cache.get(imported);
    if (previous) return previous;
    const reader = Timeline.createTimestampReader(imported);
    const columns = Core.canonicalColumns(imported.headers);
    // Immutable source metadata and temporal order are cached once per import.
    // Decisions remain outside this index and are resolved on each get().
    const records = imported.records.map((record, recordIndex) => {
      const timestamp = reader.timestampFor(recordIndex);
      const field = key => columns[key] < 0 ? '' : text(record[columns[key]]);
      const sourceRow = imported.sourceRows && imported.sourceRows[recordIndex];
      return { recordIndex, timestamp,
        lineNumber: Number.isInteger(sourceRow) && sourceRow > 0 ? sourceRow : recordIndex + 2,
        fileName: field('file'), autoId: field('autoId'), ratio: field('ratio'), pulses: field('pulses'),
        sourceManual: field('manualId') };
    });
    const ordered = records.filter(record => record.timestamp !== null)
      .sort((left, right) => left.timestamp - right.timestamp || left.recordIndex - right.recordIndex);
    const positions = new Map(ordered.map((record, position) => [record.recordIndex, position]));
    const undatedCount = records.length - ordered.length;

    const model = Object.freeze({ get(recordIndex, getDecision) {
      if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= records.length) {
        throw new RangeError('Le numéro du contact de référence est invalide.');
      }
      if (getDecision != null && typeof getDecision !== 'function') {
        throw new TypeError('La lecture des décisions doit être une fonction.');
      }
      const reference = records[recordIndex];
      const referenceDated = reference.timestamp !== null;
      const position = positions.get(recordIndex);
      const first = referenceDated ? Math.max(0, position - 10) : 0;
      const last = referenceDated ? Math.min(ordered.length, position + 11) : 0;
      const selected = referenceDated ? ordered.slice(first, last) : [reference];
      return { rows: selected.map(record => {
        const { sourceManual, ...row } = record;
        return { ...row, ...manualIdentification(sourceManual, record.autoId,
          getDecision ? getDecision(record.recordIndex) : null), isReference: record.recordIndex === recordIndex };
      }), beforeCount: referenceDated ? position - first : 0,
      afterCount: referenceDated ? last - position - 1 : 0,
      undatedCount, referenceDated, missingColumns: reader.missingColumns.slice() };
    } });
    cache.set(imported, model);
    return model;
  }

  return Object.freeze({ create });
});
