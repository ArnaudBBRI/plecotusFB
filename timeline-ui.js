(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./timeline-data.js'), require('./timeline-chart.js'), require('./activity-export.js'));
  else root.PlecotusTimelineUI = factory(root.PlecotusTimelineData, root.PlecotusTimelineChart, root.BatActivityExport);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Data, Chart, Images) {
  'use strict';

  function init(options = {}) {
    const doc = options.document || globalThis.document;
    const dataModule = options.data || Data, chart = options.chart || Chart, images = options.images || Images;
    const node = id => doc.getElementById(id);
    const host = node('timeline-chart'), caption = node('timeline-caption');
    const detail = node('timeline-detail'), status = node('timeline-export-status');
    const buttons = [...doc.querySelectorAll('[data-timeline-export]')];
    let current = null, fileName = '', generation = 0, exporting = false;

    function updateButtons() {
      for (const button of buttons) button.disabled = exporting || !current?.bins.length || !current.total;
    }

    function reset() {
      generation++;
      current = null;
      fileName = '';
      exporting = false;
      host.replaceChildren();
      caption.textContent = '';
      detail.textContent = '';
      detail.hidden = true;
      status.textContent = '';
      updateButtons();
    }

    function show(imported) {
      reset();
      try {
        current = dataModule.build(imported);
        fileName = String(imported.fileName || 'contacts.csv');
        host.innerHTML = chart.render(current);
        caption.textContent = chart.caption(current);
        detail.textContent = current.bins.length ? 'Survolez un point ou sélectionnez-le au clavier pour lire l’intervalle et son effectif.' : '';
        detail.hidden = !current.bins.length;
        updateButtons();
        return current;
      } catch (problem) {
        current = null;
        host.replaceChildren();
        caption.textContent = 'Impossible de construire la chronologie : ' + (problem.message || 'dates ou heures non exploitables.');
        updateButtons();
        return null;
      }
    }

    function download(result, name) {
      const file = { ...result, fileName: name + '.' + result.extension };
      if (typeof options.download === 'function') return options.download(file);
      const url = URL.createObjectURL(result.blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = file.fileName;
      doc.body.append(link);
      try { link.click(); }
      finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    }

    async function exportImage(format) {
      if (!current?.bins.length || !current.total || exporting || !['png', 'jpeg', 'svg'].includes(format)) return;
      const version = generation, data = current, sourceName = fileName;
      exporting = true;
      updateButtons();
      status.textContent = 'Préparation de la chronologie…';
      try {
        const result = await images.rasterize(chart.svg(data, { fileName: sourceName }), format);
        if (version !== generation) return;
        const stem = sourceName.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'contacts';
        download(result, stem + '_chronologie_contacts');
        status.textContent = 'Chronologie ' + result.extension.toUpperCase() + ' téléchargée.';
      } catch (problem) {
        if (version === generation) status.textContent = problem.message || 'Impossible d’exporter la chronologie.';
      } finally {
        if (version === generation) { exporting = false; updateButtons(); }
      }
    }

    function showDetail(event) {
      const point = event.target?.closest?.('[data-timeline-index]');
      if (!point || !host.contains(point) || !current) return;
      const index = Number(point.dataset.timelineIndex);
      if (!Number.isInteger(index) || !current.bins[index]) return;
      detail.textContent = chart.intervalLabel(current.bins[index]);
    }
    host.addEventListener('pointerover', showDetail);
    host.addEventListener('focusin', showDetail);
    for (const button of buttons) button.addEventListener('click', () => exportImage(button.dataset.timelineExport));
    reset();
    return Object.freeze({ show, reset });
  }

  return Object.freeze({ init });
});
