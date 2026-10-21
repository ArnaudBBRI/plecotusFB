(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BatActivityChart = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PALETTE = Object.freeze([
    '#1b7663', '#d78631', '#6284b5', '#a15b82', '#8a9b44', '#6c63a5',
    '#c6654f', '#4c9ea5', '#927645', '#ac82b0', '#447ab0', '#8b613d',
    '#9b3862', '#79964d', '#805bb3', '#cd984b', '#466a73', '#a84e41',
    '#787aab', '#418468'
  ]);
  const countFormat = new Intl.NumberFormat('fr-BE');
  const percentageFormat = new Intl.NumberFormat('fr-BE', { maximumFractionDigits: 1 });
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const compareNames = (left, right) => left === right ? 0 : left < right ? -1 : 1;
  const safeColor = color => typeof color === 'string' && (/^#[0-9a-f]{6}$/i.test(color) || /^hsl\(\d+(?:\.\d+)? \d+(?:\.\d+)?% \d+(?:\.\d+)?%\)$/.test(color));

  function rowKey(row) {
    return JSON.stringify([
      String(row.scientificName == null ? '' : row.scientificName).trim(),
      String(row.frenchName == null ? '' : row.frenchName).trim()
    ]);
  }

  function prepare(input) {
    if (input == null) input = [];
    if (!Array.isArray(input)) throw new TypeError('Les données du graphique doivent être une liste.');
    const rows = [];
    for (const source of input) {
      if (!source || typeof source !== 'object') throw new TypeError('Une ligne du graphique est invalide.');
      const scientificName = String(source.scientificName == null ? '' : source.scientificName).trim();
      const frenchName = String(source.frenchName == null ? '' : source.frenchName).trim();
      // The caller supplies the final activity table. This guard also prevents
      // a mistakenly supplied noise row from entering its count denominator.
      if (source.category === 'noise' || /^(noise|bruit)$/i.test(scientificName)) continue;
      const contacts = source.contacts;
      if (typeof contacts !== 'number' || !Number.isFinite(contacts) || contacts < 0) {
        throw new RangeError('Le nombre de contacts doit être un nombre positif ou nul.');
      }
      if (contacts === 0) continue;
      const row = { scientificName, frenchName, contacts, isSpecies: source.isSpecies === true, known: source.known === true };
      if (safeColor(source.color)) row.color = source.color;
      rows.push(row);
    }
    rows.sort((left, right) => right.contacts - left.contacts || compareNames(left.scientificName, right.scientificName) || compareNames(left.frenchName, right.frenchName));
    const total = rows.reduce((sum, row) => sum + row.contacts, 0);
    if (!Number.isFinite(total)) throw new RangeError('Le total des contacts est trop élevé.');
    rows.forEach((row, index) => {
      row.proportion = total ? row.contacts / total : 0;
      row.percentage = row.proportion * 100;
      row.color = row.color || PALETTE[index] || `hsl(${(index * 137.508) % 360} 52% ${index % 2 ? 42 : 54}%)`;
    });
    return { rows, total };
  }

  // Assign the complete palette before filtering, so a category keeps its color
  // in either view and in exports. Hidden categories remain in the legend.
  function select(input, hiddenKeys) {
    if (hiddenKeys == null) hiddenKeys = new Set();
    if (!(hiddenKeys instanceof Set)) throw new TypeError('Les catégories masquées doivent être un ensemble.');
    const data = prepare(input);
    let total = 0, hiddenContacts = 0, hiddenCount = 0;
    for (const row of data.rows) {
      if (hiddenKeys.has(rowKey(row))) { hiddenContacts += row.contacts; hiddenCount++; }
      else total += row.contacts;
    }
    const legendRows = data.rows.map(row => {
      const hidden = hiddenKeys.has(rowKey(row));
      const proportion = hidden || !total ? 0 : row.contacts / total;
      return { ...row, hidden, proportion, percentage: proportion * 100 };
    });
    const rows = legendRows.filter(row => !row.hidden).map(({ hidden, ...row }) => row);
    return { rows, legendRows, total, hiddenContacts, hiddenCount };
  }

  function names(row) {
    const scientificName = escape(row.scientificName || row.frenchName || 'Identification non renseignée');
    return `<span class="activity-legend-names"><${row.isSpecies ? 'i' : 'span'} class="activity-legend-name">${scientificName}</${row.isSpecies ? 'i' : 'span'}>${row.frenchName ? `<span class="activity-legend-french">${escape(row.frenchName)}</span>` : ''}</span>`;
  }

  function value(row) {
    return `<span class="activity-legend-value"><strong>${countFormat.format(row.contacts)}</strong><span>${row.hidden ? 'Masqué' : percentageFormat.format(row.percentage) + ' %'}</span></span>`;
  }

  function tooltip(row) {
    return escape(`${row.scientificName || row.frenchName} : ${countFormat.format(row.contacts)} contacts (${percentageFormat.format(row.percentage)} %)`);
  }

  function toggle(row, bar) {
    const label = (row.hidden ? 'Afficher ' : 'Masquer ') + (row.scientificName || row.frenchName || 'Identification non renseignée');
    return `<button type="button" class="activity-legend-toggle${bar ? ' activity-bar-heading' : ''}" data-chart-key="${escape(rowKey(row))}" aria-pressed="${!row.hidden}" aria-label="${escape(label)}"><span class="activity-legend-swatch" style="background:${row.color}" aria-hidden="true"></span>${names(row)}${value(row)}</button>`;
  }

  function interactiveLegend(rows) {
    const many = rows.length > 8;
    return `<div class="activity-legend-panel">${many ? `<p class="activity-legend-caption">${rows.length} libellés · effectif et part des contacts<span>Défilez pour parcourir toute la légende.</span></p>` : ''}<ul class="activity-legend" aria-label="Espèces et nombres de contacts"${many ? ' tabindex="0"' : ''}>${rows.map(row => `<li class="activity-legend-item${row.hidden ? ' is-hidden' : ''}">${toggle(row, false)}</li>`).join('')}</ul></div>`;
  }

  function pie(data, options) {
    const parts = [];
    const center = 160, radius = 148;
    if (data.rows.length === 1) {
      const row = data.rows[0];
      parts.push(`<circle class="activity-chart-slice" cx="${center}" cy="${center}" r="${radius}" fill="${row.color}" stroke="#fff" stroke-width="2"><title>${tooltip(row)}</title></circle>`);
    } else {
      let angle = -Math.PI / 2;
      data.rows.forEach((row, index) => {
        const end = index === data.rows.length - 1 ? Math.PI * 1.5 : angle + row.proportion * Math.PI * 2;
        const x1 = center + radius * Math.cos(angle), y1 = center + radius * Math.sin(angle);
        const x2 = center + radius * Math.cos(end), y2 = center + radius * Math.sin(end);
        const arc = end - angle > Math.PI ? 1 : 0;
        const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${arc} 1 ${x2} ${y2} Z`;
        parts.push(`<path class="activity-chart-slice" d="${path}" fill="${row.color}" stroke="#fff" stroke-width="2" stroke-linejoin="round"><title>${tooltip(row)}</title></path>`);
        angle = end;
      });
    }
    const description = data.rows.map(row => `${row.scientificName || row.frenchName} : ${countFormat.format(row.contacts)} contacts, ${percentageFormat.format(row.percentage)} %`).join(' ; ');
    const title = options && options.title || 'Répartition des contacts par espèce';
    const chart = data.total ? `<svg class="activity-chart-svg" viewBox="0 0 320 320" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><desc>${escape(description)}. Total : ${countFormat.format(data.total)} contacts${options && options.hasAutoId === false ? '' : ', hors Noise'}.</desc>${parts.join('')}</svg>` : '<p class="activity-chart-empty">Aucune catégorie affichée. Réactivez un élément de la légende.</p>';
    if (options && options.interactive) {
      const rows = data.legendRows;
      return `<div class="activity-chart-layout activity-chart-interactive${rows.length > 8 ? ' activity-chart-many' : ''}">${chart}${interactiveLegend(rows)}</div>`;
    }
    const many = data.rows.length > 8;
    const legend = `<div class="activity-legend-panel">${many?`<p class="activity-legend-caption">${data.rows.length} libellés · effectif et part des contacts<span>Défilez pour parcourir toute la légende.</span></p>`:''}<ul class="activity-legend" aria-label="Espèces et nombres de contacts"${many?' tabindex="0"':''}>${data.rows.map(row => `<li class="activity-legend-item" title="${tooltip(row)}"><span class="activity-legend-swatch" style="background:${row.color}" aria-hidden="true"></span>${names(row)}${value(row)}</li>`).join('')}</ul></div>`;
    return `<div class="activity-chart-layout${many?' activity-chart-many':''}">${chart}${legend}</div>`;
  }

  function bars(data, options) {
    // Widths use total contacts, exactly like the pie shares; they therefore
    // remain directly comparable when the user switches chart mode.
    if (options && options.interactive) {
      const empty = data.total ? '' : '<p class="activity-chart-empty">Aucune catégorie affichée. Réactivez un élément de la légende.</p>';
      return `${empty}<ol class="activity-bar-list activity-chart-interactive" aria-label="${escape(options.title || 'Répartition des contacts par espèce')}">${data.legendRows.map(row => `<li class="activity-bar-item${row.hidden ? ' is-hidden' : ''}">${toggle(row, true)}${row.hidden ? '' : `<div class="activity-bar-track" aria-hidden="true"><span class="activity-bar-fill" style="width:${row.percentage}%;background:${row.color}"></span></div>`}</li>`).join('')}</ol>`;
    }
    return `<ol class="activity-bar-list" aria-label="${escape(options && options.title || 'Répartition des contacts par espèce')}">${data.rows.map(row => `<li class="activity-bar-item"><div class="activity-bar-heading"><span class="activity-legend-swatch" style="background:${row.color}" aria-hidden="true"></span>${names(row)}${value(row)}</div><div class="activity-bar-track" aria-hidden="true"><span class="activity-bar-fill" style="width:${row.percentage}%;background:${row.color}"></span></div></li>`).join('')}</ol>`;
  }

  function render(rows, mode, options) {
    const interactive = options && options.interactive;
    const data = interactive ? select(rows, options.hiddenKeys) : prepare(rows);
    if (!data.total && (!interactive || !data.legendRows.length)) return '<p class="activity-chart-empty">Aucun contact attribué à une espèce à afficher.</p>';
    return mode === 'bar' ? bars(data, options) : pie(data, options);
  }

  return Object.freeze({ prepare, rowKey, select, render });
});
