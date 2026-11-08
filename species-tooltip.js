(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.PlecotusSpeciesTooltip = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  let nextId = 0;
  const counts = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const percentages = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

  function init(options = {}) {
    const doc = options.document || root.document;
    const viewport = options.window || doc.defaultView || root;
    const photos = options.photos || root.PlecotusSpeciesPhotos;
    const schedule = options.setTimeout || root.setTimeout.bind(root);
    const cancel = options.clearTimeout || root.clearTimeout.bind(root);
    const tooltip = doc.createElement('div');
    tooltip.id = 'plecotus-species-tooltip-' + (++nextId);
    tooltip.className = 'species-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    doc.body.append(tooltip);
    let active = null;
    let lastPosition = null;
    let destroyed = false;
    let hideTimer = null;
    const listeners = [];
    const at = (target, name) => String(target.getAttribute(name) || '').trim();
    const inside = (container, node) => {
      if (!container || !node) return false;
      try { return container === node || container.contains(node); } catch { return false; }
    };
    const targetFor = target => target && typeof target.closest === 'function'
      ? target.closest('[data-species-tooltip="true"]') : null;
    const make = (tag, text, className) => {
      const node = doc.createElement(tag);
      if (text != null) node.textContent = text;
      if (className) node.className = className;
      return node;
    };

    function removeDescription(target) {
      if (!target) return;
      const described = String(target.getAttribute('aria-describedby') || '').split(/\s+/)
        .filter(value => value && value !== tooltip.id).join(' ');
      if (described) target.setAttribute('aria-describedby', described);
      else target.removeAttribute('aria-describedby');
    }

    function cancelHide() {
      if (hideTimer != null) cancel(hideTimer);
      hideTimer = null;
    }

    function hide() {
      cancelHide();
      removeDescription(active);
      active = null;
      lastPosition = null;
      tooltip.hidden = true;
    }

    function position(point) {
      if (!active || tooltip.hidden) return;
      const width = viewport.innerWidth || doc.documentElement?.clientWidth || 1024;
      const height = viewport.innerHeight || doc.documentElement?.clientHeight || 768;
      const anchor = active.getBoundingClientRect();
      const x = Number.isFinite(point?.clientX) ? point.clientX : anchor.left + (anchor.width || 0) / 2;
      const y = Number.isFinite(point?.clientY) ? point.clientY : anchor.bottom;
      lastPosition = { clientX: x, clientY: y };
      const rect = tooltip.getBoundingClientRect();
      const gap = 14, margin = 8;
      const left = Math.max(margin, Math.min(x + gap, width - rect.width - margin));
      const desiredTop = y + gap + rect.height > height - margin ? y - rect.height - gap : y + gap;
      const top = Math.max(margin, Math.min(desiredTop, height - rect.height - margin));
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    function link(label, url) {
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return make('span', label);
      const anchor = make('a', label);
      anchor.href = url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      return anchor;
    }

    function show(target, point, force = false) {
      cancelHide();
      if (destroyed || !target || target.isConnected === false) return hide();
      if (target === active && !tooltip.hidden && !force) return position(point);
      removeDescription(active);
      active = target;
      tooltip.replaceChildren();
      const scientific = at(target, 'data-species-name') || 'Espèce non renseignée';
      const french = at(target, 'data-french-name');
      const series = at(target, 'data-series-label');
      if (series) tooltip.append(make('p', series, 'species-tooltip-series'));
      tooltip.append(make('strong', scientific, 'species-tooltip-scientific'));
      if (french) tooltip.append(make('p', french, 'species-tooltip-french'));
      const totalText = at(target, 'data-contacts');
      const shareText = at(target, 'data-percentage');
      const total = totalText ? Number(totalText) : NaN;
      const share = shareText ? Number(shareText) : NaN;
      const facts = [];
      if (Number.isFinite(total) && total >= 0) facts.push(counts.format(total) + (total === 1 ? ' contact' : ' contacts'));
      if (Number.isFinite(share) && share >= 0 && share <= 100) facts.push(percentages.format(share) + ' %');
      if (facts.length) tooltip.append(make('p', facts.join(' · '), 'species-tooltip-facts'));
      let photo = null;
      try { photo = photos?.resolve(scientific) || null; } catch {}
      if (photo && typeof photo.src === 'string' && photo.src) {
        const image = make('img', null, 'species-tooltip-image');
        image.src = photo.src;
        image.alt = photo.alt || 'Photo de ' + scientific;
        image.width = 260;
        image.height = 160;
        const credits = make('p', null, 'species-tooltip-credits');
        if (photo.author) credits.append(make('span', 'Photo : ' + photo.author + '. '));
        if (photo.sourceUrl) credits.append(link('Source', photo.sourceUrl), make('span', ' · '));
        if (photo.license) credits.append(link(photo.license, photo.licenseUrl));
        credits.append(make('span', ' · Image redimensionnée et cadrée pour l’affichage.'));
        const unavailable = make('p', 'Aucune photo d’espèce associée.', 'species-tooltip-unavailable');
        unavailable.hidden = true;
        image.addEventListener('error', () => { image.hidden = true; credits.hidden = true; unavailable.hidden = false; });
        tooltip.append(image, credits, unavailable);
      } else tooltip.append(make('p', 'Aucune photo d’espèce associée.', 'species-tooltip-unavailable'));
      const described = at(target, 'aria-describedby').split(/\s+/).filter(Boolean);
      if (!described.includes(tooltip.id)) described.push(tooltip.id);
      target.setAttribute('aria-describedby', described.join(' '));
      tooltip.hidden = false;
      position(point);
    }

    function on(name, listener, capture = false) {
      doc.addEventListener(name, listener, capture);
      listeners.push([name, listener, capture]);
    }
    on('pointerover', event => {
      if (inside(tooltip, event.target)) return cancelHide();
      const target = targetFor(event.target);
      if (target) show(target, event);
    });
    on('pointermove', event => {
      if (active?.isConnected === false) return hide();
      if (inside(tooltip, event.target)) return cancelHide();
      if (inside(active, event.target)) position(event);
    });
    const leave = (event, delay = false) => {
      if (!active) return;
      if (active.isConnected === false) return hide();
      if (inside(active, event.relatedTarget) || inside(tooltip, event.relatedTarget)) return;
      if (inside(active, event.target) || inside(tooltip, event.target)) {
        if (delay) {
          cancelHide();
          hideTimer = schedule(hide, 220);
        } else hide();
      }
    };
    on('pointerout', event => leave(event, true));
    on('focusin', event => {
      cancelHide();
      if (inside(tooltip, event.target)) return;
      const target = targetFor(event.target);
      if (target) show(target);
      else hide();
    });
    on('focusout', leave);
    on('keydown', event => { if (event.key === 'Escape') hide(); });
    // A fixed popup must not keep an old position when its chart scrolls or
    // the viewport changes. Its own constrained content may still be scrolled.
    on('scroll', event => { if (!inside(tooltip, event.target)) hide(); }, true);
    viewport.addEventListener?.('resize', hide);

    return Object.freeze({
      hide,
      refresh() { if (active) show(active, lastPosition, true); },
      destroy() {
        hide();
        destroyed = true;
        for (const [name, listener, capture] of listeners) doc.removeEventListener(name, listener, capture);
        viewport.removeEventListener?.('resize', hide);
        tooltip.remove();
      }
    });
  }

  return Object.freeze({ init });
});
