(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlecotusTimelineChart = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const counts = new Intl.NumberFormat('fr-FR');
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g,
    character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const count = value => counts.format(value) + (value === 1 ? ' contact' : ' contacts');
  const pad = value => String(value).padStart(2, '0');
  let nextGradientId = 0;

  // These are synthetic UTC milliseconds carrying the source wall clock. UTC
  // accessors preserve it, independently of browser timezone or summer time.
  function clock(timestamp) {
    const date = new Date(timestamp);
    return pad(date.getUTCDate()) + '/' + pad(date.getUTCMonth() + 1) + '/' + date.getUTCFullYear()
      + ' ' + pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes());
  }

  function validate(data) {
    if (!data || !Array.isArray(data.bins) || !Number.isFinite(data.intervalMs) || data.intervalMs <= 0
      || data.sparse !== undefined && typeof data.sparse !== 'boolean') {
      throw new TypeError('La chronologie exige des intervalles de temps valides.');
    }
    let sum = 0, previous = null;
    for (const bin of data.bins) {
      if (!bin || !Number.isInteger(bin.start) || !Number.isInteger(bin.end)
        || Math.abs(bin.start) > 8640000000000000 || Math.abs(bin.end) > 8640000000000000
        || bin.end - bin.start !== data.intervalMs || !Number.isSafeInteger(bin.contacts) || bin.contacts < 0
        || (bin.start - data.bins[0].start) % data.intervalMs !== 0
        || previous && (bin.start < previous.end || bin.start > previous.end
          && (data.sparse !== true || previous.contacts !== 0 || bin.contacts !== 0))) {
        throw new TypeError('Un intervalle de la chronologie est invalide.');
      }
      sum += bin.contacts;
      previous = bin;
    }
    if (!Number.isSafeInteger(data.total) || data.total < 0 || data.total !== sum) {
      throw new TypeError('Le total de la chronologie ne correspond pas à ses intervalles.');
    }
    const binCount = data.bins.length ? (data.bins.at(-1).end - data.bins[0].start) / data.intervalMs : 0;
    if (data.binCount !== undefined && (!Number.isSafeInteger(data.binCount) || data.binCount !== binCount)) {
      throw new TypeError('Le nombre d’intervalles de la chronologie est invalide.');
    }
    return data;
  }

  function intervalLabel(bin) {
    return 'Du ' + clock(bin.start) + ' au ' + clock(bin.end) + ' (fin exclue) : ' + count(bin.contacts) + '.';
  }

  function intervalText(milliseconds) {
    const hours = milliseconds / 3600000;
    return Number.isInteger(hours) ? counts.format(hours) + ' h' : counts.format(milliseconds / 60000) + ' min';
  }

  function caption(data) {
    validate(data);
    const parts = [data.bins.length
      ? count(data.total) + (data.total === 1 ? ' daté, du ' : ' datés, du ') + clock(data.bins[0].start) + ' au ' + clock(data.bins.at(-1).end)
        + ' (fin exclue). Intervalles de ' + intervalText(data.intervalMs) + '.'
      : 'Aucun contact avec date et heure valides à représenter.'];
    if (data.missingColumns?.length) parts.push('Colonnes absentes : ' + data.missingColumns.join(', ') + '.');
    if (data.sparse && data.binCount > data.bins.length) {
      parts.push('Les longues plages à zéro sont tracées à partir de leurs bornes, sans regrouper les intervalles.');
    }
    if (data.hasAutoId === false) parts.push('Colonne AUTO-ID absente : le bruit ne peut pas être exclu.');
    else parts.push(count(data.noiseCount || 0) + ' Noise ' + (data.noiseCount === 1 ? 'exclu' : 'exclus') + ' (AUTO-ID source).');
    parts.push(count(data.invalidDateTimeCount || 0) + (data.invalidDateTimeCount === 1 ? ' exclu' : ' exclus') + ' pour date ou heure absente ou invalide.');
    parts.push('Dates et heures du fichier, sans conversion de fuseau horaire.');
    parts.push('Un intervalle à zéro signifie zéro contact dans le fichier ; il ne prouve pas un enregistrement continu.');
    return parts.join(' ');
  }

  function wrap(value, maximum) {
    const lines = [];
    let line = '';
    for (const word of String(value).split(/\s+/u)) {
      if (line && line.length + word.length + 1 > maximum) { lines.push(line); line = ''; }
      const characters = Array.from(word);
      while (characters.length > maximum) {
        if (line) { lines.push(line); line = ''; }
        lines.push(characters.splice(0, maximum).join(''));
      }
      const rest = characters.join('');
      if (rest) line += (line ? ' ' : '') + rest;
    }
    if (line) lines.push(line);
    return lines;
  }

  function axis(maximum) {
    const target = Math.max(1, maximum / 4);
    const power = 10 ** Math.floor(Math.log10(target));
    const step = Math.max(1, [1, 2, 5, 10].find(value => value * power >= target) * power);
    const upper = Math.max(step, Math.ceil(maximum / step) * step);
    const ticks = [];
    for (let value = 0; value <= upper; value += step) ticks.push(value);
    return { upper, ticks };
  }

  function svg(data, options = {}) {
    validate(data);
    const width = Math.min(1600, Math.max(560, Number.isFinite(options.width) ? options.width : 960));
    const title = String(options.title || 'Contacts au fil du temps');
    const note = caption(data);
    const embedded = options.embedded === true;
    const lines = embedded ? [] : wrap(note, Math.floor((width - 80) / 7));
    const fileLines = !embedded && options.fileName ? wrap('Fichier : ' + options.fileName, Math.floor((width - 80) / 7)) : [];
    const top = embedded ? 32 : 80 + fileLines.length * 16, baseline = top + 235;
    const noteTop = baseline + 74, height = embedded ? baseline + 58 : noteTop + lines.length * 16 + 22;
    const left = 68, right = width - 28;
    const text = (x, y, value, attributes = '') => '<text x="' + x + '" y="' + y + '" ' + attributes + '>' + escape(value) + '</text>';
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" class="timeline-svg" width="' + width + '" height="' + height
      + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + escape(title)
      + '" font-family="Segoe UI,Arial,sans-serif"><title>' + escape(title) + '</title><desc>'
      + escape(note) + ' Axe des effectifs à partir de zéro.</desc><rect width="100%" height="100%" fill="#fff"/>'];
    if (!embedded) parts.push(text(28, 31, title, 'font-size="20" font-weight="600" fill="#30432c"'));
    fileLines.forEach((line, index) => parts.push(text(28, 52 + index * 16, line, 'font-size="12" fill="#66715f"')));
    if (!data.bins.length) parts.push(text(width / 2, top + 118, 'Aucun contact avec date et heure valides à représenter.',
      'text-anchor="middle" font-size="14" fill="#66715f"'));
    else {
      const scale = axis(data.bins.reduce((maximum, bin) => Math.max(maximum, bin.contacts), 0));
      parts.push(text(left, top - 14, 'Contacts', 'font-size="12" fill="#66715f"'));
      for (const value of scale.ticks) {
        const y = baseline - value / scale.upper * (baseline - top);
        parts.push('<line x1="' + left + '" x2="' + right + '" y1="' + y + '" y2="' + y + '" stroke="#e3e9df"/>',
          text(left - 10, y + 4, counts.format(value), 'class="timeline-y-tick" text-anchor="end" font-size="12" fill="#66715f"'));
      }
      const first = data.bins[0].start, last = data.bins.at(-1).start;
      const points = data.bins.map(bin => ({ bin, x: last === first ? (left + right) / 2 : left + (bin.start - first) / (last - first) * (right - left),
        y: baseline - bin.contacts / scale.upper * (baseline - top) }));
      const line = points.map(({ x, y }, index) => (index ? 'L ' : 'M ') + x + ' ' + y).join(' ');
      const area = line + ' L ' + points.at(-1).x + ' ' + baseline + ' L ' + points[0].x + ' ' + baseline + ' Z';
      const gradientId = 'timeline-area-gradient-' + (++nextGradientId);
      const areaTop = points.reduce((minimum, point) => Math.min(minimum, point.y), baseline);
      parts.push('<defs><linearGradient id="' + gradientId + '" gradientUnits="userSpaceOnUse" x1="0" y1="' + baseline
        + '" x2="0" y2="' + (areaTop < baseline ? areaTop : top) + '"><stop offset="0%" stop-color="#C3C975"/>'
        + '<stop offset="100%" stop-color="#7bc0e1"/></linearGradient></defs>',
        '<path d="' + area + '" fill="url(#' + gradientId + ')"/>',
        '<path d="' + line + '" fill="none" stroke="#3c6844" stroke-width="2.3" stroke-linejoin="round"/>',
        '<path d="M ' + left + ' ' + top + ' V ' + baseline + ' H ' + right + '" fill="none" stroke="#68765f"/>');
      const span = Math.round((last - first) / data.intervalMs);
      const tickCount = Math.min(6, span + 1);
      for (let index = 0; index < tickCount; index++) {
        const position = tickCount === 1 ? 0 : Math.round(index * span / (tickCount - 1));
        const timestamp = first + position * data.intervalMs;
        const x = last === first ? (left + right) / 2 : left + (timestamp - first) / (last - first) * (right - left);
        const label = clock(timestamp).split(' ');
        const anchor = tickCount === 1 ? 'middle' : index === 0 ? 'start' : index === tickCount - 1 ? 'end' : 'middle';
        parts.push('<text class="timeline-x-tick" x="' + x + '" y="' + (baseline + 23) + '" text-anchor="' + anchor
          + '" font-size="11" fill="#66715f"><tspan x="' + x + '">' + escape(label[0])
          + '</tspan><tspan x="' + x + '" dy="16">' + label[1] + '</tspan></text>');
      }
      points.forEach(({ bin, x, y }, index) => parts.push('<circle class="timeline-data-point" cx="' + x + '" cy="' + y
        + '" r="3" fill="#3c6844" stroke="#fff" stroke-width="1" tabindex="0" data-timeline-index="' + index
        + '" aria-label="' + escape(intervalLabel(bin)) + '"><title>' + escape(intervalLabel(bin)) + '</title></circle>'));
    }
    lines.forEach((line, index) => parts.push(text(28, noteTop + index * 16, line, 'font-size="12" fill="#66715f"')));
    parts.push('</svg>');
    return { svg: parts.join(''), width, height };
  }

  function render(data, options) {
    return '<div class="timeline-scroll" role="region" tabindex="0" aria-label="Chronologie des contacts, défilement horizontal si nécessaire">'
      + svg(data, { ...options, embedded: true }).svg + '</div>';
  }

  return Object.freeze({ svg, render, caption, intervalLabel });
});
