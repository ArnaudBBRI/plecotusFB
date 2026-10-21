const test = require('node:test');
const assert = require('node:assert/strict');
const Bulk = require('../bulk-confirmation.js');
const Core = require('../core.js');
const A = require('../automation.js');

const timestamp = '2026-10-10T12:00:00.000Z';
const options = { groupKey: 'species:NYCNOC', reviewer: 'AB', timestamp };
const rows = [
  { id: 'n1', kind: 'species', autoId: 'NYCNOC', manualId: '', raw: ['a.wav', 'NYCNOC'] },
  { id: 'n2', kind: 'species', autoId: 'nycnoc', manualId: 'PIPPIP', raw: ['b.wav', 'nycnoc'] },
  { id: 'n3', kind: 'species', autoId: ' NYCNOC ', manualId: '', raw: ['c.wav', ' NYCNOC '] },
  { id: 'p1', kind: 'species', autoId: 'PIPPIP' },
  { id: 'noise', kind: 'noise', autoId: 'Noise' },
  { id: 'noid', kind: 'noid', autoId: 'NoID' }
];

test('confirms every contact in the normalized species group, including existing corrections and drafts', () => {
  const reviews = { n1: { status: 'corrected', label: 'PIPNAT', notes: 'Ancienne note', reviewer: 'XY' }, n2: { status: 'uncertain', label: 'Myotis sp.' } };
  const drafts = { n3: { status: 'corrected', label: 'MYODAU', notes: 'Note en cours' } };
  const result = Bulk.apply({ rows, reviews, drafts, ...options });
  assert.equal(result.changes.length, 3);
  for (const row of rows.slice(0, 3)) {
    assert.equal(result.reviews[row.id].status, 'confirmed');
    assert.equal(result.reviews[row.id].label, row.autoId);
    assert.equal(result.reviews[row.id].reviewer, 'AB');
    assert.equal(result.reviews[row.id].timestamp, timestamp);
    assert.equal(result.drafts[row.id], undefined);
  }
  assert.equal(result.reviews.n1.notes, 'Ancienne note\nConfirmation globale des contacts de cette espèce (AUTO-ID : NYCNOC).');
  assert.equal(result.reviews.n3.notes, 'Note en cours\nConfirmation globale des contacts de cette espèce (AUTO-ID :  NYCNOC ).');
});

test('draft notes take precedence even when explicitly empty; otherwise the saved note is retained', () => {
  const reviews = { n1: { status: 'corrected', label: 'PIPPIP', notes: 'Sauvegardée' }, n2: { status: 'corrected', label: 'MYODAU', notes: 'À conserver' } };
  const drafts = { n1: { notes: '' }, n2: { status: 'corrected', label: 'PIPPIP' } };
  const result = Bulk.apply({ rows, reviews, drafts, ...options });
  assert.equal(result.reviews.n1.notes, 'Confirmation globale des contacts de cette espèce (AUTO-ID : NYCNOC).');
  assert.equal(result.reviews.n2.notes, 'À conserver\nConfirmation globale des contacts de cette espèce (AUTO-ID : nycnoc).');
});

test('preserves unrelated decisions, drafts and all raw source data without mutating inputs', () => {
  const reviews = { p1: { status: 'corrected', label: 'PIPNAT' }, noise: { status: 'noise', label: 'Noise' } };
  const drafts = { p1: { notes: 'Autre espèce' }, noid: { notes: 'Non identifié' } };
  const before = JSON.stringify({ rows, reviews, drafts });
  const result = Bulk.apply({ rows, reviews, drafts, ...options });
  assert.equal(JSON.stringify({ rows, reviews, drafts }), before);
  assert.notEqual(result.reviews, reviews);
  assert.notEqual(result.drafts, drafts);
  assert.equal(result.reviews.p1, reviews.p1);
  assert.equal(result.reviews.noise, reviews.noise);
  assert.equal(result.drafts.p1, drafts.p1);
  assert.equal(result.drafts.noid, drafts.noid);
  assert.equal(rows[1].manualId, 'PIPPIP');
});

test('collapses internal whitespace in the group identity without changing the recorded AUTO-ID', () => {
  const sourceRows = [{ id: '1', kind: 'species', autoId: ' Myotis   myotis ' }, { id: '2', kind: 'species', autoId: 'myotis myotis' }];
  const result = Bulk.apply({ rows: sourceRows, groupKey: 'species:MYOTIS MYOTIS', reviewer: '', timestamp });
  assert.equal(result.changes.length, 2);
  assert.equal(result.reviews['1'].label, ' Myotis   myotis ');
});

test('undo restores exact saved decisions and drafts and removes newly created decisions', () => {
  const reviews = { n1: { status: 'corrected', label: 'PIPPIP', notes: 'Avant', reviewer: 'XY', timestamp: '2025-01-01' }, p1: { status: 'confirmed', label: 'PIPPIP' } };
  const drafts = { n2: { status: 'uncertain', label: 'Myotis sp.', notes: 'Brouillon' }, p1: { notes: 'Hors groupe' } };
  const result = Bulk.apply({ rows, reviews, drafts, ...options });
  const restored = Bulk.restore(result);
  assert.deepEqual(restored.reviews, reviews);
  assert.deepEqual(restored.drafts, drafts);
  assert.notEqual(restored.reviews.n1, reviews.n1);
  assert.notEqual(restored.drafts.n2, drafts.n2);
  assert.equal(restored.reviews.n2, undefined);
  assert.equal(restored.reviews.n3, undefined);
  assert.equal(result.reviews.n1.status, 'confirmed');
});

test('undo snapshots do not alias the original or restored mutable decisions', () => {
  const reviews = { n1: { status: 'corrected', label: 'PIPPIP', notes: 'Avant' } };
  const drafts = { n2: { notes: 'Avant brouillon' } };
  const result = Bulk.apply({ rows, reviews, drafts, ...options });
  reviews.n1.notes = 'Après';
  drafts.n2.notes = 'Après brouillon';
  assert.equal(result.changes[0].previous.notes, 'Avant');
  assert.equal(result.changes[1].previousDraft.notes, 'Avant brouillon');
  const restored = Bulk.restore(result);
  restored.reviews.n1.notes = 'Autre';
  restored.drafts.n2.notes = 'Autre brouillon';
  assert.equal(result.changes[0].previous.notes, 'Avant');
  assert.equal(result.changes[1].previousDraft.notes, 'Avant brouillon');
});

test('explicit bulk confirmation completes even an excluded species and overrides imported corrections', () => {
  const headers = ['IN FILE', 'AUTO ID', 'MATCHING', 'MATCH RATIO', 'MANUAL ID'];
  const records = Array.from({ length: 10 }, (_, index) => [`contact-${index}.wav`, 'NYCNOC', String(10 - index), '0.2', index === 2 ? 'PIPPIP' : '']);
  records.push(['other.wav', 'PIPNAT', '5', '0.8', '']);
  const source = { headers, ...Core.analyze(headers, records) };
  const sourceBefore = JSON.stringify(source);
  const first = A.classify(source);
  assert.equal(first.groups.find(group => group.key === options.groupKey).excluded, true);
  const applied = Bulk.apply({ rows: source.rows, ...options });
  const final = A.classify(source, applied.reviews, {}, applied.drafts);
  const group = final.groups.find(group => group.key === options.groupKey);
  assert.equal(group.manualCount, 10);
  assert.equal(group.requiredCount, 0);
  assert.equal(final.metrics.manual, 10);
  assert.equal(final.byId.get(source.rows[2].id).label, 'NYCNOC');
  assert.equal(source.rows[2].manualId, 'PIPPIP');
  assert.equal(JSON.stringify(source), sourceBefore);
});

test('rejects empty, missing and non-species scopes without broadening the requested group', () => {
  for (const groupKey of [undefined, '', 'species:', 'noise:NOISE', 'noid:NOID', 'species:MYODAU']) {
    assert.throws(() => Bulk.apply({ rows, groupKey, timestamp }));
  }
  assert.throws(() => Bulk.apply({ rows, ...options, reviewer: 5 }), /chaînes/);
  assert.throws(() => Bulk.apply({ rows, ...options, timestamp: '' }), /chaînes/);
  assert.throws(() => Bulk.apply({ rows, ...options, timestamp: 5 }), /chaînes/);
});
