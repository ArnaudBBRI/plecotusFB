(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./contact-context-data.js'));
  else root.PlecotusContactContextUI = factory(root.PlecotusContactContextData);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Data) {
  'use strict';

  const counts = new Intl.NumberFormat('fr-FR');
  const pad = (value, length = 2) => String(value).padStart(length, '0');
  const cellText = value => value == null || !String(value).trim() ? '—' : String(value);
  function clock(timestamp) {
    if (timestamp == null) return 'Non daté';
    const value = new Date(timestamp);
    return pad(value.getUTCDate()) + '/' + pad(value.getUTCMonth() + 1) + '/' + value.getUTCFullYear()
      + ' ' + pad(value.getUTCHours()) + ':' + pad(value.getUTCMinutes()) + ':' + pad(value.getUTCSeconds())
      + (value.getUTCMilliseconds() ? '.' + pad(value.getUTCMilliseconds(), 3) : '');
  }

  function init(options = {}) {
    const doc = options.document || globalThis.document;
    const dataModule = options.data || Data;
    const node = id => doc.getElementById(id);
    const panel = node('contact-context'), heading = node('contact-context-heading');
    const summary = node('contact-context-summary'), body = node('contact-context-table-body');
    const status = node('contact-context-status');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-labelledby', 'contact-context-heading');
    heading.setAttribute('tabindex', '-1');
    let indexedImport = null, index = null, reference = null, opener = null;
    let generation = 0, openingSequence = 0;
    let renderedRows = new Map();
    const make = (tag, text, className) => {
      const element = doc.createElement(tag);
      if (text != null) element.textContent = text;
      if (className) element.className = className;
      return element;
    };

    function close(restoreFocus) {
      generation++;
      panel.hidden = true;
      const previous = opener;
      opener = null;
      if (restoreFocus && previous?.isConnected !== false) previous?.focus?.({ preventScroll: true });
    }

    function hide() { close(true); }

    function reset() {
      close(false);
      indexedImport = null;
      index = null;
      reference = null;
      renderedRows.clear();
      body.replaceChildren();
      summary.textContent = '';
      status.textContent = '';
    }

    function manualText(contact) {
      if (contact.manualStatus === 'unresolved') return 'À revoir';
      if (contact.manualStatus === 'pending') return 'À identifier';
      return cellText(contact.manualId);
    }

    function updateManual(contact, cell) {
      const value = manualText(contact);
      if (cell.textContent !== value) cell.textContent = value;
      cell.dataset.manualStatus = contact.manualStatus;
      cell.title = contact.manualStatus === 'unresolved' ? 'Identification incertaine/non résolue'
        : contact.manualStatus === 'pending' ? 'Identification manuelle à renseigner' : 'MANUAL ID, sans attribution calculée';
    }

    async function openRecording(contact, imported, button) {
      if (panel.hidden || imported !== indexedImport || imported !== options.getImported()) return;
      const version = generation, sequence = ++openingSequence;
      button.disabled = true;
      status.textContent = 'Ouverture du contact de la ligne ' + counts.format(contact.lineNumber) + '…';
      try {
        const opened = await options.onOpenContact(contact.recordIndex, imported);
        if (version !== generation || sequence !== openingSequence || panel.hidden) return;
        status.textContent = opened === false
          ? 'Ouverture non effectuée. Vérifiez les Réglages ou le message d’ouverture des WAV.'
          : 'Ouverture demandée pour le contact de la ligne ' + counts.format(contact.lineNumber) + '.';
      } catch (problem) {
        if (version === generation && sequence === openingSequence && !panel.hidden) {
          status.textContent = problem.message || 'Le WAV n’a pas pu être ouvert.';
        }
      } finally { button.disabled = false; }
    }

    function renderRows(context) {
      body.replaceChildren();
      renderedRows = new Map();
      for (const contact of context.rows) {
        const row = make('tr');
        row.dataset.contextIndex = String(contact.recordIndex);
        row.title = 'Contact source · ligne ' + counts.format(contact.lineNumber);
        if (contact.isReference) {
          row.className = 'contact-context-reference';
          row.setAttribute('aria-current', 'true');
        }
        const date = make('td');
        if (contact.isReference) date.append(make('strong', 'Référence', 'contact-context-reference-marker'));
        date.append(make('span', clock(contact.timestamp)));
        const wav = make('td');
        if (contact.fileName) {
          const button = make('button', contact.fileName, 'contact-context-wav');
          button.type = 'button';
          button.setAttribute('aria-label', 'Ouvrir ' + contact.fileName + ', contact de la ligne ' + counts.format(contact.lineNumber));
          const imported = indexedImport;
          button.addEventListener('click', () => openRecording(contact, imported, button));
          wav.append(button);
        } else wav.textContent = 'Fichier non renseigné';
        const manual = make('td');
        updateManual(contact, manual);
        row.append(date, wav, make('td', cellText(contact.autoId)), make('td', cellText(contact.ratio)), make('td', cellText(contact.pulses)), manual);
        body.append(row);
        renderedRows.set(contact.recordIndex, { row, manual });
      }
    }

    function updateSummary(context) {
      const current = context.rows.find(contact => contact.isReference);
      heading.textContent = 'Contexte chronologique' + (current ? ' · ligne ' + counts.format(current.lineNumber) : '');
      const parts = [context.referenceDated
        ? counts.format(context.beforeCount) + ' avant · contact de référence · ' + counts.format(context.afterCount) + ' après.'
        : 'Le contact de référence n’a pas de date ou d’heure exploitable : il est présenté seul.'];
      parts.push('Tous les contacts du fichier sont inclus, y compris Noise.');
      if (context.undatedCount) parts.push(counts.format(context.undatedCount)
        + (context.undatedCount === 1 ? ' contact sans date/heure exploitable est exclu' : ' contacts sans date/heure exploitable sont exclus')
        + ' du voisinage chronologique.');
      if (context.missingColumns?.length) parts.push('Colonnes absentes : ' + context.missingColumns.join(', ') + '.');
      parts.push('Dates et heures du fichier, sans conversion de fuseau horaire.');
      summary.textContent = parts.join(' ');
    }

    function centerReference() {
      const scroller = panel.querySelector?.('.contact-context-scroll');
      const row = renderedRows.get(reference)?.row;
      if (!scroller || !row || typeof row.getBoundingClientRect !== 'function') return;
      const box = scroller.getBoundingClientRect(), bounds = row.getBoundingClientRect();
      scroller.scrollTop = Math.max(0, scroller.scrollTop + bounds.top - box.top - (scroller.clientHeight || box.height) / 2 + bounds.height / 2);
    }

    function show(recordIndex, sourceOpener) {
      const imported = options.getImported();
      if (!imported) { reset(); return false; }
      generation++;
      opener = sourceOpener || null;
      reference = recordIndex;
      status.textContent = '';
      try {
        if (imported !== indexedImport) {
          const next = dataModule.create(imported);
          indexedImport = imported;
          index = next;
        }
        const context = index.get(recordIndex, options.getDecision);
        renderRows(context);
        updateSummary(context);
        panel.hidden = false;
        heading.focus({ preventScroll: true });
        centerReference();
        return true;
      } catch (problem) {
        body.replaceChildren();
        renderedRows.clear();
        heading.textContent = 'Contexte chronologique';
        summary.textContent = '';
        status.textContent = problem.message || 'Impossible de présenter le contexte de ce contact.';
        panel.hidden = false;
        heading.focus({ preventScroll: true });
        return false;
      }
    }

    function refresh() {
      if (panel.hidden || reference == null) return;
      if (options.getImported() !== indexedImport) { reset(); return; }
      const context = index.get(reference, options.getDecision);
      // Chronological positions belong to the immutable source import. A
      // decision refresh only changes manual cells, retaining focused WAV
      // buttons and the table scroll position.
      for (const contact of context.rows) {
        const rendered = renderedRows.get(contact.recordIndex);
        if (rendered) updateManual(contact, rendered.manual);
      }
    }

    node('contact-context-close').addEventListener('click', hide);
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !panel.contains(event.target)) return;
      event.preventDefault();
      hide();
    });
    reset();
    return Object.freeze({ show, refresh, hide, reset });
  }

  return Object.freeze({ init });
});
