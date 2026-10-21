const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Classification = require('../automation.js');
const Summary = require('../import-summary.js');

const headers = ['IN FILE', 'AUTO ID', 'MATCHING', 'MATCH RATIO', 'MANUAL ID', 'NOTES'];
function data(labels, autoIds = []) {
  const records = labels.map((label, index) => [`contact-${index}.wav`, autoIds[index] || 'PIPPIP', String(labels.length - index), '0.9', label, 'NoID is mentioned in a note']);
  return { headers, ...Core.analyze(headers, records) };
}

test('counts actual filled MANUAL ID cells before reviewing and does not confuse notes or AUTO ID', () => {
  const source = data(['', ' \t ', ' PIPPIP ', 'Pipistrellus pipistrellus', 'Noise'], ['NoID', 'NYCNOC', 'PIPPIP', 'PIPPIP', 'Noise']);
  const summary = Summary.summarize(source, Classification.classify(source));
  assert.equal(summary.filledCount, 3);
  assert.equal(summary.activeCount, 3);
  assert.equal(summary.overriddenCount, 0);
  assert.equal(summary.unresolvedCount, 0);
  assert.equal(summary.unrecognizedCount, 0);
  assert.deepEqual(summary.labels.find(entry => entry.label === 'PIPPIP'), { label: 'PIPPIP', count: 1, activeCount: 1, known: true, category: 'species' });
  assert.equal(summary.labels.find(entry => entry.label === 'Noise').category, 'noise');
  assert.equal(summary.groups.find(entry => entry.autoId === 'PIPPIP').sourceCount, 2);
  assert.equal(summary.groups.find(entry => entry.autoId === 'Noise').activeCount, 1);
});

test('keeps every source spelling and distinguishes unresolved labels from unrecognized free labels', () => {
  const source = data(['NoID', 'Uncertain / unresolved', 'Pending classification', 'Myotis sp.', 'Complexe local A / B', 'PIPPIP', ' PIPPIP ', 'pippip']);
  const summary = Summary.summarize(source, Classification.classify(source));
  assert.equal(summary.filledCount, 8);
  assert.equal(summary.activeCount, 8);
  assert.equal(summary.unresolvedCount, 3);
  assert.equal(summary.unrecognizedCount, 1);
  assert.equal(summary.labels.length, 7);
  assert.equal(summary.labels.find(entry => entry.label === 'PIPPIP').count, 2);
  assert.equal(summary.labels.find(entry => entry.label === 'pippip').count, 1);
  assert.equal(summary.labels.find(entry => entry.label === 'Myotis sp.').category, 'group');
  assert.equal(summary.labels.find(entry => entry.label === 'Complexe local A / B').known, false);
  assert.equal(summary.labels.find(entry => entry.label === 'NoID').known, true);
});

test('source inventory remains visible when local corrections and invalid decisions supersede imported labels', () => {
  const source = data(['PIPPIP', 'Noise', 'NoID', 'MYODAU']);
  const [first, second, third, fourth] = source.rows;
  const reviews = {
    [first.id]: { status: 'corrected', label: 'MYODAU' },
    [second.id]: { status: 'confirmed', label: '' },
    [third.id]: { status: 'uncertain', label: 'Uncertain / unresolved' }
  };
  const drafts = { [fourth.id]: { status: 'corrected', label: 'PIPPIP' } };
  const summary = Summary.summarize(source, Classification.classify(source, reviews, {}, drafts));
  assert.equal(summary.filledCount, 4);
  assert.equal(summary.activeCount, 1, 'An unsaved draft does not supersede the engine’s saved source decision.');
  assert.equal(summary.overriddenCount, 3);
  assert.equal(summary.unresolvedCount, 1, 'This describes the original source labels, even after correction.');
  assert.equal(summary.labels.find(entry => entry.label === 'MYODAU').activeCount, 1);
  assert.equal(summary.labels.find(entry => entry.label === 'PIPPIP').activeCount, 0);
  assert.equal(summary.labels.find(entry => entry.label === 'Noise').count, 1);
  assert.equal(summary.groups[0].sourceCount, 4);
  assert.equal(summary.groups[0].activeCount, 1);
});

test('shows filled manual labels when all source contacts are already manual, including Noise corrections', () => {
  const source = data(['PIPPIP', 'PIPPIP', 'MYODAU', 'Noise'], ['Noise', 'PIPPIP', 'NoID', 'Noise']);
  const classification = Classification.classify(source);
  assert.equal(classification.metrics.required, 0);
  const summary = Summary.summarize(source, classification);
  assert.equal(summary.filledCount, 4);
  assert.equal(summary.activeCount, 4);
  assert.equal(summary.groups.reduce((total, entry) => total + entry.sourceCount, 0), 4);
  assert.equal(summary.groups.find(entry => entry.autoId === 'Noise').activeCount, 2);
});

test('an absent MANUAL ID column produces a zero inventory', () => {
  const sourceHeaders = ['IN FILE', 'AUTO ID', 'MATCH RATIO'];
  const source = { headers: sourceHeaders, ...Core.analyze(sourceHeaders, [['bat.wav', 'PIPPIP', '0.9']]) };
  assert.deepEqual(Summary.summarize(source, Classification.classify(source)), {
    filledCount: 0, activeCount: 0, overriddenCount: 0, unresolvedCount: 0, unrecognizedCount: 0, labels: [], groups: []
  });
});

test('works with object assignment lookup and never modifies source, decisions, or classifier groups', () => {
  const source = data([' PIPPIP ', 'Espèce libre', 'Unresolved']);
  const classification = Classification.classify(source);
  classification.byId = Object.fromEntries(classification.byId);
  const beforeSource = JSON.stringify(source);
  const beforeClassification = JSON.stringify(classification);
  Summary.summarize(source, classification);
  assert.equal(JSON.stringify(source), beforeSource);
  assert.equal(JSON.stringify(classification), beforeClassification);
});

test('rejects missing classification inputs and contacts missing from their classification', () => {
  assert.throws(() => Summary.summarize(null, null), TypeError);
  const source = data(['PIPPIP']);
  const classification = Classification.classify(source);
  classification.byId.delete(source.rows[0].id);
  assert.throws(() => Summary.summarize(source, classification), /absent/);
});
