(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./final-summary-visuals.js'));
  else root.PlecotusStepOneSpeciesUI = factory(root.PlecotusFinalSummaryVisuals);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Visuals) {
  'use strict';

  function init(options = {}) {
    const doc = options.document || globalThis.document;
    const visuals = options.visuals || Visuals;
    const buttons = [...doc.querySelectorAll('[data-step-one-species-export]')];
    const descriptions = [...doc.querySelectorAll('[data-step-one-species-help]')];
    const statuses = [...doc.querySelectorAll('[data-step-one-species-status]')];
    let current = null, signature = null, generation = 0, activeExport = null;

    function canExport(data) {
      return Boolean(data && data.ready === true && data.hasBestContacts === true && Array.isArray(data.rows));
    }

    function signatureOf(data) {
      if (!data) return 'null';
      return JSON.stringify([data.sourceVersion, data.fileName, data.selectionSignature,
        data.ready, data.hasBestContacts, data.bestIndices || [], data.pendingBestIndices || [],
        data.noBestGroupKeys || [], data.rows]);
    }

    function setStatus(message, isError = false) {
      for (const status of statuses) {
        status.textContent = message;
        status.dataset.error = String(isError);
      }
    }

    function renderState() {
      for (const button of buttons) button.disabled = !canExport(current) || Boolean(activeExport);
      let message;
      if (!current) message = 'Chargez un fichier pour exporter les espèces identifiées à l’étape 1.';
      else if (!current.hasBestContacts) message = 'Aucun meilleur contact éligible : cet export est indisponible.';
      else if (!canExport(current)) {
        const pending = (current.pendingBestIndices || []).length;
        message = 'Terminez l’identification de chaque meilleur contact pour exporter la liste'
          + (pending ? ' (' + pending + (pending === 1 ? ' contact reste à identifier' : ' contacts restent à identifier') + ')' : '')
          + '. Une identification « À revoir » reste à terminer.';
      } else {
        message = 'Liste provisoire des espèces et catégories identifiées sur les meilleurs contacts de l’étape 1. '
          + 'Elle peut être complétée après les contrôles supplémentaires.';
        if (!current.rows.length) message += ' Aucune espèce ou catégorie hors Noise : la liste exportée est vide.';
      }
      const missing = (current?.noBestGroupKeys || []).length;
      if (missing) message += ' ' + missing + (missing === 1 ? ' groupe sans référence éligible ne figure' : ' groupes sans référence éligible ne figurent')
        + ' pas dans cette liste.';
      for (const description of descriptions) description.textContent = message;
    }

    function adopt(next) {
      const nextSignature = signatureOf(next);
      if (nextSignature !== signature) {
        generation++;
        activeExport = null;
        signature = nextSignature;
        setStatus('');
      }
      current = next;
      renderState();
      return next;
    }

    function refresh() {
      try { return adopt(options.getData() || null); }
      catch (problem) {
        adopt(null);
        setStatus(problem.message || 'Impossible de préparer la liste des espèces.', true);
        return null;
      }
    }

    function reset() {
      generation++;
      current = null;
      signature = null;
      activeExport = null;
      setStatus('');
      renderState();
    }

    function stillCurrent(operation) {
      if (activeExport !== operation || operation.generation !== generation) return false;
      // Re-read even when the surrounding controller has not refreshed yet.
      // Only best-contact data contributes to the signature, so completing an
      // unrelated supplementary control does not cancel a valid JPEG export.
      refresh();
      return activeExport === operation && operation.generation === generation
        && operation.signature === signature && canExport(current);
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

    async function exportList(format) {
      if (!['csv', 'jpeg'].includes(format)) return;
      const data = refresh();
      if (!canExport(data) || activeExport) return;
      const operation = { generation, signature };
      activeExport = operation;
      renderState();
      setStatus('Préparation de la liste des espèces de l’étape 1…');
      const rows = data.rows.map(row => ({ ...row }));
      const fileName = String(data.fileName || 'contacts.csv');
      try {
        const result = format === 'csv'
          ? { blob: new Blob([visuals.namesCsv(rows)], { type: 'text/csv;charset=utf-8' }), extension: 'csv' }
          : await visuals.exportNamesTable(rows, 'jpeg', { fileName });
        if (!stillCurrent(operation)) return;
        const stem = fileName.replace(/\.[^.]+$/, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'contacts';
        await download(result, stem + '_especes_etape_1');
        if (stillCurrent(operation)) setStatus('Liste provisoire ' + result.extension.toUpperCase() + ' téléchargée.');
      } catch (problem) {
        if (activeExport === operation && stillCurrent(operation)) {
          setStatus(problem.message || 'Impossible d’exporter la liste des espèces.', true);
        }
      } finally {
        if (activeExport === operation) { activeExport = null; renderState(); }
      }
    }

    for (const button of buttons) button.addEventListener('click', () => exportList(button.dataset.stepOneSpeciesExport));
    reset();
    return Object.freeze({ refresh, reset });
  }

  return Object.freeze({ init });
});
