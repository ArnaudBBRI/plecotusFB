(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BatSpeciesNames = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Labels are reconciled for presentation/counting only. This catalog never
  // changes an acoustic identification, the source CSV, or workflow rules.
  // Keep the scientific names used by Kaleidoscope, notably Eptesicus serotinus;
  // newer Cnephaeus names are accepted aliases rather than a silent relabelling.
  const SOURCES = Object.freeze({
    codes: Object.freeze({ title: 'Wildlife Acoustics — Bat Auto-ID Supported Species and Abbreviated Codes', url: 'https://answers.wildlifeacoustics.com/r/en-US/Bat-Auto-ID-Performance-and-Supported-Species/Bat-Auto-ID-Supported-Species-and-Abbreviated-Codes' }),
    belgium: Object.freeze({ title: 'Plecotus / Natagora — Les différentes espèces de chauves-souris', url: 'https://plecotus.natagora.be/decouvrez-les-chauves-souris/especes' }),
    wallonia: Object.freeze({ title: 'SPW / Natagora — Liste rouge des chauves-souris en Wallonie (2021)', url: 'https://biodiversite.wallonie.be/files/02.DOCUMENTS/01.eval_biologique/01.monitoring_especes/Mammif%C3%A8res/Chauves-souris/listerouge_chauvessouris_2021.pdf' }),
    walloniaAliases: Object.freeze({ title: 'SPW — Les espèces (non-Oiseaux), noms vernaculaires historiques', url: 'https://biodiversite-old.wallonie.be/servlet/Repository/intro-especes.pdf?ID=31438&saveFile=true' }),
    france: Object.freeze({ title: 'Plan national d’actions en faveur des Chiroptères — Les espèces', url: 'https://plan-actions-chiropteres.fr/les-chauves-souris/les-especes/' }),
    inpn: Object.freeze({ title: 'INPN — Référentiel de sensibilité à la diffusion (noms de chiroptères)', url: 'https://inpn.mnhn.fr/docs-web/docs/download/435603' }),
    isabelle: Object.freeze({ title: 'SECEM — Eptesicus isabellinus', url: 'https://secem.es/index.php/pt/mamiferos/atlas/eptesicus-isabellinus' })
  });

  const records = [
    ['BARBAR', 'Barbastella barbastellus', 'Barbastelle d’Europe', ['Barbastelle commune']],
    ['EPTISA', 'Eptesicus isabellinus', 'Sérotine isabelle', ['Cnephaeus isabellinus']],
    ['EPTNIL', 'Eptesicus nilssonii', 'Sérotine de Nilsson', ['Cnephaeus nilssonii', 'Sérotine boréale']],
    ['EPTSER', 'Eptesicus serotinus', 'Sérotine commune', ['Cnephaeus serotinus']],
    ['HYPSAV', 'Hypsugo savii', 'Vespère de Savi', ['Pipistrelle de Savi']],
    ['MINSCH', 'Miniopterus schreibersii', 'Minioptère de Schreibers', []],
    ['MYOALC', 'Myotis alcathoe', 'Murin d’Alcathoé', ['Murin d’Alcathoe']],
    ['MYOBEC', 'Myotis bechsteinii', 'Murin de Bechstein', ['Myotis bechsteini', 'Vespertilion de Bechstein']],
    ['MYOBRA', 'Myotis brandtii', 'Murin de Brandt', ['Vespertilion de Brandt']],
    ['MYOCAP', 'Myotis capaccinii', 'Murin de Capaccini', []],
    ['MYODAS', 'Myotis dasycneme', 'Murin des marais', ['Vespertilion des marais']],
    ['MYODAU', 'Myotis daubentonii', 'Murin de Daubenton', ['Myotis daubentoni', 'Vespertilion de Daubenton']],
    ['MYOEMA', 'Myotis emarginatus', 'Murin à oreilles échancrées', ['Vespertilion à oreilles échancrées']],
    ['MYOESC', 'Myotis escalerai', 'Murin d’Escalera', []],
    ['MYOMYO', 'Myotis myotis', 'Grand murin', []],
    ['MYOMYS', 'Myotis mystacinus', 'Murin à moustaches', ['Vespertilion à moustaches']],
    ['MYONAT', 'Myotis nattereri', 'Murin de Natterer', ['Vespertilion de Natterer']],
    ['NYCLAS', 'Nyctalus lasiopterus', 'Grande noctule', []],
    ['NYCLEI', 'Nyctalus leisleri', 'Noctule de Leisler', []],
    ['NYCNOC', 'Nyctalus noctula', 'Noctule commune', []],
    ['PIPKUH', 'Pipistrellus kuhlii', 'Pipistrelle de Kuhl', ['Pipistrelle de Kühl']],
    ['PIPNAT', 'Pipistrellus nathusii', 'Pipistrelle de Nathusius', []],
    ['PIPPIP', 'Pipistrellus pipistrellus', 'Pipistrelle commune', []],
    ['PIPPYG', 'Pipistrellus pygmaeus', 'Pipistrelle pygmée', ['Pipistrelle soprane']],
    ['PLEAUR', 'Plecotus auritus', 'Oreillard roux', ['Oreillard brun']],
    ['PLEAUS', 'Plecotus austriacus', 'Oreillard gris', ['Oreillard méridional']],
    ['RHIEUR', 'Rhinolophus euryale', 'Rhinolophe euryale', []],
    ['RHIFER', 'Rhinolophus ferrumequinum', 'Grand rhinolophe', []],
    ['RHIHIP', 'Rhinolophus hipposideros', 'Petit rhinolophe', []],
    ['TADTEN', 'Tadarida teniotis', 'Molosse de Cestoni', []],
    ['VESMUR', 'Vespertilio murinus', 'Sérotine bicolore', ['Vespertilion bicolore']]
  ];
  const SPECIES = Object.freeze(records.map(([code, scientificName, frenchName, aliases]) => Object.freeze({
    key: code, code, scientificName, frenchName, aliases: Object.freeze(aliases), isSpecies: true, known: true, category: 'species'
  })));
  const normalize = value => String(value == null ? '' : value).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’‘`´]/g, "'").replace(/\s+/g, ' ').toLowerCase();
  const lookup = new Map();
  for (const item of SPECIES) for (const alias of [item.code, item.scientificName, item.frenchName, ...item.aliases]) lookup.set(normalize(alias), item);

  function registerGroup(scientificName, frenchName, aliases) {
    const item = Object.freeze({ key: 'group:' + scientificName, code: '', scientificName, frenchName, isSpecies: false, known: true, category: 'group' });
    for (const alias of [scientificName, frenchName, ...aliases]) lookup.set(normalize(alias), item);
  }
  registerGroup('Myotis sp.', 'Murin indéterminé', ['Myotis', 'Myotis sp', 'Myotis spp.', 'MYO', 'MYOSP', 'Myotis indet.', 'Murins']);
  registerGroup('Pipistrellus sp.', 'Pipistrelle indéterminée', ['Pipistrellus', 'Pipistrellus sp', 'Pipistrellus spp.', 'PIP', 'PIPSP', 'Pipistrelles']);
  registerGroup('Plecotus sp.', 'Oreillard indéterminé', ['Plecotus', 'Plecotus sp', 'Plecotus spp.', 'PLE', 'PLESP', 'Oreillards']);
  registerGroup('Nyctalus sp.', 'Noctule indéterminée', ['Nyctalus', 'Nyctalus sp', 'Nyctalus spp.', 'NYC', 'NYCSP', 'Noctules']);
  registerGroup('Eptesicus sp.', 'Sérotine indéterminée', ['Eptesicus', 'Eptesicus sp', 'Eptesicus spp.', 'EPT', 'EPTSP', 'Cnephaeus sp.', 'Cnephaeus sp', 'Sérotines']);
  registerGroup('Rhinolophus sp.', 'Rhinolophe indéterminé', ['Rhinolophus', 'Rhinolophus sp', 'Rhinolophus spp.', 'RHI', 'RHISP', 'Rhinolophes']);

  // These are completed identifications at a deliberately broader level, not
  // unanswered checks. Keep their visible codes: no Latin species is implied.
  // In particular, "sérotule" is the requested acoustic group, not Eptesicus.
  const IDENTIFICATION_LABELS = Object.freeze([
    ['NoID', 'Chauve-souris non identifiée'],
    ['NoID Pip', 'Pipistrelle non identifiée'],
    ['NoID Ser', 'Sérotule non identifiée'],
    ['NoID Myo', 'Murin non identifié'],
    ['NoID Ple', 'Oreillard non identifié']
  ].map(([label, description]) => Object.freeze({ label, description })));

  const special = new Map();
  function registerSpecial(key, frenchName, category, aliases) {
    const item = Object.freeze({ key, code: '', scientificName: '', frenchName, isSpecies: false, known: true, category });
    for (const alias of aliases) special.set(normalize(alias), item);
  }
  registerSpecial('noise', 'Bruit', 'noise', ['Noise', 'Bruit']);
  registerSpecial('pending', 'À vérifier', 'pending', ['', 'Pending classification', 'À vérifier', 'En attente de classification']);
  registerSpecial('uncertain', 'Identification incertaine/non résolue', 'uncertain', ['Uncertain / unresolved', 'Uncertain', 'Unresolved', 'Incertain', 'Identification incertaine', 'Identification incertaine/non résolue', 'Identification incertaine / non résolue', 'Non résolue']);
  const identificationAliases = [
    ['No ID', 'No-ID', 'No_ID', 'NoAutoID', 'No Identification', 'Unclassified', 'Unknown', 'Unidentified bat', 'Chiroptère non identifié', 'Chiroptère indéterminé', 'Chiroptera sp.', 'Chiroptera indet.'],
    ['No ID Pip', 'NoIDPip', 'NoID-Pip', 'NoID_Pip'],
    ['No ID Ser', 'NoIDSer', 'NoID-Ser', 'NoID_Ser'],
    ['No ID Myo', 'NoIDMyo', 'NoID-Myo', 'NoID_Myo'],
    ['No ID Ple', 'NoIDPle', 'NoID-Ple', 'NoID_Ple']
  ];
  IDENTIFICATION_LABELS.forEach(({ label, description }, index) => {
    const item = Object.freeze({ key: index === 0 ? 'unidentified' : 'unidentified:' + label, code: label, scientificName: label, frenchName: description, isSpecies: false, known: true, category: 'unidentified' });
    for (const alias of [label, description, ...identificationAliases[index]]) special.set(normalize(alias), item);
  });

  function resolve(label) {
    const text = String(label == null ? '' : label).trim().replace(/\s+/g, ' ');
    const normalized = normalize(text);
    const exact = lookup.get(normalized) || special.get(normalized);
    if (exact) return { ...exact };
    // Only remove an explicit trailing taxonomic authority containing a year.
    // Slashes, "cf.", "?" and complexes are never reduced to the first species.
    const authority = text.match(/^([A-Za-z]+\s+[a-z]+)\s+(?:\([^)]*\b\d{4}\)|[A-Za-z][A-Za-z .&,-]*\b\d{4})$/);
    const named = authority && lookup.get(normalize(authority[1]));
    if (named) return { ...named };
    return { key: 'unknown:' + text.toLocaleLowerCase('fr'), code: '', scientificName: text, frenchName: 'Nom non renseigné', isSpecies: false, known: false, category: 'unknown' };
  }

  function isActivitySummaryEntry(entry) {
    if (!entry || !['taxon', 'unresolved'].includes(entry.category)) return false;
    const name = resolve(entry.label);
    if (['noise', 'pending', 'uncertain'].includes(name.category)) return false;
    // "unresolved" is also used by the classifier for a finalized NoID label.
    // A genuinely pending check must not enter this report, even if its draft
    // label mentions one of these outcomes.
    return entry.category === 'taxon' || name.category === 'unidentified';
  }

  function activityRows(summary) {
    if (!Array.isArray(summary)) throw new TypeError('Le bilan des contacts doit être un tableau.');
    const totals = new Map();
    for (const entry of summary) {
      // The classifier's final summary has already applied MANUAL ID priority.
      // Count its total once; manual/inferred are subsets, not extra contacts.
      if (!isActivitySummaryEntry(entry)) continue;
      if (!Number.isSafeInteger(entry.total) || entry.total < 0) throw new TypeError('Le nombre de contacts doit être un entier positif ou nul.');
      if (!entry.total) continue;
      const name = resolve(entry.label);
      if (!totals.has(name.key)) totals.set(name.key, { key: name.key, scientificName: name.scientificName, frenchName: name.frenchName, isSpecies: name.isSpecies, known: name.known, category: name.category, contacts: 0 });
      totals.get(name.key).contacts += entry.total;
      if (!Number.isSafeInteger(totals.get(name.key).contacts)) throw new RangeError('Le total des contacts est trop élevé.');
    }
    return [...totals.values()].sort((a, b) => a.scientificName.localeCompare(b.scientificName, 'fr') || a.frenchName.localeCompare(b.frenchName, 'fr'));
  }

  // This is only a view filter. The complete activity table, CSV export and
  // classification keep their original rows and counts. Use the primary
  // identity so an ambiguous scientific label cannot be hidden merely because
  // a secondary display name happens to mention the common pipistrelle.
  function chartRows(rows, includeCommonPipistrelle = true) {
    if (!Array.isArray(rows)) throw new TypeError('Les données du graphique doivent être un tableau.');
    const visible = [];
    let omittedContacts = 0;
    for (const row of rows) {
      if (!row || typeof row !== 'object') throw new TypeError('Une ligne du graphique est invalide.');
      if (!Number.isSafeInteger(row.contacts) || row.contacts < 0) throw new TypeError('Le nombre de contacts doit être un entier positif ou nul.');
      const identity = [row.key, row.scientificName, row.frenchName].find(value => value != null && String(value).trim());
      if (!includeCommonPipistrelle && resolve(identity).key === 'PIPPIP') {
        omittedContacts += row.contacts;
        if (!Number.isSafeInteger(omittedContacts)) throw new RangeError('Le total des contacts exclus est trop élevé.');
      } else visible.push(row);
    }
    return { rows: visible, omittedContacts };
  }

  return { SOURCES, SPECIES, IDENTIFICATION_LABELS, normalize, resolve, isActivitySummaryEntry, activityRows, chartRows };
});
