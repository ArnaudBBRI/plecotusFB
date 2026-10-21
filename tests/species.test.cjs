const test = require('node:test');
const assert = require('node:assert/strict');
const Names = require('../species.js');

test('the requested scientific and French names are resolved from Kaleidoscope codes', () => {
  assert.equal(Names.resolve('EPTSER').scientificName, 'Eptesicus serotinus');
  assert.equal(Names.resolve('EPTSER').frenchName, 'Sérotine commune');
  assert.equal(Names.resolve('MYODAS').scientificName, 'Myotis dasycneme');
  assert.equal(Names.resolve('MYODAS').frenchName, 'Murin des marais');
  assert.equal(Names.SPECIES.length, 31);
  assert.equal(new Set(Names.SPECIES.map(item => item.code)).size, 31);
  for (const item of Names.SPECIES) {
    assert.match(item.scientificName, /^[A-Z][a-z]+ [a-z]+$/);
    assert.equal(Names.resolve(item.scientificName).key, item.code);
    assert.equal(Names.resolve(item.frenchName).key, item.code);
    assert.equal(Names.resolve(item.code).isSpecies, true);
  }
});

test('the nine excluded species all have scientific and French display names', () => {
  const pairs = {
    BARBAR: ['Barbastella barbastellus', 'Barbastelle d’Europe'],
    RHIFER: ['Rhinolophus ferrumequinum', 'Grand rhinolophe'],
    RHIHIP: ['Rhinolophus hipposideros', 'Petit rhinolophe'],
    MYOBEC: ['Myotis bechsteinii', 'Murin de Bechstein'],
    MYODAS: ['Myotis dasycneme', 'Murin des marais'],
    MYOMYO: ['Myotis myotis', 'Grand murin'],
    MYOEMA: ['Myotis emarginatus', 'Murin à oreilles échancrées'],
    NYCNOC: ['Nyctalus noctula', 'Noctule commune'],
    NYCLEI: ['Nyctalus leisleri', 'Noctule de Leisler']
  };
  for (const [code, expected] of Object.entries(pairs)) {
    const actual = Names.resolve(code);
    assert.deepEqual([actual.scientificName, actual.frenchName], expected);
  }
});

test('French accents, apostrophes, case and accepted scientific synonyms merge safely', () => {
  for (const alias of [' eptser ', 'eptesicus SEROTINUS', 'SEROTINE COMMUNE', 'Cnephaeus serotinus', 'Eptesicus serotinus (Schreber, 1774)']) assert.equal(Names.resolve(alias).key, 'EPTSER');
  for (const alias of ["Murin d'Alcathoe", 'murin d’alcathoé', 'MYOALC']) assert.equal(Names.resolve(alias).key, 'MYOALC');
  assert.equal(Names.resolve('Myotis bechsteini').key, 'MYOBEC');
  assert.equal(Names.resolve('Myotis daubentoni').key, 'MYODAU');
  assert.equal(Names.resolve('Vespertilion bicolore').key, 'VESMUR');
});

test('groups, complexes and unknown labels never become an invented certain species', () => {
  const group = Names.resolve('Myotis sp');
  assert.equal(group.scientificName, 'Myotis sp.');
  assert.equal(group.frenchName, 'Murin indéterminé');
  assert.equal(group.isSpecies, false);
  assert.equal(group.category, 'group');
  for (const label of ['EPTSER/PIPPIP', 'Myotis myotis / Myotis blythii', 'Myotis cf. myotis', 'Myotis myotis ?', 'Espèce A', '<script>label</script>']) {
    const actual = Names.resolve(label);
    assert.equal(actual.scientificName, label);
    assert.equal(actual.frenchName, 'Nom non renseigné');
    assert.equal(actual.isSpecies, false);
    assert.equal(actual.known, false);
  }
});

test('activity totals merge code, Latin and French aliases and count summary totals once', () => {
  const rows = Names.activityRows([
    { category: 'taxon', label: 'EPTSER', total: 10, manual: 2, inferred: 8 },
    { category: 'taxon', label: 'Eptesicus serotinus', total: 5, manual: 1, inferred: 4 },
    { category: 'taxon', label: 'Sérotine commune', total: 3, manual: 3, inferred: 0 },
    { category: 'taxon', label: 'Cnephaeus serotinus', total: 2 },
    { category: 'taxon', label: 'MYODAS', total: 7 }
  ]);
  assert.deepEqual(rows.map(row => [row.scientificName, row.frenchName, row.contacts]), [
    ['Eptesicus serotinus', 'Sérotine commune', 20],
    ['Myotis dasycneme', 'Murin des marais', 7]
  ]);
  assert.equal(rows.reduce((total, row) => total + row.contacts, 0), 27);
});

test('activity report excludes pending, noise and uncertain outcomes while counting finalized NoID', () => {
  const rows = Names.activityRows([
    { category: 'noise', label: 'Noise', total: 10 },
    { category: 'pending', label: 'Pending classification', total: 5 },
    { category: 'uncertain', label: 'Uncertain / unresolved', total: 3 },
    { category: 'unresolved', label: 'NoID', total: 2 },
    { category: 'taxon', label: 'Bruit', total: 1 },
    { category: 'taxon', label: 'No ID', total: 1 },
    { category: 'pending', label: 'NoID Pip', total: 8 },
    { category: 'uncertain', label: 'NoID Myo', total: 9 },
    { category: 'unresolved', label: 'Free unresolved label', total: 9 },
    { category: 'taxon', label: 'Myotis sp.', total: 4 },
    { category: 'taxon', label: 'Myotis sp', total: 2 },
    { category: 'taxon', label: 'Complexe local A / B', total: 7 },
    { category: 'taxon', label: 'NYCNOC', total: 0 }
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.find(row => row.category === 'unidentified'), {
    key: 'unidentified', scientificName: 'NoID', frenchName: 'Chauve-souris non identifiée', isSpecies: false, known: true, category: 'unidentified', contacts: 3
  });
  assert.equal(rows.find(row => row.category === 'group').contacts, 6);
  const unknown = rows.find(row => row.category === 'unknown');
  assert.equal(unknown.scientificName, 'Complexe local A / B');
  assert.equal(unknown.frenchName, 'Nom non renseigné');
  assert.equal(unknown.contacts, 7);
  assert.equal(unknown.known, false);
});

test('the five selectable NoID labels retain distinct exact codes and French names without invented species', () => {
  assert.deepEqual(Names.IDENTIFICATION_LABELS, [
    { label: 'NoID', description: 'Chauve-souris non identifiée' },
    { label: 'NoID Pip', description: 'Pipistrelle non identifiée' },
    { label: 'NoID Ser', description: 'Sérotule non identifiée' },
    { label: 'NoID Myo', description: 'Murin non identifié' },
    { label: 'NoID Ple', description: 'Oreillard non identifié' }
  ]);
  assert.equal(Object.isFrozen(Names.IDENTIFICATION_LABELS), true);
  const keys = new Set();
  for (const item of Names.IDENTIFICATION_LABELS) {
    assert.equal(Object.isFrozen(item), true);
    const resolved = Names.resolve(item.label);
    keys.add(resolved.key);
    assert.equal(resolved.code, item.label);
    assert.equal(resolved.scientificName, item.label);
    assert.equal(resolved.frenchName, item.description);
    assert.equal(resolved.isSpecies, false);
    assert.equal(resolved.known, true);
    assert.equal(resolved.category, 'unidentified');
    assert.deepEqual(Names.resolve(item.description), resolved);
    assert.equal(Names.isActivitySummaryEntry({ category: 'taxon', label: item.label }), true);
    assert.equal(Names.isActivitySummaryEntry({ category: 'unresolved', label: item.label }), true);
    for (const category of ['noise', 'pending', 'uncertain']) assert.equal(Names.isActivitySummaryEntry({ category, label: item.label }), false);
  }
  assert.equal(keys.size, 5);
  assert.notEqual(Names.resolve('NoID Ser').key, Names.resolve('Eptesicus sp.').key);
});

test('NoID import aliases merge only within the exact requested identification level', () => {
  const aliases = [
    ['NoID', 'No ID', 'No-ID', 'No_ID', 'Unidentified bat', 'Chiroptère non identifié', 'Chauve-souris non identifiée', 'Unknown', 'Unclassified'],
    ['NoID Pip', 'No ID Pip', 'noidpip', 'NoID-Pip', 'NoID_Pip', 'PIPISTRELLE NON IDENTIFIEE'],
    ['NoID Ser', 'No ID Ser', 'NoIDSer', 'NoID-Ser', 'NoID_Ser', 'serotule non identifiee'],
    ['NoID Myo', 'No ID Myo', 'NoIDMyo', 'NoID-Myo', 'NoID_Myo', 'MURIN NON IDENTIFIE'],
    ['NoID Ple', 'No ID Ple', 'NoIDPle', 'NoID-Ple', 'NoID_Ple', 'oreillard non identifié']
  ];
  const summary = aliases.flatMap((labels, index) => labels.map((label, i) => ({ category: i % 2 ? 'unresolved' : 'taxon', label, total: index + 1 })));
  const original = structuredClone(summary);
  const rows = Names.activityRows(summary);
  assert.equal(rows.length, 5);
  for (const [index, labels] of aliases.entries()) {
    const row = rows.find(row => row.scientificName === labels[0]);
    assert.equal(row.contacts, labels.length * (index + 1));
    assert.equal(row.isSpecies, false);
    assert.equal(row.frenchName, Names.IDENTIFICATION_LABELS[index].description);
  }
  assert.deepEqual(summary, original);
  assert.equal(rows.reduce((sum, row) => sum + row.contacts, 0), summary.reduce((sum, row) => sum + row.total, 0));
  for (const label of ['NoID PIPPIP', 'NoID Ser/EPTSER', 'NoID Myo à revoir', 'NoID Pip ?']) assert.equal(Names.resolve(label).category, 'unknown');
});

test('hiding common pipistrelle preserves all five NoID results and genus-level identifications', () => {
  const rows = Names.activityRows([
    { category: 'taxon', label: 'PIPPIP', total: 1000 },
    ...Names.IDENTIFICATION_LABELS.map(({ label }, index) => ({ category: 'taxon', label, total: index + 1 })),
    { category: 'taxon', label: 'Pipistrellus sp.', total: 4 }
  ]);
  const result = Names.chartRows(rows, false);
  assert.equal(result.omittedContacts, 1000);
  assert.equal(result.rows.length, 6);
  assert.equal(result.rows.reduce((sum, row) => sum + row.contacts, 0), 19);
  assert.equal(result.rows.filter(row => row.category === 'unidentified').length, 5);
});

test('activity report rejects invalid counts rather than concatenating or inventing contacts', () => {
  assert.deepEqual(Names.activityRows([]), []);
  assert.throws(() => Names.activityRows(null), /tableau/);
  for (const total of ['5', -1, NaN, 2.5]) assert.throws(() => Names.activityRows([{ category: 'taxon', label: 'EPTSER', total }]), /entier/);
  assert.throws(() => Names.activityRows([{ category: 'unresolved', label: 'NoID', total: '5' }]), /entier/);
  assert.throws(() => Names.activityRows([{ category: 'taxon', label: 'NoID', total: Number.MAX_SAFE_INTEGER }, { category: 'unresolved', label: 'No ID', total: 1 }]), /trop élevé/);
});

test('chart filter defaults to the complete activity table and always returns a new array', () => {
  const rows = Object.freeze(Names.activityRows([
    { category: 'taxon', label: 'PIPPIP', total: 150 },
    { category: 'taxon', label: 'PIPNAT', total: 7 }
  ]).map(Object.freeze));
  for (const include of [undefined, true]) {
    const result = Names.chartRows(rows, include);
    assert.notEqual(result.rows, rows);
    assert.deepEqual(result.rows, rows);
    assert.equal(result.omittedContacts, 0);
    assert.ok(result.rows.every((row, index) => row === rows[index]));
  }
  const filtered = Names.chartRows(rows, false);
  assert.deepEqual(filtered.rows.map(row => row.key), ['PIPNAT']);
  assert.equal(filtered.omittedContacts, 150);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.key === 'PIPPIP').contacts, 150);
});

test('common pipistrelle code, Latin and French aliases are merged before filtering', () => {
  const rows = Names.activityRows([
    { category: 'taxon', label: 'pippip', total: 50 },
    { category: 'taxon', label: 'Pipistrellus pipistrellus', total: 30 },
    { category: 'taxon', label: 'PIPISTRELLE COMMUNE', total: 20 },
    { category: 'taxon', label: 'Pipistrellus pipistrellus (Schreber, 1774)', total: 5 },
    { category: 'taxon', label: 'PIPPYG', total: 4 }
  ]);
  const result = Names.chartRows(rows, false);
  assert.equal(result.omittedContacts, 105);
  assert.deepEqual(result.rows.map(row => [row.key, row.contacts]), [['PIPPYG', 4]]);
  assert.equal(rows.find(row => row.key === 'PIPPIP').contacts, 105);
});

test('chart filter recognizes exact primary identities but preserves other pipistrelles and ambiguous labels', () => {
  const omitted = [
    { key: 'pippip', contacts: 1 },
    { scientificName: ' Pipistrellus pipistrellus ', contacts: 2 },
    { frenchName: 'PIPISTRELLE COMMUNE', contacts: 3 }
  ];
  const preserved = [
    'PIPNAT', 'PIPPYG', 'Pipistrellus sp.', 'PIPPIP/PIPNAT',
    'Pipistrellus cf. pipistrellus', 'Pipistrellus pipistrellus ?',
    'NoID PIPPIP', 'Pipistrelle commune à vérifier'
  ].map(scientificName => ({ scientificName, contacts: 1 }));
  preserved.push({ scientificName: 'PIPPIP/PIPPYG', frenchName: 'Pipistrelle commune', contacts: 1 });
  preserved.push({ key: 'group:Pipistrellus sp.', scientificName: 'Pipistrelle commune', contacts: 1 });
  const rows = [...omitted, ...preserved], snapshot = structuredClone(rows);
  const result = Names.chartRows(rows, false);
  assert.equal(result.omittedContacts, 6);
  assert.deepEqual(result.rows, preserved);
  assert.deepEqual(rows, snapshot);
});

test('absent common pipistrelle, zero counts and only common pipistrelle are handled without invented rows', () => {
  assert.deepEqual(Names.chartRows([], false), { rows: [], omittedContacts: 0 });
  const other = [{ scientificName: 'Myotis myotis', contacts: 3 }];
  assert.deepEqual(Names.chartRows(other, false), { rows: other, omittedContacts: 0 });
  assert.notEqual(Names.chartRows(other, false).rows, other);
  assert.deepEqual(Names.chartRows([{ key: 'PIPPIP', contacts: 0 }], false), { rows: [], omittedContacts: 0 });
  assert.deepEqual(Names.chartRows([{ key: 'PIPPIP', contacts: 5 }], false), { rows: [], omittedContacts: 5 });
});

test('chart filter rejects invalid activity rows and counts in either visibility mode', () => {
  assert.throws(() => Names.chartRows(null), /tableau/);
  for (const include of [true, false]) {
    assert.throws(() => Names.chartRows([null], include), /ligne/);
    for (const contacts of [-1, NaN, Infinity, '5', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => Names.chartRows([{ key: 'PIPPIP', contacts }], include), /entier/);
    }
  }
});
