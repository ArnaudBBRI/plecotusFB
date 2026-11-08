(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./settings-report.js'));
  else root.PlecotusSettingsReportUI = factory(root.PlecotusSettingsReport);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Report) {
  'use strict';

  function init(options = {}) {
    const doc = options.document || globalThis.document;
    const host = options.host || doc.getElementById('settings-report');
    if (!host || typeof doc.createElement !== 'function') return Object.freeze({ refresh() {} });
    const clipboard = Object.prototype.hasOwnProperty.call(options, 'clipboard') ? options.clipboard : globalThis.navigator?.clipboard;
    const ClipboardItemClass = options.ClipboardItem || globalThis.ClipboardItem;
    const make = (tag, text, className) => {
      const node = doc.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const heading = make('h3', 'Paramètres et méthode pour vos rapports');
    const help = make('p', 'Le rapport se met à jour pendant vos modifications et reprend les valeurs affichées dans Réglages. Copiez-le dans Word ou exportez-le. Les modifications doivent être enregistrées pour être appliquées à la vérification.', 'settings-help');
    const actions = make('div', '', 'settings-report-actions');
    const previewLabel = make('label', 'Texte sélectionnable du rapport');
    const preview = make('textarea', '', 'settings-report-preview');
    preview.id = 'settings-report-preview';
    preview.readOnly = true;
    preview.rows = 12;
    previewLabel.htmlFor = preview.id;
    const status = make('p', '', 'settings-help settings-report-status');
    status.setAttribute('role', 'status');
    let current = null;
    let copying = false;
    const actionButtons = [];
    const button = (label, callback) => {
      const node = make('button', label);
      node.type = 'button';
      node.addEventListener('click', callback);
      actions.append(node);
      actionButtons.push(node);
      return node;
    };
    const copyButton = button('Copier pour Word', copy);
    button('Exporter en TXT', () => download('txt'));
    button('Exporter en HTML', () => download('html'));
    host.replaceChildren(heading, help, actions, previewLabel, preview, status);

    function updateActions() {
      for (const action of actionButtons) action.disabled = !current || action === copyButton && copying;
    }

    function refresh() {
      try {
        current = Report.build(options.getConfiguration(), options.now ? { now: options.now() } : {});
        preview.value = current.text;
        status.textContent = '';
      } catch (problem) {
        current = null;
        preview.value = '';
        status.textContent = 'Paramètres incomplets ou invalides : '
          + (problem?.message || 'vérifiez les valeurs saisies.')
          + ' Complétez les réglages pour copier ou exporter le rapport.';
      }
      updateActions();
      return current;
    }

    function selectPreview(message) {
      preview.focus();
      preview.select();
      status.textContent = message;
    }

    async function copy() {
      if (copying) return false;
      const report = refresh();
      if (!report) return false;
      copying = true;
      updateActions();
      try {
        if (clipboard && typeof clipboard.write === 'function' && typeof ClipboardItemClass === 'function') {
          await clipboard.write([new ClipboardItemClass({
            'text/plain': new Blob([report.text], { type: 'text/plain' }),
            'text/html': new Blob([report.fragment], { type: 'text/html' })
          })]);
          if (current !== report) return false;
          status.textContent = 'Rapport copié avec sa mise en forme. Collez-le dans Word.';
          return true;
        }
        if (clipboard && typeof clipboard.writeText === 'function') {
          await clipboard.writeText(report.text);
          if (current !== report) return false;
          status.textContent = 'Rapport copié en texte. Collez-le dans votre document.';
          return true;
        }
        selectPreview('Copie automatique indisponible : le texte est sélectionné. Utilisez Ctrl+C, puis collez-le dans votre document.');
        return false;
      } catch {
        if (current === report) selectPreview('Le navigateur a refusé la copie automatique. Utilisez Ctrl+C sur le texte sélectionné, ou exportez le rapport.');
        return false;
      } finally {
        copying = false;
        updateActions();
      }
    }

    function download(format) {
      const report = refresh();
      if (!report) return false;
      const content = format === 'html' ? report.html : '\ufeff' + report.text;
      const type = format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8';
      const fileName = report.fileStem + '.' + format;
      if (typeof options.download === 'function') options.download({ content, type, fileName });
      else {
        const url = URL.createObjectURL(new Blob([content], { type }));
        const link = make('a');
        link.href = url;
        link.download = fileName;
        doc.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      status.textContent = 'Rapport exporté : ' + fileName + '.';
    }

    return Object.freeze({ refresh });
  }

  return Object.freeze({ init });
});
