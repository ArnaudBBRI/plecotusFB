(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./review-settings.js'), require('./species.js'));
  else root.PlecotusSettingsReport = factory(root.PlecotusReviewSettings, root.BatSpeciesNames);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Settings, Names) {
  'use strict';

  const text = value => String(value == null ? '' : value);
  const escape = value => text(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const numbers = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 17 });
  const percentages = new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 15 });

  function speciesLabel(code) {
    const name = Names.resolve(code);
    if (!name.known) return text(code);
    return code + ' — ' + name.frenchName
      + (name.isSpecies ? ' (' + name.scientificName + ')' : '');
  }

  function build(configuration = {}, options = {}) {
    const settings = Settings.normalize(configuration.reviewSettings);
    const now = options.now === undefined ? new Date() : new Date(options.now);
    if (!Number.isFinite(now.getTime())) throw new TypeError('La date du rapport est invalide.');
    const clock = new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const parts = Object.fromEntries(clock.formatToParts(now).map(part => [part.type, part.value]));
    const timestamp = clock.format(now) + ' (Europe/Brussels)';
    const ratio = numbers.format(settings.ratioThreshold);
    const majority = percentages.format(settings.majorityThreshold * 100);
    const viewers = { kaleidoscope: 'Kaleidoscope', chirosurf: 'ChiroSurf' };
    const viewer = viewers[configuration.wavViewer] || viewers.kaleidoscope;
    const sections = [];
    const paragraph = value => ({ type: 'paragraph', text: value });
    const list = (items, ordered = false) => ({ type: 'list', items, ordered });
    const add = (title, blocks) => sections.push({ title, blocks });

    const hasUnsavedChanges = configuration.hasUnsavedChanges === true;
    add(hasUnsavedChanges ? 'Configuration affichée dans Réglages' : 'Configuration appliquée', [paragraph('Plecotus v22 — rapport généré le ' + timestamp + '.'),
      paragraph('Vérificateur : ' + (text(configuration.reviewer).trim() || 'non spécifié')),
      paragraph(hasUnsavedChanges
        ? 'Paramètres affichés dans Réglages, modifications non encore enregistrées. Enregistrez-les pour les appliquer à la vérification.'
        : 'Paramètres enregistrés actuellement appliqués.'),
      paragraph('Ce document décrit la méthode et les paramètres ; il ne certifie pas l’achèvement de la vérification d’un fichier et ne contient pas de nombres de contacts propres à un jeu de données.')]);

    add('Choix du meilleur contact', [
      paragraph('Un meilleur contact est sélectionné par groupe AUTO-ID sur l’ensemble du fichier, hors Noise. Les critères sont appliqués dans l’ordre suivant ; chaque critère départage les égalités du précédent :'),
      list(settings.ranking.map(criterion => {
        const label = Settings.CRITERIA.find(item => item.key === criterion.key).label;
        return label + ' : ordre ' + (criterion.direction === 'asc' ? 'croissant' : 'décroissant') + '.';
      }), true),
      paragraph('Les valeurs absentes ou invalides passent après les valeurs valides, quel que soit le sens du tri. Une égalité sur tous les critères est départagée par l’ordre des lignes dans le fichier.'),
      paragraph('Un contact sans valeur numérique exploitable dans MATCHING, MATCH RATIO et Qual est exclu de la sélection du meilleur contact. MATCHING intervient dans le classement uniquement s’il figure dans les critères ci-dessus.')
    ]);

    add('Validation globale des AUTO-ID', [
      paragraph('Les identifications automatiques d’un groupe sont reprises dans SEMIMANUAL ID lorsque toutes les conditions suivantes sont remplies :'),
      list([
        'Le meilleur contact a été validé et son identification manuelle confirme l’AUTO-ID du groupe.',
        'Au moins ' + majority + ' % des contacts du groupe ont un MATCH RATIO supérieur ou égal à ' + ratio + ' (MATCH RATIO ≥ ' + ratio + '). Les deux seuils sont inclusifs. Les ratios absents ou invalides restent compris dans le nombre total de contacts.',
        'L’espèce ne figure pas dans la liste d’exclusion ci-dessous ; un groupe NoID ne reçoit pas de validation globale.',
        'Aucune identification manuelle du groupe ne contredit cet AUTO-ID et aucune décision du groupe ne reste à identifier.'
      ], true),
      paragraph('Espèces et catégories exclues de la validation globale :'),
      list(settings.excludedSpecies.map(speciesLabel).concat(settings.excludedSpecies.some(code => /^noid$/i.test(code))
        ? [] : ['NoID — Chauve-souris non identifiée (exclusion obligatoire).']))
    ]);

    add('Contrôles par échantillon et attribution au prorata', [
      paragraph('Pour les espèces qui ne remplissent pas les conditions de validation globale, la cible est ceil(20 % × effectif du groupe), arrondie au nombre entier supérieur, avec un minimum d’un contact. Le meilleur contact déjà contrôlé est compris dans ce quota.'),
      paragraph('Le groupe AUTO-ID NoID est exclu de la validation globale et suit lui aussi un échantillon de 20 %, meilleur contact compris. Les autres groupes sans espèce identifiée de façon univoque restent à contrôler individuellement.'),
      paragraph('L’échantillon est réparti proportionnellement entre les classes de MATCH RATIO [0 ; 0,2], ]0,2 ; 0,4], ]0,4 ; 0,6], ]0,6 ; 0,8], ]0,8 ; 1] et une classe pour les ratios absents ou invalides. Les quotas entiers utilisent la méthode des plus forts restes en imposant la présence du meilleur contact.'),
      paragraph('Une validation confirme l’AUTO-ID ; après une invalidation, une identification réelle doit être renseignée. Une décision « à identifier » ou une identification manquante reste en attente : elle ne constitue pas une identification NoID terminée et ne contribue pas aux proportions tant qu’elle n’est pas résolue.'),
      paragraph('Le statut « Identification incertaine/non résolue — À revoir » permet de poursuivre les autres contrôles en conservant la liste des contacts à revoir. Tant qu’il reste non résolu, ce contact ne contribue ni aux proportions ni à la validation globale, et la finalisation reste bloquée.'),
      paragraph('Une identification NoID explicitement choisie après vérification est une catégorie terminée. Elle peut participer au prorata, comme les espèces ou Noise explicitement identifiés.'),
      paragraph('Une fois les contrôles obligatoires terminés et les identifications renseignées, les identifications manuelles du groupe, meilleur contact compris, déterminent les proportions. Les contacts restants sont attribués dans SEMIMANUAL ID par la méthode des plus forts restes, qui conserve exactement leur effectif. Les identifications manuelles gardent leur valeur dans MANUAL ID et SEMIMANUAL ID.'),
      paragraph('Les attributions au prorata sont une estimation des effectifs des contacts non écoutés ; elles ne constituent pas une identification acoustique individuelle de chaque WAV. Les alias connus d’une même espèce sont regroupés pour calculer les proportions.'),
      paragraph('Les groupes AUTO-ID Noise sont exclus du parcours. Les identifications calculées sont recalculées lorsque les décisions ou les réglages changent. Le fichier source est conservé ; le CSV de résultats distingue MANUAL ID, SEMIMANUAL ID et ORIGINE ID PLECOTUS.')
    ]);

    add('Options générales et graphiques', [list([
      'Mode débogage : ' + (configuration.debugMode === true ? 'activé' : 'désactivé') + '.',
      'Afficher la Pipistrelle commune par défaut dans les graphiques : ' + (configuration.includeCommonPipistrelle === false ? 'non' : 'oui') + '.'
    ])]);
    const folders = Array.isArray(configuration.wavSearchFolders) ? configuration.wavSearchFolders : [];
    add('Ouverture des WAV', [list([
      'Logiciel sélectionné : ' + viewer + '.',
      'Chemin de l’exécutable Kaleidoscope : ' + (text(configuration.kaleidoscopeExecutable) || 'non renseigné') + '.',
      'Chemin de l’exécutable ChiroSurf : ' + (text(configuration.chirosurfExecutable) || 'non renseigné') + '.'
    ]), paragraph('Dossiers où rechercher les WAV déplacés (avec leurs sous-dossiers) :'),
    folders.length ? list(folders.map(text)) : paragraph('Aucun dossier de recherche renseigné.'),
    paragraph('Le lanceur essaie d’abord le chemin INDIR / FOLDER / IN FILE du fichier id. Si ce chemin est introuvable, il cherche le nom du WAV dans les dossiers ci-dessus. Si plusieurs fichiers portent ce nom, aucun n’est ouvert et les chemins trouvés sont signalés.')]);

    const title = 'Plecotus v22 — paramètres et méthode de vérification';
    const plain = title + '\n' + sections.map(section => '\n' + section.title + '\n'
      + section.blocks.map(block => block.type === 'paragraph' ? block.text
        : block.items.map((item, index) => (block.ordered ? (index + 1) + '. ' : '• ') + item).join('\n')).join('\n\n')).join('\n') + '\n';
    const fragment = '<article><h1>' + escape(title) + '</h1>' + sections.map(section => '<section><h2>' + escape(section.title)
      + '</h2>' + section.blocks.map(block => block.type === 'paragraph' ? '<p>' + escape(block.text) + '</p>'
        : '<' + (block.ordered ? 'ol' : 'ul') + '>' + block.items.map(item => '<li>' + escape(item) + '</li>').join('')
          + '</' + (block.ordered ? 'ol' : 'ul') + '>').join('') + '</section>').join('') + '</article>';
    const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>' + escape(title)
      + '</title><style>body{max-width:52rem;margin:2rem auto;padding:0 1rem;font:11pt/1.5 Calibri,Arial,sans-serif;color:#202820}h1{font-size:20pt}h2{font-size:14pt;margin-top:1.5em}li{margin:.35em 0}p,li{overflow-wrap:anywhere}@media print{body{max-width:none;margin:0}}</style></head><body>'
      + fragment + '</body></html>';
    const fileStem = 'plecotus_v22_parametres_' + parts.year + '-' + parts.month + '-' + parts.day + '_' + parts.hour + parts.minute;
    return { text: plain, html, fragment, fileStem, timestamp };
  }

  return Object.freeze({ build });
});
