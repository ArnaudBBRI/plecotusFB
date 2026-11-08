(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlecotusUnresolvedReviewUI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const numbers = new Intl.NumberFormat('fr-FR');

  function init(options = {}) {
    const doc = options.document || globalThis.document;
    const node = id => doc.getElementById(id);
    const start = node('unresolved-pass-start'), panel = node('unresolved-pass');
    const heading = node('unresolved-pass-heading'), progress = node('unresolved-pass-progress');
    const host = node('unresolved-pass-card'), status = node('unresolved-pass-status');
    const previous = node('unresolved-pass-previous'), next = node('unresolved-pass-next');
    const restart = node('unresolved-pass-restart');
    heading.setAttribute('tabindex', '-1');
    let active = false, source = null, queue = [], cursor = 0, ended = false;
    let renderedIndex = null;

    const complete = recordIndex => options.isComplete(recordIndex) === true;
    const remaining = () => queue.filter(item => !complete(item.recordIndex)).length;
    const changed = () => options.onStateChange?.();

    function items() {
      const result = options.getItems() || [];
      const seen = new Set();
      return result.filter(item => item && Number.isInteger(item.recordIndex) && item.recordIndex >= 0
        && item.contact && !seen.has(item.recordIndex) && (seen.add(item.recordIndex), true))
        .map(item => ({ recordIndex: item.recordIndex, label: String(item.label || ''),
          contact: { ...item.contact, recordIndex: item.recordIndex } }));
    }

    function merge() {
      const known = new Map(queue.map((item, index) => [item.recordIndex, index]));
      for (const item of items()) {
        if (known.has(item.recordIndex)) queue[known.get(item.recordIndex)] = item;
        else if (!complete(item.recordIndex)) { known.set(item.recordIndex, queue.length); queue.push(item); }
      }
    }

    function render() {
      panel.hidden = !active;
      start.hidden = active;
      previous.disabled = !active || !queue.length || !ended && cursor === 0;
      next.disabled = !active || ended;
      next.hidden = ended;
      if (!active) {
        restart.hidden = true;
        progress.textContent = '';
        status.textContent = '';
        return;
      }
      const left = remaining();
      restart.hidden = !ended || !left;
      if (ended) {
        heading.textContent = 'Fin du passage';
        progress.textContent = numbers.format(queue.length) + ' / ' + numbers.format(queue.length);
        status.textContent = left ? 'Passage terminé. ' + numbers.format(left)
          + (left === 1 ? ' identification reste à reprendre.' : ' identifications restent à reprendre.')
          + ' Relancez un passage sur les contacts restants ou revenez à la liste.'
          : 'Toutes les identifications de ce passage sont terminées. Vous pouvez revenir à la liste.';
        host.replaceChildren();
        renderedIndex = null;
        return;
      }
      const item = queue[cursor];
      heading.textContent = 'Revoir les identifications une par une';
      progress.textContent = numbers.format(cursor + 1) + ' / ' + numbers.format(queue.length)
        + ' · ' + numbers.format(left) + (left === 1 ? ' identification à reprendre' : ' identifications à reprendre');
      status.textContent = complete(item.recordIndex)
        ? 'Cette identification est terminée. Vous pouvez la consulter ou la corriger, puis continuer.'
        : 'Identifiez ce contact ou choisissez « À revoir » pour le différer. « Suivant » laisse son identification inchangée.';
      // A refresh may remove this item from the live unresolved list. Retain
      // its card and source identity until explicit user navigation, so typed
      // comments, focus and selection are not replaced by background updates.
      if (renderedIndex !== item.recordIndex) {
        const card = options.renderContactCard(item.contact, item.label);
        card.dataset.unresolvedPass = 'true';
        host.replaceChildren(card);
        renderedIndex = item.recordIndex;
      }
    }

    function clear(notify) {
      const wasActive = active;
      active = false;
      source = null;
      queue = [];
      cursor = 0;
      ended = false;
      renderedIndex = null;
      host.replaceChildren();
      render();
      if (notify && wasActive) changed();
    }

    function reset() { clear(true); }

    function currentSource() {
      if (!active) return false;
      if (options.getSource() !== source) { reset(); return false; }
      return true;
    }

    function focus() {
      if (!currentSource()) return false;
      heading.focus({ preventScroll: true });
      return true;
    }

    function show() {
      const nextSource = options.getSource();
      if (!nextSource) { reset(); return false; }
      if (active && nextSource === source) { refresh(); focus(); return true; }
      if (active) reset();
      const nextQueue = items().filter(item => !complete(item.recordIndex));
      if (!nextQueue.length) return false;
      const wasActive = active;
      source = nextSource;
      active = true;
      queue = nextQueue;
      cursor = 0;
      ended = false;
      renderedIndex = null;
      render();
      if (!wasActive) changed();
      focus();
      return true;
    }

    function refresh() {
      if (!currentSource()) return;
      merge();
      render();
    }

    function afterDecision(recordIndex, action = {}) {
      if (!currentSource() || ended || queue[cursor]?.recordIndex !== recordIndex) return;
      merge();
      if (action.deferred !== true && !complete(recordIndex)) { render(); return; }
      let following = cursor + 1;
      while (following < queue.length && complete(queue[following].recordIndex)) following++;
      if (following < queue.length) cursor = following;
      else ended = true;
      render();
      focus();
    }

    function goNext() {
      if (!currentSource() || ended) return;
      merge();
      if (cursor + 1 < queue.length) cursor++;
      else ended = true;
      render();
      focus();
    }

    function goPrevious() {
      if (!currentSource() || !queue.length) return;
      if (ended) { ended = false; cursor = queue.length - 1; }
      else if (cursor) cursor--;
      render();
      focus();
    }

    function restartRemaining() {
      if (!currentSource()) return;
      merge();
      queue = queue.filter(item => !complete(item.recordIndex));
      cursor = 0;
      ended = !queue.length;
      renderedIndex = null;
      render();
      focus();
    }

    function hide() {
      clear(true);
      if (typeof options.onExit === 'function') options.onExit();
      else if (!start.hidden) start.focus({ preventScroll: true });
    }

    start.addEventListener('click', show);
    previous.addEventListener('click', goPrevious);
    next.addEventListener('click', goNext);
    restart.addEventListener('click', restartRemaining);
    node('unresolved-pass-close').addEventListener('click', hide);
    // Do not call the root callback during init: its controller variable may
    // not have been assigned until this factory returns.
    clear(false);
    return Object.freeze({ show, refresh, afterDecision, hide, reset, isActive: () => active, focus });
  }

  return Object.freeze({ init });
});
