(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./review-settings.js'), require('./species.js'));
  else root.PlecotusReviewSettingsUI = factory(root.PlecotusReviewSettings, root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Settings, Names) {
  'use strict';

  function init(options = {}) {
    const doc = options.document || globalThis.document;
    const host = options.host || doc.getElementById('review-settings-fields');
    const onChange = options.onChange || (() => {});
    let draft = Settings.normalize();
    let invalidInput = null;
    const element = (tag, text, className) => {
      const node = doc.createElement(tag);
      if (text) node.textContent = text;
      if (className) node.className = className;
      return node;
    };
    const button = (text, callback, title) => {
      const node = element('button', text);
      node.type = 'button';
      if (title) node.setAttribute('aria-label', title);
      node.addEventListener('click', callback);
      return node;
    };
    const selectOption = (select, value, label) => {
      const option = element('option', label);
      option.value = value;
      select.append(option);
    };
    const fieldset = (legend, description) => {
      const field = element('fieldset', '', 'settings-general settings-review');
      field.append(element('legend', legend));
      if (description) field.append(element('p', description, 'settings-help'));
      host.append(field);
      return field;
    };
    const validation = fieldset('Validation globale', 'Le meilleur contact doit être validé. Les seuils sont inclusifs : une valeur égale au seuil satisfait le critère.');
    const thresholds = element('div', '', 'settings-thresholds');
    function numberField(id, label, min, max, step) {
      const wrapper = element('div');
      const caption = element('label', label);
      caption.htmlFor = id;
      const input = element('input');
      Object.assign(input, { id, type: 'number', min: String(min), max: String(max), step: String(step), required: true });
      input.addEventListener('input', onChange);
      input.addEventListener('change', onChange);
      wrapper.append(caption, input);
      thresholds.append(wrapper);
      return input;
    }
    const ratio = numberField('settings-ratio-threshold', 'MATCH RATIO minimal (0 à 1)', 0, 1, 'any');
    const majority = numberField('settings-majority-threshold', 'Contacts atteignant ce ratio, au minimum (%)', 0, 100, 'any');
    validation.append(thresholds);
    const exclusionsLabel = element('h3', 'Espèces exclues de la validation globale');
    const exclusionsNote = element('p', 'Ces espèces demandent un contrôle par échantillon, même lorsque les seuils sont atteints. Le groupe NoID est toujours vérifié par échantillon et reste exclu de la validation globale.', 'settings-help');
    const excludedList = element('ul', '', 'settings-excluded-list');
    const speciesAdd = element('div', '', 'settings-add-row');
    const speciesSelect = element('select');
    speciesSelect.id = 'settings-excluded-species';
    speciesSelect.setAttribute('aria-label', 'Espèce à exclure de la validation globale');
    const addSpecies = button('Ajouter', () => {
      if (speciesSelect.value && !draft.excludedSpecies.includes(speciesSelect.value)) {
        draft.excludedSpecies.push(speciesSelect.value);
        renderExclusions();
        onChange();
      }
    });
    speciesAdd.append(speciesSelect, addSpecies);
    validation.append(exclusionsLabel, exclusionsNote, excludedList, speciesAdd);
    const species = Names.SPECIES.slice().sort((a, b) => a.frenchName.localeCompare(b.frenchName, 'fr'));
    const speciesText = item => item.code + ' · ' + item.frenchName + ' (' + item.scientificName + ')';

    function renderExclusions() {
      excludedList.replaceChildren();
      if (!draft.excludedSpecies.length) excludedList.append(element('li', 'Aucune espèce exclue.', 'settings-empty'));
      for (const code of draft.excludedSpecies) {
        const pinned = code === 'NoID';
        const item = pinned ? { code: 'NoID', frenchName: 'Chauve-souris non identifiée', scientificName: '' } : Names.resolve(code);
        const row = element('li');
        const remove = button('Retirer', () => {
          draft.excludedSpecies = draft.excludedSpecies.filter(value => value !== code);
          renderExclusions();
          onChange();
        }, 'Retirer ' + item.frenchName + ' de la liste d’exclusion');
        remove.disabled = pinned;
        if (pinned) remove.title = 'NoID est toujours vérifié par échantillon.';
        row.append(element('span', pinned ? 'NoID · toujours vérifié par échantillon' : speciesText(item)), remove);
        excludedList.append(row);
      }
      speciesSelect.replaceChildren();
      const available = species.filter(item => !draft.excludedSpecies.includes(item.code));
      for (const item of available) selectOption(speciesSelect, item.code, speciesText(item));
      speciesSelect.value = available[0]?.code || '';
      speciesSelect.disabled = !available.length;
      addSpecies.disabled = !available.length;
    }

    const ranking = fieldset('Classement du meilleur contact', 'Les critères sont appliqués dans l’ordre, de haut en bas. En cas d’égalité, le critère suivant départage les contacts. Les valeurs absentes passent toujours en dernier ; l’ordre du fichier départage les égalités complètes.');
    const rankingList = element('ol', '', 'settings-ranking-list');
    const rankingAdd = element('div', '', 'settings-add-row');
    const rankingSelect = element('select');
    rankingSelect.id = 'settings-ranking-criterion';
    rankingSelect.setAttribute('aria-label', 'Critère de classement à ajouter');
    const addCriterion = button('Ajouter', () => {
      if (rankingSelect.value && !draft.ranking.some(item => item.key === rankingSelect.value)) {
        const key = rankingSelect.value;
        draft.ranking.push({ key, direction: key === 'dateValue' || key === 'timeValue' ? 'asc' : 'desc' });
        renderRanking();
        onChange();
      }
    });
    rankingAdd.append(rankingSelect, addCriterion);
    ranking.append(rankingList, rankingAdd);
    ranking.append(element('p', 'Un contact doit toujours posséder une valeur exploitable dans MATCHING, MATCH RATIO ou Qual pour être candidat.', 'settings-help'));
    const criterionLabel = key => Settings.CRITERIA.find(item => item.key === key)?.label || key;

    function renderRanking() {
      rankingList.replaceChildren();
      draft.ranking.forEach((criterion, index) => {
        const label = criterionLabel(criterion.key);
        const row = element('li');
        const direction = element('select');
        direction.setAttribute('aria-label', 'Sens du classement pour ' + label);
        selectOption(direction, 'desc', 'Décroissant');
        selectOption(direction, 'asc', 'Croissant');
        direction.value = criterion.direction;
        direction.addEventListener('change', () => { criterion.direction = direction.value; onChange(); });
        const actions = element('span', '', 'settings-ranking-actions');
        const up = button('↑', () => move(index, -1), 'Monter ' + label);
        const down = button('↓', () => move(index, 1), 'Descendre ' + label);
        up.disabled = index === 0;
        down.disabled = index === draft.ranking.length - 1;
        const remove = button('Retirer', () => { draft.ranking.splice(index, 1); renderRanking(); onChange(); }, 'Retirer le critère ' + label);
        remove.disabled = draft.ranking.length === 1;
        actions.append(up, down, remove);
        row.append(element('span', label, 'settings-criterion-label'), direction, actions);
        rankingList.append(row);
      });
      rankingSelect.replaceChildren();
      const available = Settings.CRITERIA.filter(item => !draft.ranking.some(active => active.key === item.key));
      for (const item of available) selectOption(rankingSelect, item.key, item.label);
      rankingSelect.value = available[0]?.key || '';
      rankingSelect.disabled = !available.length;
      addCriterion.disabled = !available.length;
    }

    function move(index, delta) {
      const target = index + delta;
      if (target < 0 || target >= draft.ranking.length) return;
      [draft.ranking[index], draft.ranking[target]] = [draft.ranking[target], draft.ranking[index]];
      renderRanking();
      const position = delta < 0 ? 0 : 1;
      rankingList.children[target]?.querySelectorAll('button')[position]?.focus();
      onChange();
    }

    const reset = button('Rétablir les critères par défaut', () => { set(Settings.normalize()); onChange(); });
    reset.className = 'settings-reset';
    reset.id = 'settings-review-reset';
    host.append(reset, element('p', 'Les changements sont appliqués après « Enregistrer ». Les contacts déjà identifiés à la main sont conservés ; les meilleurs contacts et les attributions calculées sont recalculés.', 'settings-help'));

    function set(value) {
      draft = Settings.normalize(value);
      ratio.value = String(draft.ratioThreshold);
      majority.value = String(Number((draft.majorityThreshold * 100).toPrecision(14)));
      invalidInput = null;
      renderExclusions();
      renderRanking();
    }

    function get() {
      const number = (input, min, max, label) => {
        const value = String(input.value).trim();
        const parsed = value ? Number(value.replace(',', '.')) : NaN;
        if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
          invalidInput = input;
          throw new Error(label + ' doit être un nombre entre ' + min + ' et ' + max + '.');
        }
        return parsed;
      };
      const ratioThreshold = number(ratio, 0, 1, 'Le seuil de MATCH RATIO');
      const majorityThreshold = number(majority, 0, 100, 'Le pourcentage minimal de contacts') / 100;
      return Settings.normalize({ ...draft, ratioThreshold, majorityThreshold });
    }

    set(draft);
    return Object.freeze({ set, get, focusInvalid: () => invalidInput?.focus() });
  }

  return Object.freeze({ init });
});
