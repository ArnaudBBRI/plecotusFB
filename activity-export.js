(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./activity-chart.js'));
  else root.BatActivityExport = factory(root.BatActivityChart);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Chart) {
  'use strict';

  const WIDTH = 1200, MAX_SIDE = 8192, MAX_PIXELS = 16000000;
  const counts = new Intl.NumberFormat('fr-BE');
  const percentages = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 });
  const escape = value => String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  // Hard-wrap even a single long CSV label. Conservative character limits fit
  // the column with common Unicode fonts; no row or legend is truncated.
  function wrap(value, limit) {
    const words = String(value).trim().split(/\s+/u), lines = [];
    let line = '';
    for (const word of words) {
      const chunks = Array.from(word);
      if (line && Array.from(line).length + 1 + chunks.length <= limit) {
        line += ' ' + word;
        continue;
      }
      if (line) { lines.push(line); line = ''; }
      while (chunks.length > limit) lines.push(chunks.splice(0, limit).join(''));
      line = chunks.join('');
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  // Conservative Arial widths let narrow Latin names use the whole column
  // while long words, capitals and Unicode labels still wrap before its edge.
  // This works in SVG downloads without needing a browser or a canvas.
  const letterWidths = {
    A: 10.1, B: 10.1, C: 10.9, D: 10.9, E: 10.1, F: 9.3, G: 11.8, H: 10.9,
    I: 4.3, J: 7.6, K: 10.1, L: 8.5, M: 12.7, N: 10.9, O: 11.8, P: 10.1,
    Q: 11.8, R: 10.9, S: 10.1, T: 9.3, U: 10.9, V: 10.1, W: 14.4, X: 10.1,
    Y: 10.1, Z: 9.3, a: 8.5, b: 8.5, c: 7.6, d: 8.5, e: 8.5, f: 4.3,
    g: 8.5, h: 8.5, i: 3.5, j: 3.5, k: 7.6, l: 3.5, m: 12.7, n: 8.5,
    o: 8.5, p: 8.5, q: 8.5, r: 5.1, s: 7.6, t: 4.3, u: 8.5, v: 7.6,
    w: 10.9, x: 7.6, y: 7.6, z: 7.6
  };

  function characterWidth(character, size) {
    if (/\p{Mark}/u.test(character)) return 0;
    const base = character.normalize('NFD')[0];
    let width = letterWidths[base];
    if (width == null) {
      if (/\s/u.test(character)) width = 4.5;
      else if (/[.,:;'’‘`!|]/u.test(character)) width = 4.5;
      else if (/[-/()[\]{}]/u.test(character)) width = 6;
      else if (/[0-9]/u.test(character)) width = 8.5;
      else width = 15.5;
    }
    return width * (size / 15) * 1.04;
  }

  function wrapWidth(value, width, size) {
    const words = String(value).trim().split(/\s+/u), lines = [];
    const measure = line => Array.from(line).reduce((total, character) => total + characterWidth(character, size), 0);
    let line = '';
    for (const word of words) {
      if (line && measure(line + ' ' + word) <= width) { line += ' ' + word; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of Array.from(word)) {
        if (line && measure(line + character) > width) { lines.push(line); line = ''; }
        line += character;
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  }

  function text(x, y, value, size, attributes) {
    return `<text x="${x}" y="${y}" font-size="${size || 15}"${attributes ? ' ' + attributes : ''}>${escape(value)}</text>`;
  }

  function metadata(options, total) {
    const automatic = options.source === 'auto-id';
    const unknownNoise = automatic && options.hasAutoId === false;
    const details = [`${counts.format(total)} contacts représentés${unknownNoise ? '' : ' (hors Noise)'}.`];
    const counters = [];
    for (const [key, label] of [['ignoredNoise', 'Noise ignorés'], ['totalContacts', 'contacts dans le fichier'], ['pendingContacts', 'contacts en attente de classification']]) {
      if (options[key] == null) continue;
      if (typeof options[key] !== 'number' || !Number.isFinite(options[key]) || options[key] < 0) {
        throw new RangeError('Les compteurs du graphique doivent être des nombres positifs ou nuls.');
      }
      counters.push(`${counts.format(options[key])} ${label}`);
    }
    if (options.noiseContacts != null) {
      if (typeof options.noiseContacts !== 'number' || !Number.isFinite(options.noiseContacts) || options.noiseContacts < 0) {
        throw new RangeError('Les compteurs du graphique doivent être des nombres positifs ou nuls.');
      }
      if (!unknownNoise) counters.push(`${counts.format(options.noiseContacts)} contacts Noise exclus (AUTO-ID)`);
    }
    if (counters.length) details.push(counters.join(' · '));
    const legendFilter = [];
    for (const [key, singular, plural] of [
      ['hiddenCategories', 'catégorie masquée', 'catégories masquées'],
      ['hiddenContacts', 'contact masqué', 'contacts masqués']
    ]) {
      const count = options[key];
      if (count == null) continue;
      if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
        throw new RangeError('Les compteurs du filtre de légende doivent être des nombres positifs ou nuls.');
      }
      if (count > 0) legendFilter.push(`${counts.format(count)} ${count === 1 ? singular : plural}`);
    }
    if (legendFilter.length) details.push('Filtre de légende : ' + legendFilter.join(' · ') + '.');
    if (options.excludedCommonPipistrelle != null) {
      if (typeof options.excludedCommonPipistrelle !== 'number' || !Number.isFinite(options.excludedCommonPipistrelle) || options.excludedCommonPipistrelle < 0) {
        throw new RangeError('Le nombre de contacts exclus doit être un nombre positif ou nul.');
      }
      details.push(`Pipistrelle commune exclue du graphique : ${counts.format(options.excludedCommonPipistrelle)} contacts.`);
    }
    if (automatic) {
      details.push(unknownNoise
        ? 'Colonne AUTO-ID absente : identification automatique et nombre de Noise non disponibles.'
        : 'Répartition selon les suggestions automatiques AUTO-ID, avant vérification manuelle.');
    } else {
      details.push(options.provisional || options.pendingContacts > 0
        ? 'Bilan provisoire : la classification comporte encore des contacts en attente.'
        : 'Bilan final.');
    }
    return details;
  }

  function labels(row, limit) {
    const scientific = row.scientificName || row.frenchName || 'Identification non renseignée';
    return [
      ...wrap(scientific, limit).map(value => ({ value, scientific: true })),
      ...(row.scientificName && row.frenchName ? wrap(row.frenchName, limit).map(value => ({ value, scientific: false })) : [])
    ];
  }

  function tooltip(row) {
    return `${row.scientificName || row.frenchName} : ${counts.format(row.contacts)} contacts (${percentages.format(row.percentage)} %)`;
  }

  function rowLabels(row, lines, x, y, lineHeight) {
    return lines.map((line, index) => text(x, y + index * (lineHeight || 22), line.value, line.scientific ? 15 : 14,
      `${line.scientific && row.isSpecies ? 'font-style="italic" ' : ''}fill="${line.scientific ? '#17352e' : '#607269'}"`)).join('');
  }

  function pie(data, top, options) {
    const compact = data.rows.length > 8;
    const parts = [], cx = compact ? WIDTH / 2 : 220, cy = top + (compact ? 176 : 198), radius = 164;
    if (data.rows.length === 1) {
      parts.push(`<circle data-series="0" cx="${cx}" cy="${cy}" r="${radius}" fill="${data.rows[0].color}"><title>${escape(tooltip(data.rows[0]))}</title></circle>`);
    } else {
      let angle = -Math.PI / 2;
      data.rows.forEach((row, index) => {
        const end = index === data.rows.length - 1 ? Math.PI * 1.5 : angle + row.proportion * Math.PI * 2;
        const path = `M ${cx} ${cy} L ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} A ${radius} ${radius} 0 ${end - angle > Math.PI ? 1 : 0} 1 ${cx + radius * Math.cos(end)} ${cy + radius * Math.sin(end)} Z`;
        parts.push(`<path data-series="${index}" d="${path}" fill="${row.color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"><title>${escape(tooltip(row))}</title></path>`);
        angle = end;
      });
    }
    const caption = options.source === 'auto-id' && options.hasAutoId === false ? 'Répartition des contacts importés' : 'Répartition hors Noise';
    parts.push(text(cx, cy + radius + 34, caption, 14, 'text-anchor="middle" fill="#607269"'));
    if (compact) {
      const columns = 3, gap = 26, columnWidth = (1120 - gap * (columns - 1)) / columns;
      let y = top + 414;
      parts.push('<g data-legend-layout="grid">');
      for (let start = 0; start < data.rows.length; start += columns) {
        const entries = data.rows.slice(start, start + columns).map(row => {
          const scientific = row.scientificName || row.frenchName || 'Identification non renseignée';
          return { row, lines: [
            ...wrapWidth(scientific, columnWidth - 36, 15).map(value => ({ value, scientific: true })),
            ...(row.scientificName && row.frenchName ? wrapWidth(row.frenchName, columnWidth - 36, 14).map(value => ({ value, scientific: false })) : [])
          ] };
        });
        for (const [column, entry] of entries.entries()) {
          const { row, lines } = entry, x = 40 + column * (columnWidth + gap);
          parts.push(`<g data-legend="${escape(row.scientificName || row.frenchName)}" data-legend-row="${start / columns}" data-legend-column="${column}"><rect x="${x}" y="${y - 13}" width="16" height="16" rx="3" fill="${row.color}"/>${rowLabels(row, lines, x + 28, y, 20)}`);
          parts.push(text(x + 28, y + lines.length * 20 + 2, `${counts.format(row.contacts)} contacts · ${percentages.format(row.percentage)} %`, 14, 'font-weight="700"'));
          parts.push('</g>');
        }
        y += Math.max(...entries.map(entry => entry.lines.length)) * 20 + 30;
      }
      parts.push('</g>');
      return { parts, bottom: y };
    }
    let y = top + 25;
    for (const row of data.rows) {
      const lines = labels(row, 34);
      parts.push(`<g data-legend="${escape(row.scientificName || row.frenchName)}"><rect x="442" y="${y - 13}" width="16" height="16" rx="3" fill="${row.color}"/>${rowLabels(row, lines, 476, y)}`);
      parts.push(text(1160, y, counts.format(row.contacts), 16, 'text-anchor="end" font-weight="700"'));
      parts.push(text(1160, y + 22, `${percentages.format(row.percentage)} %`, 14, 'text-anchor="end" fill="#607269"'));
      parts.push('</g>');
      y += Math.max(2, lines.length) * 22 + 22;
    }
    return { parts, bottom: Math.max(top + 425, y) };
  }

  function bars(data, top) {
    const parts = [];
    let y = top + 23;
    for (const [index, row] of data.rows.entries()) {
      const lines = labels(row, 53);
      parts.push(`<g data-legend="${escape(row.scientificName || row.frenchName)}"><rect x="40" y="${y - 13}" width="16" height="16" rx="3" fill="${row.color}"/>${rowLabels(row, lines, 74, y)}`);
      parts.push(text(1160, y, `${counts.format(row.contacts)} contacts · ${percentages.format(row.percentage)} %`, 15, 'text-anchor="end" font-weight="700"'));
      y += lines.length * 22;
      parts.push(`<rect x="40" y="${y}" width="1120" height="17" rx="4" fill="#edf2ef"/>`);
      parts.push(`<rect data-series="${index}" x="40" y="${y}" width="${1120 * row.proportion}" height="17" rx="4" fill="${row.color}"><title>${escape(tooltip(row))}</title></rect></g>`);
      y += 45;
    }
    return { parts, bottom: y };
  }

  function svg(rows, mode, options) {
    options = options || {};
    const data = Chart.prepare(rows), parts = [];
    const title = options.title || 'Répartition des contacts par espèce';
    let y = 54;
    for (const line of wrap(title, 38)) { parts.push(text(40, y, line, 28, 'font-weight="700"')); y += 34; }
    parts.push(text(40, y, mode === 'bar' ? 'Graphique en barres' : 'Camembert', 15, 'fill="#607269"')); y += 28;
    const details = metadata(options, data.total);
    for (const line of details.flatMap(value => wrap(value, 74))) {
      parts.push(text(40, y, line, 14, 'fill="#607269"')); y += 22;
    }
    y += 22;
    if (data.total) {
      const chart = mode === 'bar' ? bars(data, y) : pie(data, y, options);
      parts.push(...chart.parts); y = chart.bottom;
    } else {
      parts.push(text(40, y + 24, 'Aucun contact attribué à une espèce à afficher.', 16));
      y += 72;
    }
    const width = WIDTH, height = Math.ceil(y + 32);
    const description = [...details, ...data.rows.map(tooltip)].join(' ');
    return { width, height, svg: `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="activity-export-title activity-export-description"><title id="activity-export-title">${escape(title)}</title><desc id="activity-export-description">${escape(description)}</desc><rect width="${width}" height="${height}" fill="#fff"/><g font-family="Arial, Helvetica, sans-serif" fill="#17352e">${parts.join('')}</g></svg>` };
  }

  function formatInfo(format) {
    const name = String(format || 'svg').toLowerCase();
    if (name === 'svg') return { extension: 'svg', mimeType: 'image/svg+xml' };
    if (name === 'png') return { extension: 'png', mimeType: 'image/png' };
    if (name === 'jpeg' || name === 'jpg') return { extension: 'jpeg', mimeType: 'image/jpeg' };
    throw new RangeError('Format image non pris en charge. Choisissez PNG, JPEG ou SVG.');
  }

  async function rasterize(source, format, options) {
    const info = formatInfo(format);
    if (!source || typeof source.svg !== 'string' || !Number.isFinite(source.width) || !Number.isFinite(source.height) || source.width <= 0 || source.height <= 0) {
      throw new TypeError('Les dimensions du graphique à exporter sont invalides.');
    }
    if (info.extension === 'svg') return { ...source, ...info, blob: new Blob([source.svg], { type: info.mimeType }) };
    if (typeof document === 'undefined' || typeof Image === 'undefined' || !URL.createObjectURL) {
      throw new Error('L’export PNG ou JPEG nécessite un navigateur. Le format SVG reste disponible.');
    }
    const quality = options && options.quality != null ? options.quality : 0.92;
    if (typeof quality !== 'number' || !Number.isFinite(quality) || quality < 0 || quality > 1) throw new RangeError('La qualité JPEG doit être comprise entre 0 et 1.');
    const scale = Math.min(1, MAX_SIDE / source.width, MAX_SIDE / source.height, Math.sqrt(MAX_PIXELS / (source.width * source.height)));
    const width = Math.max(1, Math.floor(source.width * scale)), height = Math.max(1, Math.floor(source.height * scale));
    const url = URL.createObjectURL(new Blob([source.svg], { type: 'image/svg+xml' }));
    let picture, canvas;
    try {
      picture = new Image();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('La préparation du graphique a pris trop de temps. Essayez le format SVG.')), 30000);
        picture.onload = () => { clearTimeout(timer); resolve(); };
        picture.onerror = () => { clearTimeout(timer); reject(new Error('Le graphique ne peut pas être converti en image. Essayez le format SVG.')); };
        try { picture.src = url; } catch (error) { clearTimeout(timer); reject(error); }
      });
      canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context || !canvas.toBlob) throw new Error('L’export image n’est pas disponible dans ce navigateur. Essayez le format SVG.');
      context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
      context.drawImage(picture, 0, 0, width, height);
      const blob = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('L’export image a pris trop de temps. Essayez le format SVG.')), 30000);
        try {
          canvas.toBlob(value => {
            clearTimeout(timer);
            if (!value) reject(new Error('L’export image a échoué. Essayez le format SVG.'));
            else resolve(value);
          }, info.mimeType, quality);
        } catch (error) { clearTimeout(timer); reject(error); }
      });
      if (blob.type !== info.mimeType) throw new Error('Ce navigateur ne prend pas en charge ce format image. Essayez PNG ou SVG.');
      return { blob, ...info, width, height };
    } finally {
      URL.revokeObjectURL(url);
      if (picture) { picture.onload = null; picture.onerror = null; picture.src = ''; }
      if (canvas) { canvas.width = 1; canvas.height = 1; }
    }
  }

  async function exportBlob(rows, mode, format, options) {
    return rasterize(svg(rows, mode, options), format, options);
  }

  return Object.freeze({ svg, rasterize, exportBlob });
});
