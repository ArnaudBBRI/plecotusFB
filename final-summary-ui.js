(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./activity-chart.js'), require('./activity-export.js'), require('./final-summary-visuals.js'));
  else root.PlecotusFinalSummaryUI = factory(root.BatActivityChart, root.BatActivityExport, root.PlecotusFinalSummaryVisuals);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Chart, Images, Visuals) {
  'use strict';

  const numbers = new Intl.NumberFormat('fr-FR');
  const count = (value, singular, plural) => numbers.format(value) + ' ' + (value === 1 ? singular : plural);

  function init(options) {
    const doc = options.document;
    const node = id => doc.getElementById(id);
    const screen = node('final-summary');
    const status = node('final-export-status');
    const hiddenKeys = new Set();
    const chartButtons = [...screen.querySelectorAll('[data-summary-chart]')];
    const tableButtons = [...screen.querySelectorAll('[data-summary-table]')];
    const modeButtons = [...screen.querySelectorAll('[data-summary-mode]')];
    let data = null, mode = 'pie', exporting = false, generation = 0;
    let includePipistrelle = true;

    function applyPreference(reset) {
      const next = options.getPreferences().includeCommonPipistrelle;
      if (reset) hiddenKeys.clear();
      if (reset || next !== includePipistrelle) {
        for (const row of [...data.beforeRows, ...data.afterRows]) {
          if (row.key !== 'PIPPIP') continue;
          if (next) hiddenKeys.delete(Chart.rowKey(row));
          else hiddenKeys.add(Chart.rowKey(row));
        }
      }
      includePipistrelle = next;
    }

    function selection(which) {
      return Chart.select(which === 'before' ? data.beforeRows : data.afterRows, hiddenKeys);
    }

    function comparisonRows() {
      return data.comparisonRows.filter(row => !hiddenKeys.has(Chart.rowKey(row)));
    }

    function updateButtons() {
      for (const button of chartButtons) {
        const available = data && (button.dataset.summaryChart === 'comparison'
          ? comparisonRows().length > 0 : selection(button.dataset.summaryChart).total > 0);
        button.disabled = exporting || !available;
      }
      for (const button of tableButtons) button.disabled = exporting || !data;
    }

    function renderCharts() {
      options.onChartsChanged?.();
      for (const which of ['before', 'after']) {
        const rows = which === 'before' ? data.beforeRows : data.afterRows;
        const selected = selection(which);
        const title = which === 'before' ? 'Avant · AUTO-ID' : 'Après · vérification manuelle';
        node('final-' + which + '-chart').innerHTML = Chart.render(rows, mode, {
          interactive: true, hiddenKeys, title, hasAutoId: data.beforeHasAutoId
        });
        node('final-' + which + '-caption').textContent = count(selected.total, 'contact représenté', 'contacts représentés')
          + ' · hors bruit' + (selected.hiddenCount ? ' · ' + count(selected.hiddenCount, 'catégorie masquée', 'catégories masquées') : '');
      }
      const visible = comparisonRows();
      node('final-comparison-chart').innerHTML = visible.length
        ? Visuals.comparisonSvg(visible).svg
        : '<p class="activity-chart-empty">Aucune catégorie affichée. Réactivez un élément de la légende.</p>';
      node('final-filter-note').textContent = 'Cliquez sur une légende pour masquer ou réafficher une espèce dans les trois graphiques. '
        + 'Les exports des graphiques suivent ces filtres. Le tableau et ses exports conservent tous les contacts hors bruit.';
      for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.summaryMode === mode));
      for (const scrollable of screen.querySelectorAll('.activity-legend, .activity-bar-list')) scrollable.tabIndex = 0;
      updateButtons();
    }

    function renderTable() {
      const body = node('final-contacts-body');
      body.replaceChildren();
      for (const row of tableRowsFor(data)) {
        const line = doc.createElement('tr');
        for (const [index, value] of [row.scientificName, row.frenchName, numbers.format(row.contacts)].entries()) {
          const cell = doc.createElement('td');
          if (!index && row.isSpecies) {
            const scientific = doc.createElement('i');
            scientific.textContent = value;
            cell.append(scientific);
          } else cell.textContent = value;
          line.append(cell);
        }
        body.append(line);
      }
      node('final-table-empty').hidden = Boolean(data.tableRows.length);
      node('final-table-total').textContent = numbers.format(data.totals.afterContacts);
    }

    function tableRowsFor(summary) {
      const species = new Set(summary.afterRows.filter(row => row.isSpecies).map(Chart.rowKey));
      return summary.tableRows.map(row => ({ ...row, isSpecies: species.has(Chart.rowKey(row)) }));
    }

    function show() {
      const next = options.getData(); // Rebuild and verify the full completion gate.
      if (!next) return false;
      data = next;
      generation++;
      exporting = false;
      applyPreference(true);
      status.textContent = '';
      const totals = data.totals;
      node('final-summary-totals').textContent = count(totals.sourceContacts, 'contact dans le fichier', 'contacts dans le fichier')
        + ' · ' + count(totals.beforeContacts, 'contact hors bruit avant', 'contacts hors bruit avant')
        + ' · ' + count(totals.afterContacts, 'contact hors bruit après', 'contacts hors bruit après');
      node('final-summary-origin').textContent = count(totals.manualContacts, 'contact contrôlé manuellement', 'contacts contrôlés manuellement')
        + ' · ' + count(totals.calculatedContacts, 'attribution calculée', 'attributions calculées')
        + ' · bruit : ' + numbers.format(totals.beforeNoise) + ' avant / ' + numbers.format(totals.afterNoise) + ' après.';
      renderCharts();
      renderTable();
      screen.hidden = false;
      node('final-summary-heading').focus();
      return true;
    }

    function hide() {
      options.onChartsChanged?.();
      screen.hidden = true;
      data = null;
      generation++;
      exporting = false;
      status.textContent = '';
    }

    function refresh() {
      if (screen.hidden || !data) return;
      applyPreference(false);
      renderCharts();
    }

    function download(result, name) {
      const url = URL.createObjectURL(result.blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = name + '.' + result.extension;
      doc.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }

    async function exportResult(kind, format) {
      if (!data || screen.hidden || exporting) return;
      const version = generation;
      const current = data;
      const stem = current.fileName.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'contacts';
      exporting = true;
      updateButtons();
      status.textContent = 'Préparation de l’export…';
      try {
        let result;
        if (kind === 'table') {
          const rows = tableRowsFor(current);
          result = format === 'csv'
            ? { blob: new Blob([Visuals.csv(rows)], { type: 'text/csv;charset=utf-8' }), extension: 'csv' }
            : await Visuals.exportTable(rows, format, { title: 'Contacts après vérification manuelle', fileName: current.fileName });
        } else if (kind === 'comparison') {
          result = await Visuals.exportComparison(comparisonRows(), format, { title: 'Comparaison avant / après vérification manuelle' });
        } else {
          const before = kind === 'before';
          const selected = selection(kind);
          if (!selected.total) return;
          result = await Images.exportBlob(selected.rows, mode, format, {
            title: before ? 'Avant · AUTO-ID' : 'Après · vérification manuelle',
            source: before ? 'auto-id' : 'manual',
            totalContacts: current.totals.sourceContacts,
            hasAutoId: current.beforeHasAutoId,
            ...(before ? { noiseContacts: current.totals.beforeNoise } : { ignoredNoise: current.totals.afterNoise }),
            hiddenContacts: selected.hiddenContacts, hiddenCategories: selected.hiddenCount
          });
        }
        if (version !== generation) return;
        const suffix = kind === 'table' ? 'contacts_verifies' : kind === 'comparison' ? 'comparaison_avant_apres'
          : kind === 'before' ? 'avant_autoid' : 'apres_verification';
        download(result, stem + '_' + suffix);
        status.textContent = 'Export ' + result.extension.toUpperCase() + ' téléchargé.';
      } catch (error) {
        if (version === generation) status.textContent = error.message || 'Impossible de préparer l’export.';
      } finally {
        if (version === generation) { exporting = false; updateButtons(); }
      }
    }

    node('final-summary-back').addEventListener('click', () => {
      hide();
      options.onBack();
    });
    for (const button of modeButtons) button.addEventListener('click', () => {
      if (!data) return;
      mode = button.dataset.summaryMode;
      renderCharts();
    });
    for (const button of chartButtons) button.addEventListener('click', () => exportResult(button.dataset.summaryChart, button.dataset.summaryFormat));
    for (const button of tableButtons) button.addEventListener('click', () => exportResult('table', button.dataset.summaryTable));
    screen.addEventListener('click', event => {
      const button = event.target.closest('button[data-chart-key]');
      if (!button || !screen.contains(button) || !data) return;
      const key = button.dataset.chartKey;
      const host = button.closest('[id="final-before-chart"], [id="final-after-chart"]');
      const scrollable = button.closest('.activity-legend, .activity-bar-list');
      const scrollTop = scrollable ? scrollable.scrollTop : 0;
      if (hiddenKeys.has(key)) hiddenKeys.delete(key);
      else hiddenKeys.add(key);
      renderCharts();
      if (host) {
        const restored = [...host.querySelectorAll('button[data-chart-key]')].find(item => item.dataset.chartKey === key);
        if (restored) {
          restored.focus({ preventScroll: true });
          const list = restored.closest('.activity-legend, .activity-bar-list');
          if (list) list.scrollTop = scrollTop;
        }
      }
    });
    return Object.freeze({ show, hide, refresh });
  }

  return Object.freeze({ init });
});
