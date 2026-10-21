(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'), require('./activity-export.js'));
  else root.PlecotusFinalSummaryVisuals = factory(root.BatReviewCore, root.BatActivityExport);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, ImageExport) {
  'use strict';

  const numbers = new Intl.NumberFormat('fr-FR');
  const headers = Object.freeze(['Nom scientifique', 'Nom vernaculaire', 'Nombre de contacts']);
  const colors = Object.freeze({ before: '#bf8a4a', after: '#1b7663' });
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const label = value => String(value == null ? '' : value);
  const escape = value => label(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const text = (x, y, value, attributes = '') => `<text x="${x}" y="${y}" ${attributes}>${escape(value)}</text>`;

  function checkedRows(rows, keys) {
    if (!Array.isArray(rows)) throw new TypeError('Les résultats à représenter doivent être une liste.');
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!own(rows, index) || !row || typeof row !== 'object' || Array.isArray(row)
        || keys.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)) {
        throw new TypeError('Chaque effectif du récapitulatif doit être un entier positif ou nul.');
      }
    }
    return rows;
  }

  // Estimate Arial glyph widths conservatively so table cells wrap in a plain
  // exported SVG, without a browser measurement or any external font request.
  function widthOf(value, size = 15) {
    let width = 0;
    for (const character of Array.from(value)) {
      if (/\p{Mark}/u.test(character)) continue;
      const base = character.normalize('NFD')[0];
      width += /[ilI.,:;'’!|]/.test(base) ? .3 : /[mwMW@]/.test(base) ? .95
        : /[A-Z0-9]/.test(base) ? .72 : /[a-z]/.test(base) ? .6 : /\s/.test(base) ? .35 : 1;
    }
    return width * size;
  }

  function wrap(value, maxWidth, size = 15) {
    const words = label(value).trim().split(/\s+/u), lines = [];
    let line = '';
    for (const word of words) {
      if (line && widthOf(line + ' ' + word, size) <= maxWidth) { line += ' ' + word; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of Array.from(word)) {
        if (line && widthOf(line + character, size) > maxWidth) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function sourceSvg(width, height, title, description, content, id) {
    return { width, height, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-description"><title id="${id}-title">${escape(title)}</title><desc id="${id}-description">${escape(description)}</desc><rect width="${width}" height="${height}" fill="#fff"/><g font-family="Arial, Helvetica, sans-serif" font-size="15" fill="#263b31">${content.join('')}</g></svg>` };
  }

  function comparisonSvg(input, options = {}) {
    const rows = checkedRows(input, ['before', 'after']);
    const title = options.title || 'Nombre de contacts par espèce · avant / après';
    const maximum = Math.max(0, ...rows.flatMap(row => [row.before, row.after]));
    const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, maximum / 4))));
    const step = Math.max(1, [1, 2, 5, 10].map(value => value * magnitude).find(value => value >= maximum / 4));
    const upper = Math.max(step, Math.ceil(maximum / step) * step);
    const left = Math.max(68, widthOf(numbers.format(upper), 12) + 28), right = 30;
    const groupWidth = Math.max(100, widthOf(numbers.format(maximum), 12) * 2 + 34);
    const width = Math.ceil(Math.max(900, left + right + Math.max(1, rows.length) * groupWidth));
    const titleLines = wrap(title, width - 64, 24);
    const top = 76 + titleLines.length * 28, plotHeight = 300, baseline = top + plotHeight;
    const availableWidth = width - left - right, slot = availableWidth / Math.max(1, rows.length);
    const barWidth = Math.min(30, slot * .27), gap = 8;
    const labels = rows.map(row => wrap(row.code || row.scientificName || row.frenchName || 'Sans identification', slot - 12, 12));
    const labelHeight = Math.max(1, ...labels.map(lines => lines.length)) * 17;
    const height = Math.ceil(baseline + 30 + labelHeight + 30);
    const parts = titleLines.map((line, index) => text(32, 38 + index * 28, line, 'font-size="24" font-weight="600"'));
    const legendY = top - 33;
    parts.push(`<rect x="${left}" y="${legendY - 12}" width="13" height="13" rx="2" fill="${colors.before}"/>`,
      text(left + 21, legendY, 'Avant · AUTO-ID', 'font-size="13"'),
      `<rect x="${left + 180}" y="${legendY - 12}" width="13" height="13" rx="2" fill="${colors.after}"/>`,
      text(left + 201, legendY, 'Après · vérification manuelle', 'font-size="13"'));
    parts.push(text(left, top - 9, 'Contacts', 'font-size="12" fill="#677066"'));
    for (let tick = 0; tick <= Math.round(upper / step); tick++) {
      const value = tick * step, y = baseline - value / upper * plotHeight;
      parts.push(`<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="${value ? '#e8ece5' : '#788174'}" stroke-width="1"/>`,
        text(left - 12, y + 4, numbers.format(value), 'text-anchor="end" font-size="12" fill="#677066"'));
    }
    parts.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${baseline}" stroke="#788174" stroke-width="1"/>`);
    rows.forEach((row, index) => {
      const centre = left + slot * (index + .5);
      const names = [row.scientificName, row.frenchName].filter(Boolean).join(' · ');
      const tooltip = (names || row.code || 'Sans identification') + ' : avant ' + numbers.format(row.before)
        + ' ; après ' + numbers.format(row.after) + ' contacts';
      for (const [series, x] of [['before', centre - gap / 2 - barWidth], ['after', centre + gap / 2]]) {
        const value = row[series], barHeight = value / upper * plotHeight, y = baseline - barHeight;
        parts.push(`<g data-comparison-key="${escape(row.key || row.code || row.scientificName || index)}" data-series="${series}"><title>${escape(tooltip)}</title><rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${colors[series]}"/>`,
          text(x + barWidth / 2, y - 7, numbers.format(value), 'text-anchor="middle" font-size="12" font-weight="600"'), '</g>');
      }
      parts.push(`<g><title>${escape(names || row.code)}</title>`);
      labels[index].forEach((line, lineIndex) => parts.push(text(centre, baseline + 25 + lineIndex * 17, line, 'text-anchor="middle" font-size="12"')));
      parts.push('</g>');
    });
    if (!rows.length) parts.push(text(left + availableWidth / 2, top + plotHeight / 2, 'Aucun contact hors bruit à représenter.', 'text-anchor="middle" font-size="16"'));
    const description = 'Barres groupées, axe des effectifs à partir de zéro. '
      + rows.map(row => `${row.scientificName || row.frenchName || row.code} : avant ${row.before}, après ${row.after} contacts`).join(' ; ');
    return sourceSvg(width, height, title, description, parts, 'final-comparison');
  }

  function csv(input) {
    const rows = checkedRows(input, ['contacts']);
    return '\ufeff' + Core.stringifyCSV(headers, rows.map(row => [Core.spreadsheetSafe(row.scientificName),
      Core.spreadsheetSafe(row.frenchName), row.contacts]), ';');
  }

  function tableSvg(input, options = {}) {
    const rows = checkedRows(input, ['contacts']);
    const width = 1200, left = 32, right = width - 32, first = 32, second = 494, numeric = 1168;
    const title = options.title || 'Contacts après vérification manuelle';
    let y = 45;
    const parts = [];
    for (const line of wrap(title, width - 64, 25)) { parts.push(text(left, y, line, 'font-size="25" font-weight="600"')); y += 32; }
    const total = rows.reduce((sum, row) => sum + row.contacts, 0);
    if (!Number.isSafeInteger(total)) throw new RangeError('Le total du tableau est trop élevé.');
    for (const line of wrap((options.fileName ? options.fileName + ' · ' : '') + numbers.format(total) + ' contacts hors bruit · identifications finales, y compris les attributions calculées', width - 64, 14)) {
      parts.push(text(left, y + 3, line, 'font-size="14" fill="#677066"')); y += 23;
    }
    y += 15;
    parts.push(`<rect x="${left}" y="${y}" width="${right - left}" height="45" fill="#f1f4ed"/>`,
      text(first + 12, y + 28, headers[0], 'font-weight="600"'),
      text(second + 12, y + 28, headers[1], 'font-weight="600"'),
      text(numeric - 12, y + 28, headers[2], 'text-anchor="end" font-weight="600"'));
    y += 45;
    rows.forEach((row, index) => {
      const scientific = wrap(row.scientificName || 'Identification non renseignée', 438, 15);
      const french = wrap(row.frenchName || 'Nom non renseigné', 438, 15);
      const rowHeight = Math.max(scientific.length, french.length) * 22 + 24;
      parts.push(`<g data-table-row="${index}"><rect x="${left}" y="${y}" width="${right - left}" height="${rowHeight}" fill="${index % 2 ? '#f9faf7' : '#fff'}"/>`);
      scientific.forEach((line, lineIndex) => parts.push(text(first + 12, y + 28 + lineIndex * 22, line, row.isSpecies ? 'font-style="italic"' : '')));
      french.forEach((line, lineIndex) => parts.push(text(second + 12, y + 28 + lineIndex * 22, line)));
      parts.push(text(numeric - 12, y + 28, numbers.format(row.contacts), 'text-anchor="end" font-weight="600"'),
        `<line x1="${left}" y1="${y + rowHeight}" x2="${right}" y2="${y + rowHeight}" stroke="#e5e9df" stroke-width="1"/></g>`);
      y += rowHeight;
    });
    if (!rows.length) { parts.push(text(left + 12, y + 30, 'Aucun contact hors bruit.')); y += 56; }
    y += 32;
    return sourceSvg(width, Math.ceil(y), title,
      `${rows.length} espèces ou catégories, ${total} contacts hors bruit. ` + rows.map(row => `${row.scientificName} · ${row.frenchName} : ${row.contacts}`).join(' ; '), parts, 'final-table');
  }

  function exportTable(rows, format, options) { return ImageExport.rasterize(tableSvg(rows, options), format, options); }
  function exportComparison(rows, format, options) { return ImageExport.rasterize(comparisonSvg(rows, options), format, options); }
  return Object.freeze({ comparisonSvg, tableSvg, csv, exportTable, exportComparison, COLORS: colors });
});
