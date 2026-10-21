const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const A = require('../automation.js');
const Plan = require('../review-plan.js');

const headers = ['IN FILE', 'AUTO ID', 'MATCHING', 'MATCH RATIO', 'MANUAL ID'];
function data(count = 50, changes = {}) {
  const records = Array.from({ length: count }, (_, index) => {
    const values = { 'IN FILE': `contact-${index}.wav`, 'AUTO ID': 'NYCNOC', MATCHING: String(count - index), 'MATCH RATIO': '0.9', 'MANUAL ID': '', ...(typeof changes === 'function' ? changes(index) : changes) };
    return headers.map(header => values[header]);
  });
  return { headers, ...Core.analyze(headers, records) };
}
const checked = (label = 'NYCNOC') => ({ status: 'confirmed', label });
function plan(source, reviews = {}, policy = {}, drafts = {}, selections = {}) {
  return Plan.summarize(A.classify(source, reviews, policy, drafts, selections));
}

test('eligible references show one conditional check, while known exclusions expose the future sample', () => {
  const eligible = plan(data(50, { 'AUTO ID': 'PIPPIP' }));
  assert.equal(eligible.remaining, 1);
  assert.equal(eligible.total, 1);
  assert.equal(eligible.groups[0].conditional, true);
  assert.equal(eligible.groups[0].awaitingReference, true);
  const excluded = plan(data());
  assert.equal(excluded.completed, 0);
  assert.equal(excluded.remaining, 10);
  assert.equal(excluded.groups[0].conditional, false);
  assert.equal(excluded.groups[0].awaitingReference, true);
});

test('failed strict ratio majority exposes sampling before the reference is checked', () => {
  const source = data(50, index => ({ 'AUTO ID': 'PIPPIP', 'MATCH RATIO': index < 25 ? '0.9' : '0.6' }));
  const summary = plan(source);
  assert.equal(summary.remaining, 10);
  assert.equal(summary.groups[0].conditional, false);
  assert.equal(summary.groups[0].awaitingReference, true);
});

test('a confirmed excluded reference advances one of ten manual checks', () => {
  const source = data();
  const anchor = A.classify(source, {}).groups[0].anchorId;
  const summary = plan(source, { [anchor]: checked() });
  assert.equal(summary.completed, 1);
  assert.equal(summary.remaining, 9);
  assert.equal(summary.total, 10);
  assert.equal(summary.groups[0].awaitingReference, false);
});

test('an eligible reference correction expands the conditional plan to the actual sample', () => {
  const source = data(50, { 'AUTO ID': 'PIPPIP' });
  const anchor = A.classify(source, {}).groups[0].anchorId;
  const before = plan(source);
  const after = plan(source, { [anchor]: { status: 'corrected', label: 'MYODAU' } });
  assert.equal(before.total, 1);
  assert.equal(after.completed, 1);
  assert.equal(after.remaining, 9);
  assert.equal(after.total, 10);
  assert.equal(after.groups[0].conditional, false);
});

test('completed direct and proportional groups retain their human check counts with no remaining work', () => {
  const direct = data(50, { 'AUTO ID': 'PIPPIP' });
  const directAnchor = A.classify(direct, {}).groups[0].anchorId;
  const directPlan = plan(direct, { [directAnchor]: checked('PIPPIP') });
  assert.equal(directPlan.completed, 1);
  assert.equal(directPlan.remaining, 0);
  assert.equal(directPlan.groups.length, 1);
  const proportional = data();
  const reviews = Object.fromEntries(A.classify(proportional, {}).groups[0].selectedIds.map(id => [id, checked()]));
  const proportionalPlan = plan(proportional, reviews);
  assert.equal(proportionalPlan.completed, 10);
  assert.equal(proportionalPlan.remaining, 0);
  assert.equal(proportionalPlan.total, 10);
});

test('imported human labels and extra reviews count as completed, while unchecked selected contacts remain mandatory', () => {
  const source = data(10, index => ({ 'MANUAL ID': index < 3 ? 'NYCNOC' : '' }));
  const group = A.classify(source, {}).groups[0];
  const unchecked = source.rows.filter(row => !row.manualId).map(row => row.id);
  const selectedIds = [group.anchorId, unchecked[0], unchecked[1]];
  const summary = plan(source, { [unchecked[2]]: checked() }, {}, {}, { [group.key]: { selectedIds, sampleTarget: 2 } });
  assert.equal(summary.completed, 4, 'Three imported decisions plus the extra project check.');
  assert.equal(summary.remaining, 2, 'Quota is met, but both explicit pending picks still require reviews.');
  assert.equal(summary.total, 6);
});

test('explicit under-quota selections preserve the deficit after all selected contacts are checked', () => {
  const source = data();
  const group = A.classify(source, {}).groups[0];
  const selections = { [group.key]: { selectedIds: [group.anchorId] } };
  assert.equal(plan(source, {}, {}, {}, selections).remaining, 10);
  const summary = plan(source, { [group.anchorId]: checked() }, {}, {}, selections);
  assert.equal(summary.completed, 1);
  assert.equal(summary.remaining, 9);
  assert.equal(summary.total, 10);
});

test('drafts and invalid decisions outside the selected sample are counted without double counting selected drafts', () => {
  const source = data();
  const group = A.classify(source, {}).groups[0];
  const extra = source.rows.filter(row => !group.selectedIds.includes(row.id));
  const drafts = { [group.anchorId]: { label: 'NYCNOC' }, [extra[0].id]: { label: 'NYCNOC' } };
  const reviews = { [extra[1].id]: { status: 'confirmed', label: '' } };
  const summary = plan(source, reviews, {}, drafts);
  assert.equal(summary.remaining, 12, 'Ten selected contacts plus two separate mandatory repairs.');
  assert.equal(summary.completed, 0);
});

test('ready inference groups retain mandatory draft checks outside the finished sample', () => {
  const source = data();
  const group = A.classify(source, {}).groups[0];
  const reviews = Object.fromEntries(group.selectedIds.map(id => [id, checked()]));
  const extra = source.rows.find(row => !group.selectedIds.includes(row.id));
  const summary = plan(source, reviews, {}, { [extra.id]: { label: 'MYODAU' } });
  assert.equal(summary.completed, 10);
  assert.equal(summary.remaining, 1);
  assert.equal(summary.total, 11);
});

test('NoID and unclassified contacts retain individual checks while Noise is ignored by default', () => {
  const source = data(5, index => ({ 'AUTO ID': ['NoID', 'Noise', '', 'NoID', 'Noise'][index] }));
  const summary = plan(source, { [source.rows[0].id]: { status: 'corrected', label: 'PIPPIP' } });
  assert.deepEqual(summary.groups.map(group => group.kind), ['noid', 'noise', 'unclassified']);
  assert.deepEqual(summary.groups.map(group => [group.completed, group.remaining]), [[1, 1], [0, 0], [0, 1]]);
  assert.equal(summary.completed, 1);
  assert.equal(summary.remaining, 2);
  assert.equal(summary.total, 3);
  assert.ok(summary.groups.every(group => !group.conditional && !group.awaitingReference));
});

test('opting into Noise reviews restores every ignored contact to the human workload', () => {
  const source = data(5, index => ({ 'AUTO ID': ['NoID', 'Noise', '', 'NoID', 'Noise'][index] }));
  const summary = plan(source, { [source.rows[0].id]: { status: 'corrected', label: 'PIPPIP' } }, { ignoreNoise: false });
  assert.deepEqual(summary.groups.map(group => [group.completed, group.remaining]), [[1, 1], [0, 2], [0, 1]]);
  assert.equal(summary.completed, 1);
  assert.equal(summary.remaining, 4);
  assert.equal(summary.total, 5);
});

test('ignored Noise does not advance human progress or enlarge the planned denominator', () => {
  const source = data(102, index => ({ 'AUTO ID': index < 100 ? 'Noise' : 'PIPPIP' }));
  const classification = A.classify(source, {});
  const species = classification.groups.find(group => group.kind === 'species');
  const before = Plan.summarize(classification);
  assert.equal(before.completed, 0);
  assert.equal(before.remaining, 1);
  assert.equal(before.total, 1, 'One hundred ignored contacts do not become human checks.');
  const after = plan(source, { [species.anchorId]: checked('PIPPIP') });
  assert.equal(after.completed, 1);
  assert.equal(after.remaining, 0);
  assert.equal(after.total, 1);
  const noise = after.groups.find(group => group.kind === 'noise');
  assert.deepEqual([noise.completed, noise.remaining, noise.total], [0, 0, 0]);
});

test('actual manual decisions on Noise still count as completed while other Noise is ignored', () => {
  const source = data(4, index => ({ 'AUTO ID': 'Noise', 'MANUAL ID': index === 0 ? 'PIPPIP' : '' }));
  const summary = plan(source, { [source.rows[1].id]: { status: 'corrected', label: 'MYODAU' } });
  assert.equal(summary.completed, 2, 'Imported and saved acoustic corrections are real human reviews.');
  assert.equal(summary.remaining, 0);
  assert.equal(summary.total, 2);
  assert.deepEqual([summary.groups[0].completed, summary.groups[0].remaining], [2, 0]);
});

test('deliberate Noise drafts and invalid decisions remain mandatory without counting ignored rows', () => {
  const source = data(4, { 'AUTO ID': 'Noise' });
  const summary = plan(source, { [source.rows[1].id]: { status: 'corrected', label: '' } }, {}, { [source.rows[0].id]: { label: 'MYODAU' } });
  assert.equal(summary.completed, 0);
  assert.equal(summary.remaining, 2);
  assert.equal(summary.total, 2);
});

test('changing the per-species quota changes the workload without changing the classifier queue', () => {
  const source = data();
  const initial = A.classify(source, {});
  const group = initial.groups[0];
  const larger = A.classify(source, {}, {}, {}, { [group.key]: { sampleTarget: 17 } });
  assert.equal(initial.metrics.required, 1);
  assert.equal(larger.metrics.required, 1);
  assert.equal(Plan.summarize(initial).remaining, 10);
  assert.equal(Plan.summarize(larger).remaining, 17);
  assert.equal(larger.metrics.required, 1, 'Summarizing must not alter the classifier result.');
});

function explanation(source, reviews = {}, policy = {}, drafts = {}, selections = {}, contactId) {
  const classification = A.classify(source, reviews, policy, drafts, selections);
  const group = classification.groups[0];
  const workload = Plan.summarize(classification).groups[0];
  return { group, workload, ...Plan.explain(group, workload, classification.byId.get(contactId || group.anchorId || group.rows[0].id)) };
}

test('explanation makes direct validation conditional on the reference and states the fallback sample', () => {
  const source = data(50, index => ({ 'AUTO ID': 'PIPPIP', 'MATCH RATIO': index < 26 ? '0.9' : '0.6' }));
  const result = explanation(source);
  assert.match(result.reason, /confirmation du meilleur contact/);
  assert.match(result.reason, /26 \/ 50/);
  assert.match(result.reason, /MATCH RATIO > 0,6/);
  assert.match(result.reason, /strictement plus de 50 %/);
  assert.match(result.reason, /hors de votre liste d’exclusion/);
  assert.match(result.calculation, /1 contrôle restant/);
  assert.match(result.calculation, /référence diffère de l’AUTO-ID ou reste incertaine/);
  assert.match(result.calculation, /20 % de 50 contacts/);
  assert.match(result.calculation, /10 contrôles, référence comprise/);
  assert.match(result.contactReason, /MATCHING, MATCH RATIO puis MARGIN/);
});

test('sampling explanation reports policy exclusions and failing strict majority without inventing regulatory status', () => {
  const result = explanation(data(50, index => ({ 'MATCH RATIO': index < 25 ? '0.9' : '0.6' })));
  assert.match(result.reason, /NYCNOC figure dans votre liste d’exclusion/);
  assert.match(result.reason, /25 \/ 50/);
  assert.match(result.reason, /strictement plus de 50 %/);
  assert.doesNotMatch(result.reason, /Natura|sensibilité/);
  assert.match(result.calculation, /20 % de 50 contacts, arrondi au supérieur, soit 10 contrôles/);
  assert.match(result.calculation, /0 contrôles enregistrés et 10 contrôles restants/);
});

test('corrected and uncertain eligible references explain why the sample replaced direct validation', () => {
  const source = data(11, { 'AUTO ID': 'PIPPIP' });
  const anchor = A.classify(source, {}).groups[0].anchorId;
  for (const decision of [{ status: 'corrected', label: 'MYODAU' }, { status: 'uncertain', label: 'PIPPIP' }]) {
    const result = explanation(source, { [anchor]: decision });
    assert.match(result.reason, /identification du meilleur contact diffère de l’AUTO-ID ou reste incertaine/);
    assert.match(result.calculation, /20 % de 11 contacts, arrondi au supérieur, soit 3 contrôles/);
    assert.match(result.calculation, /1 contrôle enregistré et 2 contrôles restants/);
  }
});

test('a per-species target and the zero-percent minimum are shown as their actual objectives', () => {
  const source = data();
  const group = A.classify(source, {}).groups[0];
  const custom = explanation(source, {}, {}, {}, { [group.key]: { sampleTarget: 17 } });
  assert.match(custom.calculation, /Objectif personnalisé : 17 contrôles, référence comprise/);
  assert.match(custom.calculation, /17 contrôles restants/);
  assert.doesNotMatch(custom.calculation, /20 % de 50/);
  const zero = explanation(source, {}, { samplePercent: 0 });
  assert.match(zero.calculation, /0 %, avec le minimum d’un contrôle/);
  assert.match(zero.calculation, /1 contrôle restant/);
});

test('imported decisions can meet the quota while unchecked explicit selections remain mandatory', () => {
  const source = data(10, index => ({ 'MANUAL ID': index < 3 ? 'NYCNOC' : '' }));
  const group = A.classify(source, {}).groups[0];
  const unchecked = source.rows.filter(row => !row.manualId).map(row => row.id);
  const result = explanation(source, { [unchecked[2]]: checked() }, {}, {}, { [group.key]: { selectedIds: [group.anchorId, unchecked[0], unchecked[1]], sampleTarget: 2 } }, unchecked[0]);
  assert.equal(result.workload.selectedRemaining, 2);
  assert.equal(result.workload.importedCount, 3);
  assert.match(result.calculation, /4 contrôles enregistrés et 2 contrôles restants \(6 contrôles au total\)/);
  assert.match(result.calculation, /quota atteint, mais 2 contrôles sélectionnés encore obligatoires/);
  assert.match(result.calculation, /3 décisions importées du CSV déjà comptées/);
  assert.match(result.contactReason, /sélection manuelle personnalisée/);
});

test('an incomplete selection states the actual quota deficit instead of suggesting completion', () => {
  const source = data();
  const group = A.classify(source, {}).groups[0];
  const result = explanation(source, { [group.anchorId]: checked() }, {}, {}, { [group.key]: { selectedIds: [group.anchorId] } });
  assert.equal(result.workload.selectionNeeded, 9);
  assert.match(result.calculation, /1 contrôle enregistré et 9 contrôles restants/);
  assert.match(result.calculation, /9 contrôles à ajouter à la sélection pour atteindre l’objectif/);
});

test('an expanded selection and drafts outside it explain counts above the numeric target', () => {
  const source = data();
  const group = A.classify(source, {}).groups[0];
  const extra = source.rows.filter(row => !group.selectedIds.includes(row.id));
  const selections = { [group.key]: { selectedIds: [...group.selectedIds, extra[0].id, extra[1].id] } };
  const result = explanation(source, {}, {}, { [extra[2].id]: { label: 'MYODAU' } }, selections, extra[2].id);
  assert.equal(result.workload.additionalRemaining, 1);
  assert.equal(result.workload.draftRemaining, 1);
  assert.match(result.calculation, /13 contrôles restants/);
  assert.match(result.calculation, /sélection comprend 12 contacts, tous obligatoires/);
  assert.match(result.calculation, /1 contrôle supplémentaire à finaliser hors sélection/);
  assert.match(result.contactReason, /brouillon/);
});

test('finished proportional samples and direct validation explain remaining draft repairs separately', () => {
  for (const autoId of ['NYCNOC', 'PIPPIP']) {
    const source = data(50, { 'AUTO ID': autoId });
    const group = A.classify(source, {}).groups[0];
    const reviewed = autoId === 'NYCNOC' ? group.selectedIds : [group.anchorId];
    const reviews = Object.fromEntries(reviewed.map(id => [id, checked(autoId)]));
    const extra = source.rows.find(row => !group.selectedIds.includes(row.id));
    const result = explanation(source, reviews, {}, { [extra.id]: { label: 'MYODAU' } }, {}, extra.id);
    assert.equal(result.workload.remaining, 1);
    assert.equal(result.workload.draftRemaining, 1);
    assert.match(result.calculation, /1 contrôle restant/);
    assert.match(result.calculation, /brouillons ou décisions à corriger/);
    assert.doesNotMatch(result.calculation, /à ajouter à la sélection/);
    if (autoId === 'NYCNOC') assert.match(result.calculation, /échantillon est terminé/);
    else assert.match(result.reason, /validation directe est acquise/);
  }
});

test('individual NoID, unclassified and Noise explanations reflect the active ignore policy', () => {
  for (const autoId of ['NoID', '']) {
    const result = explanation(data(3, { 'AUTO ID': autoId }));
    assert.match(result.reason, /vérifié individuellement/);
    assert.match(result.calculation, /3 contrôles restants/);
    assert.match(result.contactReason, /décision individuelle/);
  }
  const noise = data(3, { 'AUTO ID': 'Noise' });
  const ignored = explanation(noise, {}, {}, { [noise.rows[0].id]: { label: 'MYODAU' } }, {}, noise.rows[0].id);
  assert.match(ignored.reason, /Noise sont ignorés par défaut/);
  assert.match(ignored.calculation, /1 contrôle restant/);
  assert.match(ignored.calculation, /2 Noise ignorés/);
  const included = explanation(noise, {}, { ignoreNoise: false });
  assert.match(included.reason, /exclusion des Noise est désactivée/);
  assert.match(included.calculation, /3 contrôles restants/);
});

test('completed sample explanation preserves counts and states proportional completion', () => {
  const source = data();
  const group = A.classify(source, {}).groups[0];
  const reviews = Object.fromEntries(group.selectedIds.map(id => [id, checked()]));
  const result = explanation(source, reviews);
  assert.match(result.calculation, /10 contrôles enregistrés et 0 contrôles restants/);
  assert.match(result.calculation, /attribués au prorata des identifications manuelles/);
  assert.match(result.calculation, /sélection représentative des classes de MATCH RATIO/);
  assert.throws(() => Plan.explain(group, { key: 'unrelated' }), /groupe et son plan/);
});
