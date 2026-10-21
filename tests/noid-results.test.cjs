const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../core.js');
const Classification = require('../automation.js');
const Names = require('../species.js');
const Chart = require('../activity-chart.js');
const ImageExport = require('../activity-export.js');

const expectedLabels = [
  ['NoID', 'Chauve-souris non identifiée'],
  ['NoID Pip', 'Pipistrelle non identifiée'],
  ['NoID Ser', 'Sérotule non identifiée'],
  ['NoID Myo', 'Murin non identifié'],
  ['NoID Ple', 'Oreillard non identifié']
];
const headers = ['IN FILE', 'AUTO ID', 'PULSES', 'MATCHING', 'MATCH RATIO', 'MANUAL ID'];
function csv(records) {
  const text = Core.stringifyCSV(headers, records, ';');
  const parsed = Core.parseCSV(text);
  return { headers: parsed.headers, ...Core.analyze(parsed.headers, parsed.records) };
}
function report(source, reviews, selections) {
  const classification = Classification.classify(source, reviews || {}, {}, {}, selections || {});
  return { classification, rows: Names.activityRows(classification.summary) };
}
function assertConservation(classification) {
  const metrics = classification.metrics;
  assert.equal(metrics.manual + metrics.inferred + metrics.ignored + metrics.pending, metrics.total);
  assert.equal(classification.summary.reduce((sum, entry) => sum + entry.total, 0), metrics.total);
}

test('five explicit NoID MANUAL ID values survive CSV import and appear in final tables and both chart image modes', () => {
  const parsed = Core.parseCSV(fs.readFileSync(path.join(__dirname, 'fixtures/noid-labels-id.csv'), 'utf8'));
  const source = { headers: parsed.headers, ...Core.analyze(parsed.headers, parsed.records) };
  const originalRows = JSON.stringify(source.rows.map(row => row.raw));
  const { classification, rows } = report(source);
  assert.equal(classification.metrics.manual, 6);
  assert.equal(classification.metrics.inferred, 0);
  assert.equal(classification.metrics.pending, 0);
  assert.equal(classification.metrics.unresolved, 5);
  assert.equal(classification.metrics.ignored, 1);
  assert.equal(rows.reduce((sum, row) => sum + row.contacts, 0), 6);
  for (const [label, description] of expectedLabels) {
    const row = rows.find(item => item.scientificName === label);
    assert.ok(row, label + ' is present in the final activity table');
    assert.equal(row.frenchName, description);
    assert.equal(row.contacts, 1);
    assert.equal(row.isSpecies, false);
    const assignment = classification.assignments.find(item => item.label === label);
    assert.equal(assignment.origin, 'manual');
    assert.equal(assignment.decisionSource, 'source');
    assert.equal(assignment.requiresReview, false);
  }
  const prepared = Chart.prepare(rows);
  assert.equal(prepared.total, 6);
  assert.equal(prepared.rows.length, 6);
  for (const mode of ['pie', 'bar']) {
    const exported = ImageExport.svg(rows, mode, { ignoredNoise: 1, totalContacts: 7, pendingContacts: 0 });
    assert.equal((exported.svg.match(/data-series=/g) || []).length, 6);
    for (const [label, description] of expectedLabels) {
      assert.ok(exported.svg.includes(label), 'The ' + mode + ' image retains ' + label);
      assert.ok(exported.svg.includes(description), 'The ' + mode + ' image retains the French description');
    }
  }
  const exportedCSV = Core.parseCSV(Core.stringifyCSV(
    ['Nom scientifique', 'Nom vernaculaire', 'Nombre de contacts'],
    rows.map(row => [row.scientificName, row.frenchName, row.contacts]), ';'
  ));
  for (const [label, description] of expectedLabels) assert.ok(exportedCSV.records.some(row => row[0] === label && row[1] === description && row[2] === '1'));
  assert.equal(JSON.stringify(source.rows.map(row => row.raw)), originalRows);
  assertConservation(classification);
});

test('NoID labels in a completed imported manual sample propagate by proportion and retain every contact in results', () => {
  const source = csv(Array.from({ length: 25 }, (_, index) => [
    'sample-' + index + '.wav', 'NYCNOC', '100', String(100 - index), '0.9',
    index < expectedLabels.length ? expectedLabels[index][0] : ''
  ]));
  const selectedIds = source.rows.slice(0, 5).map(row => row.id);
  const { classification, rows } = report(source, {}, { 'species:NYCNOC': { sampleTarget: 5, selectedIds } });
  assert.equal(classification.groups[0].mode, 'proportion');
  assert.equal(classification.metrics.manual, 5);
  assert.equal(classification.metrics.inferred, 20);
  assert.equal(classification.metrics.pending, 0);
  assert.equal(classification.metrics.unresolved, 25);
  assert.equal(rows.length, 5);
  assert.equal(rows.reduce((sum, row) => sum + row.contacts, 0), 25);
  for (const [label, description] of expectedLabels) {
    assert.equal(rows.find(row => row.scientificName === label).contacts, 5);
    assert.equal(rows.find(row => row.scientificName === label).frenchName, description);
    assert.equal(classification.assignments.filter(item => item.label === label && item.origin === 'inferred').length, 4);
  }
  assert.ok(classification.assignments.filter(item => item.origin === 'inferred').every(item => item.semimanualLabel === item.label && item.status !== 'inferred-uncertain'));
  assertConservation(classification);
});

test('unreviewed AUTO-ID NoID remains pending and unspecified uncertainty or ignored Noise never inflates NoID results', () => {
  const source = csv([
    ['pending.wav', 'NoID', '10', '0', '0', ''],
    ['explicit-noid.wav', 'NoID', '10', '0', '0', 'NoID'],
    ['uncertain.wav', 'NoID', '10', '0', '0', ''],
    ['ignored-noise.wav', 'Noise', '0', '0', '0', '']
  ]);
  const { classification, rows } = report(source, { [source.rows[2].id]: { label: 'MYOMYO', status: 'uncertain' } });
  assert.equal(classification.metrics.pending, 1);
  assert.equal(classification.metrics.required, 1);
  assert.equal(classification.metrics.uncertain, 1);
  assert.equal(classification.metrics.ignored, 1);
  assert.equal(classification.byId.get(source.rows[0].id).origin, 'pending');
  assert.deepEqual(rows.map(row => [row.scientificName, row.contacts]), [['NoID', 1]]);
  assertConservation(classification);
});

test('explicit NoID outcomes saved as uncertain retain their labels and proportionate counts, including the legacy French choice', () => {
  const labels = expectedLabels.map(entry => entry[0]).concat('Chauve-souris non identifiée');
  const source = csv(Array.from({ length: 24 }, (_, index) => [
    'legacy-' + index + '.wav', 'NYCNOC', '100', String(100 - index), '0.9', ''
  ]));
  const reviews = Object.fromEntries(labels.map((label, index) => [source.rows[index].id, { label, status: 'uncertain' }]));
  const selectedIds = source.rows.slice(0, labels.length).map(row => row.id);
  const { classification, rows } = report(source, reviews, { 'species:NYCNOC': { sampleTarget: labels.length, selectedIds } });
  assert.equal(classification.metrics.manual, 6);
  assert.equal(classification.metrics.inferred, 18);
  assert.equal(classification.metrics.uncertain, 0);
  assert.equal(classification.metrics.pending, 0);
  assert.equal(rows.length, 5);
  assert.equal(rows.reduce((sum, row) => sum + row.contacts, 0), 24);
  assert.equal(rows.find(row => row.scientificName === 'NoID').contacts, 8);
  for (const [label] of expectedLabels.slice(1)) assert.equal(rows.find(row => row.scientificName === label).contacts, 4);
  for (const label of labels) {
    assert.equal(classification.assignments.filter(item => item.label === label && item.origin === 'inferred').length, 3);
  }
  assert.ok(classification.assignments.filter(item => item.origin === 'inferred').every(item => item.status === 'inferred'));
  assertConservation(classification);
});

test('a propagated generic uncertainty does not merge into a separately chosen countable NoID outcome', () => {
  const source = csv(Array.from({ length: 10 }, (_, index) => [
    'mixed-' + index + '.wav', 'NYCNOC', '100', String(100 - index), '0.9', ''
  ]));
  const reviews = {
    [source.rows[0].id]: { label: 'Chauve-souris non identifiée', status: 'uncertain' },
    [source.rows[1].id]: { label: 'MYOMYO', status: 'uncertain' }
  };
  const selectedIds = source.rows.slice(0, 2).map(row => row.id);
  const { classification, rows } = report(source, reviews, { 'species:NYCNOC': { sampleTarget: 2, selectedIds } });
  assert.equal(classification.metrics.manual, 2);
  assert.equal(classification.metrics.inferred, 8);
  assert.equal(classification.metrics.uncertain, 5);
  assert.deepEqual(rows.map(row => [row.scientificName, row.contacts]), [['NoID', 5]]);
  assert.equal(classification.assignments.filter(item => item.status === 'inferred-uncertain').length, 4);
  assert.equal(classification.assignments.filter(item => item.status === 'inferred' && item.label === 'Chauve-souris non identifiée').length, 4);
  assertConservation(classification);
});

test('French NoID descriptions and former Chiroptère aliases remain countable when saved as uncertain', () => {
  const labels = expectedLabels.map(entry => entry[1]).concat('Chiroptère non identifié', 'Chiroptère indéterminé', 'Chiroptera sp.', 'Chiroptera indet.');
  const source = csv(labels.map((label, index) => [
    'description-' + index + '.wav', 'NoID', '10', '0', '0', ''
  ]));
  for (const spelling of [label => label, label => label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()]) {
    const reviews = Object.fromEntries(labels.map((label, index) => [source.rows[index].id, { label: spelling(label), status: 'uncertain' }]));
    const { classification, rows } = report(source, reviews);
    assert.equal(classification.metrics.manual, labels.length);
    assert.equal(classification.metrics.pending, 0);
    assert.equal(classification.metrics.uncertain, 0);
    assert.equal(rows.length, 5);
    assert.equal(rows.find(row => row.scientificName === 'NoID').contacts, 5);
    for (const [label] of expectedLabels.slice(1)) assert.equal(rows.find(row => row.scientificName === label).contacts, 1);
    assertConservation(classification);
  }
});

test('a project correction takes priority over an imported NoID label and hiding common pipistrelle preserves NoID Pip', () => {
  const source = csv([
    ['corrected.wav', 'NoID', '10', '0', '0', 'NoID Pip'],
    ['pipistrelle-non-identifiee.wav', 'NoID', '10', '0', '0', 'NoID Pip'],
    ['common-pipistrelle.wav', 'PIPPIP', '10', '9', '0.9', 'PIPPIP']
  ]);
  const { classification, rows } = report(source, { [source.rows[0].id]: { label: 'MYODAU', status: 'corrected' } });
  assert.equal(classification.byId.get(source.rows[0].id).label, 'MYODAU');
  assert.equal(rows.find(row => row.scientificName === 'NoID Pip').contacts, 1);
  assert.equal(rows.find(row => row.scientificName === 'Myotis daubentonii').contacts, 1);
  const filtered = Names.chartRows(rows, false);
  assert.equal(filtered.omittedContacts, 1);
  assert.deepEqual(filtered.rows.map(row => row.scientificName), ['Myotis daubentonii', 'NoID Pip']);
  assert.equal(Chart.prepare(filtered.rows).total, 2);
  assertConservation(classification);
});
