const test = require('node:test');
const assert = require('node:assert/strict');
const Settings = require('../review-settings.js');
const Best = require('../best-contacts.js');
const Workflow = require('../manual-workflow.js');

const headers = ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual', 'PULSES', 'DATE', 'TIME', 'MATCHING', 'MARGIN', 'MANUAL ID', 'SEMIMANUAL ID'];
function imported(rows) {
  return { fileName: 'settings.csv', headers: headers.slice(), records: rows.map((values, index) => {
    const record = { 'IN FILE': 'contact-' + index + '.wav', 'AUTO-ID': 'PIPPIP', 'MATCH RATIO': '.8',
      Qual: '5', PULSES: '10', DATE: '2026-01-01', TIME: '22:00:00', MATCHING: '2', MARGIN: '1',
      'MANUAL ID': '', 'SEMIMANUAL ID': '', ...values };
    return headers.map(header => record[header]);
  }) };
}
const decisions = (...entries) => ({ decisions: entries.map(([recordIndex, status = 'validated', manualId]) =>
  ({ recordIndex, status, ...(manualId === undefined ? {} : { manualId }) })) });
const ranking = (key, direction) => ({ ranking: [{ key, direction }] });

test('default review settings are immutable and normalization returns independent settings', () => {
  assert(Object.isFrozen(Settings.DEFAULTS));
  assert(Object.isFrozen(Settings.DEFAULTS.excludedSpecies));
  assert(Object.isFrozen(Settings.DEFAULTS.ranking));
  assert(Settings.DEFAULTS.ranking.every(Object.isFrozen));
  const normalized = Settings.normalize();
  assert.deepEqual(normalized, Settings.DEFAULTS);
  normalized.excludedSpecies.pop();
  normalized.ranking[0].direction = 'asc';
  assert.equal(Settings.DEFAULTS.excludedSpecies.length, 10);
  assert.equal(Settings.DEFAULTS.ranking[0].direction, 'desc');
  assert.equal(Settings.CRITERIA.length, 7);
});

test('exclusions accept known species aliases and deduplicate canonical codes while keeping NoID pinned', () => {
  assert.deepEqual(Settings.normalize({ excludedSpecies: ['Pipistrelle commune', 'PIPPIP', 'Cnephaeus serotinus'] }).excludedSpecies,
    ['PIPPIP', 'EPTSER', 'NoID']);
  assert.deepEqual(Settings.normalize({ excludedSpecies: [] }).excludedSpecies, ['NoID']);
  for (const label of ['NoID Pip', 'Noise', 'Myotis sp.', 'Pipistrellus cf. pipistrellus', 'MISSING', '', null]) {
    assert.throws(() => Settings.normalize({ excludedSpecies: [label] }), /Espèce inconnue/);
  }
});

test('thresholds accept both endpoints and reject invalid values without silently defaulting', () => {
  for (const value of [0, .333, 1]) {
    const settings = Settings.normalize({ ratioThreshold: value, majorityThreshold: value });
    assert.equal(settings.ratioThreshold, value);
    assert.equal(settings.majorityThreshold, value);
  }
  for (const key of ['ratioThreshold', 'majorityThreshold']) {
    for (const value of [-.01, 1.01, NaN, Infinity, '.6', null]) {
      assert.throws(() => Settings.normalize({ [key]: value }), /compris entre 0 et 1/);
    }
  }
  for (const input of [null, [], 'settings']) assert.throws(() => Settings.normalize(input), /objet/);
});

test('ranking requires unique known criteria with a direction and retains the requested priority', () => {
  const custom = [{ key: 'margin', direction: 'asc' }, { key: 'matching', direction: 'desc' }];
  assert.deepEqual(Settings.normalize({ ranking: custom }).ranking, custom);
  assert.match(Settings.rankingDescription({ ranking: custom }), /^MARGIN croissant, puis MATCHING décroissant$/);
  for (const value of [[], null, [{ key: 'ratio', direction: 'up' }], [{ key: 'UNKNOWN', direction: 'asc' }],
    [{ key: 'qual', direction: 'asc' }, { key: 'qual', direction: 'desc' }]]) {
    assert.throws(() => Settings.normalize({ ranking: value }), /critère/);
  }
});

test('every configurable ranking criterion supports ascending and descending order with missing values last', () => {
  const values = {
    ratio: ['MATCH RATIO', '.1', '.9'], qual: ['Qual', '1', '9'], pulses: ['PULSES', '1', '9'],
    dateValue: ['DATE', '2026-01-01', '2026-02-01'], timeValue: ['TIME', '01:00:00', '23:00:00'],
    matching: ['MATCHING', '1', '9'], margin: ['MARGIN', '-1', '9']
  };
  for (const [key, [header, low, high]] of Object.entries(values)) {
    const source = imported([{ [header]: '' }, { [header]: high }, { [header]: low }]);
    assert.equal(Best.build(source, ranking(key, 'asc')).groups[0].best.recordIndex, 2, key + ' asc');
    assert.equal(Best.build(source, ranking(key, 'desc')).groups[0].best.recordIndex, 1, key + ' desc');
  }
});

test('custom priority changes the reference, exposes margin and preserves source order for complete ties', () => {
  const source = imported([
    { 'MATCH RATIO': '.9', Qual: '1', MARGIN: '0,25' },
    { 'MATCH RATIO': '.1', Qual: '9', MARGIN: '2' },
    { 'MATCH RATIO': '.8', Qual: '9', MARGIN: '2' }
  ]);
  assert.equal(Best.build(source).groups[0].best.recordIndex, 0);
  const selected = Best.build(source, { ranking: [{ key: 'qual', direction: 'desc' }, { key: 'ratio', direction: 'desc' }] });
  assert.equal(selected.groups[0].best.recordIndex, 2);
  assert.equal(selected.groups[0].best.margin, 2);
  assert.equal(Best.build(source, ranking('margin', 'desc')).groups[0].best.recordIndex, 1);
  assert.equal(Best.build(source, ranking('margin', 'asc')).groups[0].best.margin, .25);
});

test('ranking settings cannot make pulses-only or margin-only contacts eligible', () => {
  const source = imported([
    { 'MATCH RATIO': '', Qual: '', MATCHING: '', MARGIN: '999', PULSES: '999' },
    { 'MATCH RATIO': '', Qual: '', MATCHING: '0', MARGIN: '1', PULSES: '1' }
  ]);
  for (const key of ['pulses', 'margin']) {
    const result = Best.build(source, ranking(key, 'desc'));
    assert.equal(result.groups[0].best.recordIndex, 1);
    assert.equal(result.excludedCandidateCount, 1);
  }
  assert.deepEqual(Best.build({ headers: ['IN FILE', 'AUTO-ID', 'Qual'], records: [['a.wav', 'PIPPIP', '1']] }, ranking('margin', 'desc')).missingColumns, ['MARGIN']);
});

test('custom ratio and majority thresholds are inclusive and drive both decisions and explanations', () => {
  const source = imported([{ 'MATCH RATIO': '.7' }, { 'MATCH RATIO': '.7' }, { 'MATCH RATIO': '.2' }, { 'MATCH RATIO': '.1' }]);
  const state = decisions([0]);
  const settings = { ratioThreshold: .7, majorityThreshold: .5 };
  const result = Workflow.build(source, state, { settings });
  const group = result.groups[0];
  assert.equal(group.mode, 'auto');
  assert.equal(group.qualifyingCount, 2);
  assert.equal(group.ratioThreshold, .7);
  assert.equal(group.majorityThreshold, .5);
  assert.match(group.reasons.join(' '), /au moins 50 %.*0,7/);
  const aboveRatio = Workflow.build(source, state, { settings: { ...settings, ratioThreshold: .700001 } }).groups[0];
  assert.equal(aboveRatio.mode, 'sample');
  assert.equal(aboveRatio.qualifyingCount, 0);
  assert.match(aboveRatio.reasons.join(' '), /0,700001/);
  const aboveShare = Workflow.build(source, state, { settings: { ...settings, majorityThreshold: .500001 } }).groups[0];
  assert.equal(aboveShare.mode, 'sample');
  assert.match(aboveShare.reasons.join(' '), /50,0001 %/);
});

test('zero and one thresholds preserve inclusive rules and invalid source ratios never qualify', () => {
  const source = imported([{ 'MATCH RATIO': '0' }, { 'MATCH RATIO': '' }]);
  assert.equal(Workflow.build(source, decisions([0]), { settings: { ratioThreshold: 0, majorityThreshold: .5 } }).groups[0].mode, 'auto');
  assert.equal(Workflow.build(source, decisions([0]), { settings: { ratioThreshold: 1, majorityThreshold: 0 } }).groups[0].mode, 'auto');
  const allOne = imported([{ 'MATCH RATIO': '1' }, { 'MATCH RATIO': '1' }]);
  assert.equal(Workflow.build(allOne, decisions([0]), { settings: { ratioThreshold: 1, majorityThreshold: 1 } }).groups[0].mode, 'auto');
  assert.equal(Workflow.build(source, decisions([0]), { settings: { ratioThreshold: 0, majorityThreshold: 1 } }).groups[0].mode, 'sample');
});

test('inclusive majority boundaries compare shares without floating-point multiplication of contact counts', () => {
  for (const [count, qualifyingCount, majorityThreshold] of [[10, 7, .7], [100, 7, .07]]) {
    const source = imported(Array.from({ length: count }, (_, index) => ({ 'MATCH RATIO': index < qualifyingCount ? '.7' : '.1' })));
    const result = Workflow.build(source, decisions([0]), { settings: { ratioThreshold: .7, majorityThreshold } });
    assert.equal(result.groups[0].qualifyingCount, qualifyingCount);
    assert.equal(result.groups[0].qualifyingShare, majorityThreshold);
    assert.equal(result.groups[0].mode, 'auto');
  }
});

test('adding or removing alias exclusions changes direct validation without changing the default list', () => {
  const pip = imported([{}, {}]);
  assert.equal(Workflow.build(pip, decisions([0])).groups[0].mode, 'auto');
  const excluded = Workflow.build(pip, decisions([0]), { settings: { excludedSpecies: ['Pipistrellus pipistrellus'] } });
  assert.equal(excluded.groups[0].mode, 'sample');
  assert.equal(excluded.groups[0].sensitive, true);
  assert.match(excluded.groups[0].reasons.join(' '), /liste d’exclusion/);
  const noctule = imported([{ 'AUTO-ID': 'Noctule commune' }, { 'AUTO-ID': 'Noctule commune' }]);
  assert.equal(Workflow.build(noctule, decisions([0])).groups[0].mode, 'sample');
  assert.equal(Workflow.build(noctule, decisions([0]), { settings: { excludedSpecies: [] } }).groups[0].mode, 'auto');
  assert(Settings.DEFAULTS.excludedSpecies.includes('NYCNOC'));
});

test('a changed ranking uses the same reference across selection and the workflow gate', () => {
  const source = imported([{ 'MATCH RATIO': '.9', Qual: '1' }, { 'MATCH RATIO': '.8', Qual: '9' }]);
  const settings = ranking('qual', 'desc');
  const oldReferenceOnly = Workflow.build(source, decisions([0]), { settings });
  assert.equal(oldReferenceOnly.ready, false);
  assert.deepEqual(oldReferenceOnly.pendingBestIndices, [1]);
  assert.equal(oldReferenceOnly.groups[0].best.recordIndex, 1);
  assert.equal(Workflow.build(source, decisions([0], [1]), { settings }).groups[0].mode, 'auto');
});

test('settings changes recompute calculated IDs and retain human decisions and source cells', () => {
  const source = imported(Array.from({ length: 20 }, (_, index) => ({ 'MATCH RATIO': index === 0 ? '.9' : '.6',
    'MANUAL ID': index === 19 ? 'Pipistrelle commune' : '', 'SEMIMANUAL ID': 'STALE' })));
  const state = decisions([0, 'validated', 'PIPPIP']);
  const originalSource = structuredClone(source), originalState = structuredClone(state);
  const automatic = Workflow.build(source, state);
  const semiColumn = automatic.processed.headers.indexOf('SEMIMANUAL ID');
  assert.equal(automatic.automaticAssignments.length, 20);
  const stricter = Workflow.build(source, state, { settings: { ratioThreshold: .8, majorityThreshold: .75 } });
  assert.equal(stricter.groups[0].mode, 'sample');
  assert.equal(stricter.automaticAssignments.length, 0);
  assert(stricter.processed.records.some(record => record[semiColumn] === ''));
  assert.equal(stricter.processed.records[0][9], 'PIPPIP');
  assert.equal(stricter.processed.records[0][semiColumn], 'PIPPIP');
  assert.equal(stricter.processed.records[19][9], 'Pipistrelle commune');
  assert.equal(stricter.processed.records[19][semiColumn], 'Pipistrelle commune');
  assert.deepEqual(source, originalSource);
  assert.deepEqual(state, originalState);
  assert.deepEqual(Workflow.build(source, state).automaticAssignments, automatic.automaticAssignments);
});
