(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.PlecotusTimelineData = factory(root.BatReviewCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';

  const HOUR = 3600000, DAY = HOUR * 24, INTERVAL = 600000, MAX_DENSE_BINS = 720;
  const text = value => String(value == null ? '' : value).trim();

  function calendarDate(year, month, day) {
    if (year < 1 || year > 9999) return null;
    // UTC is only a numerical representation of the source clock here. Never
    // apply the browser's timezone or daylight-saving rules to recording times.
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? date.getTime() : null;
  }

  function parseDate(value, excel, date1904) {
    const source = text(value);
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(source);
    if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    const european = /^(\d{1,2})([-/])(\d{1,2})\2(\d{2}|\d{4})$/.exec(source);
    if (european) {
      let year = Number(european[4]);
      if (european[4].length === 2) year += year < 70 ? 2000 : 1900;
      return calendarDate(year, Number(european[3]), Number(european[1]));
    }
    if (!excel) return null;
    const serial = Core.parseNumber(source);
    if (serial == null || serial > 2958465) return null;
    const whole = Math.floor(serial);
    // Excel's 1900 calendar contains a fictitious leap day at serial 60.
    if (!date1904 && whole === 60) return null;
    const date = date1904 ? Date.UTC(1904, 0, 1) + whole * DAY
      : Date.UTC(1899, 11, 31) + (whole > 60 ? whole - 1 : whole) * DAY;
    return new Date(date).getUTCFullYear() <= 9999 ? date : null;
  }

  function parseTime(value, excel) {
    const source = text(value);
    const clock = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?$/.exec(source);
    if (clock) {
      const hours = Number(clock[1]), minutes = Number(clock[2]), seconds = Number(clock[3] || 0);
      if (hours > 23 || minutes > 59 || seconds > 59) return null;
      // Truncate sub-millisecond text rather than rounding 23:59:59.9999 into
      // the next calendar day. The timestamp stays on its stated source day.
      const milliseconds = Number((clock[4] || '').slice(0, 3).padEnd(3, '0'));
      return hours * HOUR + minutes * 60000 + seconds * 1000 + milliseconds;
    }
    if (!excel) return null;
    const fraction = Core.parseNumber(source);
    if (fraction == null || fraction >= 1) return null;
    // Excel fractions can sit just below an exact hour through binary storage.
    // Round to milliseconds, while retaining values < 1 in their source day.
    return Math.min(DAY - 1, Math.round(fraction * DAY));
  }

  function createTimestampReader(imported) {
    if (!imported || !Array.isArray(imported.headers) || !Array.isArray(imported.records)) {
      throw new TypeError('La chronologie exige les en-têtes et les lignes du tableau importé.');
    }
    const columns = Core.canonicalColumns(imported.headers);
    const excel = imported.excelDates === true || imported.sheetName != null || /\.xlsx?$/i.test(imported.fileName || '');
    const missingColumns = Object.freeze([['date', 'DATE'], ['time', 'TIME']]
      .filter(([key]) => columns[key] < 0).map(([, label]) => label));
    return Object.freeze({ missingColumns, timestampFor(recordIndex) {
      if (!Number.isInteger(recordIndex) || recordIndex < 0 || recordIndex >= imported.records.length) {
        throw new RangeError('Le numéro du contact à dater est invalide.');
      }
      const record = imported.records[recordIndex];
      if (!Array.isArray(record) || record.length !== imported.headers.length) {
        throw new TypeError('Chaque contact de la chronologie doit conserver une cellule par en-tête du tableau.');
      }
      const date = columns.date < 0 ? null : parseDate(record[columns.date], excel, imported.excelDate1904 === true);
      const time = columns.time < 0 ? null : parseTime(record[columns.time], excel);
      return date == null || time == null ? null : date + time;
    } });
  }

  function build(imported) {
    const reader = createTimestampReader(imported);
    const columns = Core.canonicalColumns(imported.headers);
    const hasAutoId = columns.autoId >= 0;
    const missingColumns = reader.missingColumns.slice();
    const counts = new Map();
    let minimum = Infinity, maximum = -Infinity, total = 0, noiseCount = hasAutoId ? 0 : null, invalidDateTimeCount = 0;
    for (let recordIndex = 0; recordIndex < imported.records.length; recordIndex++) {
      const record = imported.records[recordIndex];
      if (!Array.isArray(record) || record.length !== imported.headers.length) {
        throw new TypeError('Chaque contact de la chronologie doit conserver une cellule par en-tête du tableau.');
      }
      if (hasAutoId && Core.normalizeAutoId(record[columns.autoId]).kind === 'noise') { noiseCount++; continue; }
      const timestamp = reader.timestampFor(recordIndex);
      if (timestamp == null) { invalidDateTimeCount++; continue; }
      const start = Math.floor(timestamp / INTERVAL) * INTERVAL;
      counts.set(start, (counts.get(start) || 0) + 1);
      minimum = Math.min(minimum, start);
      maximum = Math.max(maximum, start);
      total++;
    }
    const metadata = { total, sourceContacts: imported.records.length,
      noiseCount, invalidDateTimeCount, hasAutoId, missingColumns };
    if (!total) return { bins: [], intervalMs: INTERVAL, binCount: 0, sparse: false, ...metadata, start: null, end: null };
    const binCount = Math.round((maximum - minimum) / INTERVAL) + 1;
    const sparse = binCount > MAX_DENSE_BINS;
    const makeBin = start => ({ start, end: start + INTERVAL, contacts: counts.get(start) || 0 });
    let bins;
    if (!sparse) bins = Array.from({ length: binCount }, (_, index) => makeBin(minimum + index * INTERVAL));
    else {
      bins = [];
      let previous = null;
      for (const start of [...counts.keys()].sort((left, right) => left - right)) {
        if (previous !== null && start - previous > INTERVAL) {
          // Only the interior of empty runs is omitted. Two zero endpoints
          // keep the plotted line on the baseline across the real time gap.
          const firstZero = previous + INTERVAL, lastZero = start - INTERVAL;
          bins.push(makeBin(firstZero));
          if (lastZero !== firstZero) bins.push(makeBin(lastZero));
        }
        bins.push(makeBin(start));
        previous = start;
      }
    }
    return { bins, intervalMs: INTERVAL, binCount, sparse, ...metadata, start: minimum, end: maximum + INTERVAL };
  }

  return Object.freeze({ build, createTimestampReader });
});
