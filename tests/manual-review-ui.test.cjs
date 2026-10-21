const test = require('node:test');
const assert = require('node:assert/strict');
const UI = require('../manual-review-ui.js');
const Names = require('../species.js');
const Import = require('../file-import.js');
const Decisions = require('../contact-decisions.js');
const Workflow = require('../manual-workflow.js');
const Summary = require('../final-summary-data.js');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function element(tag = 'div') {
  return {
    tag, children: [], dataset: {}, attributes: {}, listeners: new Map(), hidden: true,
    textContent: '', focusCount: 0,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners.set(name, callback); },
    fire(name) { return this.listeners.get(name)?.(); },
    focus() { this.focusCount++; }
  };
}

function fixture(options = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const groups = [
    { key: 'a', label: 'NYCNOC', kind: 'species', total: 10, mode: 'sample',
      requiredIndices: [1], completed: 0, remaining: 1, progress: 0,
      reasons: ['Cette espèce exige un échantillon représentatif.'], contacts: [{ recordIndex: 1, lineNumber: 3 }] },
    { key: 'b', label: 'PIPPIP', kind: 'species', total: 20, mode: 'auto',
      requiredIndices: [], completed: 0, remaining: 0, progress: 1,
      reasons: ['Les trois conditions de validation directe sont réunies.'], contacts: [] },
    { key: 'c', label: 'NoID', kind: 'noid', total: 3, mode: 'individual',
      requiredIndices: [3, 4], completed: 0, remaining: 2, progress: 0,
      reasons: ['Ces contacts doivent être identifiés individuellement.'], contacts: [{ recordIndex: 3 }, { recordIndex: 4 }] }
  ];
  const plan = { ready: true, groups, requiredIndices: [1, 3, 4], remaining: 3 };
  const preferences = { debugMode: false };
  const rendered = [], changes = [], callbacks = { sync: 0, back: 0, finalized: [] };
  const decisions = new Map(), manualIds = new Map(), identificationBatches = [];
  const sourceLabel = index => plan.groups.find(group => group.requiredIndices.includes(index))?.label || '';
  function updateProgress() {
    for (const group of plan.groups) {
      group.completed = group.requiredIndices.filter(index => manualIds.get(index)).length;
      group.remaining = group.requiredIndices.length - group.completed;
      group.progress = group.requiredIndices.length ? group.completed / group.requiredIndices.length : 1;
      group.pendingIdentificationIndices = group.requiredIndices.filter(index => !manualIds.get(index));
      group.assignmentReady = !group.remaining;
    }
    plan.remaining = plan.groups.reduce((sum, group) => sum + group.remaining, 0);
    plan.pendingIdentificationIndices = plan.groups.flatMap(group => group.pendingIdentificationIndices);
    plan.assignmentReady = !plan.remaining;
  }
  const ui = UI.init({
    random: options.random,
    document: { getElementById: node, createElement: tag => element(tag) },
    getPlan: () => plan,
    getPreferences: () => preferences,
    renderContactCard: (contact, label) => { rendered.push({ contact, label }); return element('article'); },
    setMany(indices, status) {
      changes.push({ indices, status });
      for (const index of indices) {
        decisions.set(index, status);
        if (status === 'validated') manualIds.set(index, sourceLabel(index).replace(/\s+/g, ' ').trim());
        else manualIds.delete(index);
      }
      updateProgress();
    },
    setManualIds(entries) {
      identificationBatches.push(entries.map(entry => ({ ...entry })));
      for (const { recordIndex, manualId } of entries) {
        manualIds.set(recordIndex, manualId);
        decisions.set(recordIndex, Names.resolve(sourceLabel(recordIndex)).key === Names.resolve(manualId).key ? 'validated' : 'invalidated');
      }
      updateProgress();
    },
    onDecisionsChanged: () => callbacks.sync++,
    onBackToBest: () => callbacks.back++,
    onFinalize: finalPlan => callbacks.finalized.push(finalPlan)
  });
  const row = index => node('manual-species-rows').children[index];
  const progressLine = index => row(index).children[1].children[0];
  const open = index => progressLine(index).children[2].fire('click');
  return { ui, node, groups, plan, preferences, rendered, changes, decisions, manualIds, identificationBatches, callbacks, row, progressLine, open };
}

test('the next view refuses an unfinished reference gate and shows compact progress rows once ready', () => {
  const app = fixture();
  app.plan.ready = false;
  assert.equal(app.ui.showPlan(), false);
  assert.equal(app.node('manual-plan-overview').hidden, true);
  app.plan.ready = true;
  assert.equal(app.ui.showPlan(), true);
  assert.equal(app.node('manual-plan-overview').hidden, false);
  assert.equal(app.node('manual-species-rows').children.length, 3);
  assert.match(app.row(0).children[0].children[0].textContent, /NYCNOC.*Noctule commune/);
  assert.equal(app.progressLine(0).children[0].value, 0);
  assert.equal(app.progressLine(1).children[0].value, 1, 'an automatic species has a full bar immediately');
  assert.equal(app.progressLine(0).children[1].textContent, '1 à vérifier');
  assert.match(app.progressLine(0).children[2].attributes['aria-label'], /Vérifier NYCNOC/);
});

test('per-species navigation and progress refresh retain existing contact cards and keyboard focus', () => {
  const app = fixture();
  app.ui.showPlan();
  app.open(0);
  assert.equal(app.node('manual-plan-overview').hidden, true);
  assert.equal(app.node('manual-species-detail').hidden, false);
  assert.equal(app.rendered.length, 1);
  assert.equal(app.rendered[0].contact.recordIndex, 1);
  assert.match(app.node('manual-species-method').textContent, /échantillon représentatif/);
  const original = app.node('manual-contact-list').children[0];
  app.groups[0].completed = 1;
  app.groups[0].remaining = 0;
  app.groups[0].progress = 1;
  app.plan.remaining = 2;
  app.ui.refresh();
  assert.equal(app.node('manual-contact-list').children[0], original);
  assert.equal(app.rendered.length, 1);
  assert.equal(app.node('manual-species-heading').focusCount, 1);
  assert.match(app.node('manual-species-summary').textContent, /1 \/ 1.*0 restants/);
  app.node('manual-species-back').fire('click');
  assert.equal(app.node('manual-plan-overview').hidden, false);
  assert.equal(app.progressLine(0).children[0].value, 1);
});

test('species with no additional manual work open an explanation without empty contact cards', () => {
  const app = fixture();
  app.ui.showPlan();
  app.open(1);
  assert.equal(app.rendered.length, 0);
  assert.match(app.node('manual-species-summary').textContent, /Validation automatique/);
  assert.match(app.node('manual-contact-list').children[0].textContent, /validés automatiquement/);
});

test('debug bulk validation is guarded and uses all required contacts with the same background model', () => {
  const app = fixture();
  app.ui.showPlan();
  assert.equal(app.node('manual-plan-debug').hidden, true);
  app.node('manual-plan-debug-all').fire('click');
  assert.equal(app.changes.length, 0);
  app.preferences.debugMode = true;
  app.ui.refresh();
  assert.equal(app.node('manual-plan-debug').hidden, false);
  app.node('manual-plan-debug-all').fire('click');
  assert.deepEqual(app.changes, [{ indices: [1, 3, 4], status: 'validated' }]);
  assert.equal(app.callbacks.sync, 1);
  assert.equal(app.progressLine(0).children[0].value, 1);
  assert.equal(app.progressLine(2).children[1].textContent, '0 à vérifier');
  assert.match(app.node('manual-plan-summary').textContent, /0 contrôles supplémentaires/);
  app.ui.hide();
  app.node('manual-plan-debug-all').fire('click');
  assert.equal(app.changes.length, 1, 'hidden debug controls cannot modify the model');
});

test('returning to best contacts hides both manual screens without clearing stored choices', () => {
  const app = fixture();
  app.ui.showPlan();
  app.node('manual-plan-back').fire('click');
  assert.equal(app.callbacks.back, 1);
  assert.equal(app.node('manual-plan-overview').hidden, true);
  assert.equal(app.node('manual-species-detail').hidden, true);
  app.ui.showPlan();
  app.open(2);
  assert.equal(app.rendered.length, 2);
  assert.equal(app.rendered[0].label, 'Non identifié (NoID)');
});

test('hiding clears stale imported contact nodes while retaining model choices and supports a shorter next import', () => {
  const app = fixture();
  app.ui.showPlan();
  app.open(0);
  app.groups[0].completed = 1;
  app.groups[0].remaining = 0;
  app.groups[0].progress = 1;
  app.plan.remaining = 2;
  app.ui.hide();
  assert.equal(app.node('manual-contact-list').children.length, 0);
  assert.equal(app.node('manual-species-rows').children.length, 0);
  assert.equal(app.groups[0].completed, 1, 'the background choice survives clearing the view');
  app.ui.showPlan();
  app.open(0);
  assert.equal(app.rendered.at(-1).contact.recordIndex, 1);
  assert.match(app.node('manual-species-summary').textContent, /1 \/ 1.*0 restants/);

  app.ui.hide();
  app.plan.groups = [{ key: 'new', label: 'NoID', kind: 'noid', total: 1, mode: 'individual',
    requiredIndices: [0], completed: 0, remaining: 1, progress: 0,
    reasons: ['Nouveau fichier à contrôler.'], contacts: [{ recordIndex: 0, lineNumber: 2 }] }];
  app.plan.requiredIndices = [0];
  app.plan.remaining = 1;
  app.ui.showPlan();
  app.open(0);
  assert.equal(app.node('manual-contact-list').children.length, 1);
  assert.equal(app.rendered.at(-1).contact.recordIndex, 0);
  assert.match(app.node('manual-species-method').textContent, /Nouveau fichier/);
});

test('random debug decisions cover only required contacts, exercise both statuses, and refresh once', () => {
  const draws = [0.1, 0.9, 0.2, 0.4];
  const app = fixture({ random: () => draws.shift() });
  app.preferences.debugMode = true;
  app.ui.showPlan();
  app.node('manual-plan-debug-random').fire('click');
  assert.deepEqual(app.changes, [
    { indices: [1, 4], status: 'validated' }
  ]);
  assert.equal(app.identificationBatches.length, 1);
  assert.deepEqual(app.identificationBatches[0].map(entry => entry.recordIndex), [3]);
  assert.ok(Names.SPECIES.some(species => species.code === app.manualIds.get(3)));
  assert.deepEqual([...app.decisions.keys()].sort(), [1, 3, 4]);
  assert.equal(app.callbacks.sync, 1);
  assert.equal(app.plan.remaining, 0);
  assert.equal(app.progressLine(0).children[0].value, 1);
  assert.equal(app.progressLine(2).children[0].value, 1);
  assert.equal(app.node('manual-plan-debug-result').hidden, false);
  assert.match(app.node('manual-plan-debug-result').textContent, /2 contacts validés et 1 contact invalidé/);
  app.node('manual-plan-debug-all').fire('click');
  assert.equal(app.node('manual-plan-debug-result').hidden, true);
  assert.equal(app.node('manual-plan-debug-result').textContent, '');
});

test('random debug action cannot mutate contacts while disabled, hidden, unfinished, or in a species detail', () => {
  const app = fixture({ random: () => 0.1 });
  const randomButton = app.node('manual-plan-debug-random');
  randomButton.fire('click');
  app.ui.showPlan();
  randomButton.fire('click');
  app.preferences.debugMode = true;
  app.plan.ready = false;
  randomButton.fire('click');
  app.plan.ready = true;
  app.open(0);
  randomButton.fire('click');
  app.ui.hide();
  randomButton.fire('click');
  assert.equal(app.changes.length, 0);
  assert.equal(app.identificationBatches.length, 0);
  assert.equal(app.callbacks.sync, 0);
});

test('identical random draws still produce at least one validated and one invalidated contact', () => {
  for (const draw of [0, 1]) {
    const app = fixture({ random: () => draw });
    app.preferences.debugMode = true;
    app.ui.showPlan();
    app.node('manual-plan-debug-random').fire('click');
    assert.deepEqual(new Set(app.decisions.values()), new Set(['validated', 'invalidated']));
    assert.equal(app.decisions.get(4), draw === 0 ? 'invalidated' : 'validated', 'the last contact breaks an all-equal draw');
    app.ui.hide();
    assert.equal(app.node('manual-plan-debug-result').hidden, true);
    assert.equal(app.node('manual-plan-debug-result').textContent, '');
  }
});

test('random validation supports a single contact and disables both macro buttons with no required contacts', () => {
  const app = fixture({ random: () => 0.75 });
  app.preferences.debugMode = true;
  app.plan.groups = [app.groups[0]];
  app.plan.requiredIndices = [1];
  app.ui.showPlan();
  app.node('manual-plan-debug-random').fire('click');
  assert.deepEqual(app.changes, []);
  assert.deepEqual(app.identificationBatches[0].map(entry => entry.recordIndex), [1]);
  assert.equal(app.decisions.get(1), 'invalidated');
  assert.match(app.node('manual-plan-debug-result').textContent, /0 contacts validés et 1 contact invalidé/);
  app.plan.groups = [app.groups[1]];
  app.plan.requiredIndices = [];
  app.plan.remaining = 0;
  app.ui.refresh();
  assert.equal(app.node('manual-plan-debug-all').disabled, true);
  assert.equal(app.node('manual-plan-debug-random').disabled, true);
  app.node('manual-plan-debug-random').fire('click');
  assert.equal(app.identificationBatches.length, 1);
});

test('an invalidated contact without its real ID keeps the progress incomplete and the prorata pending', () => {
  const app = fixture();
  const group = app.groups[0];
  group.assignmentReady = false;
  group.pendingIdentificationIndices = [1];
  group.distribution = [{ label: 'NYCNOC', manualCount: 1, share: 1, assignedCount: 0 }];
  group.proportionalAssignments = [];
  app.plan.assignmentReady = false;
  app.plan.pendingIdentificationIndices = [1];
  app.plan.proportionalAssignments = [];
  app.ui.showPlan();
  assert.equal(app.progressLine(0).children[0].value, 0);
  assert.match(app.row(0).children[0].children[2].textContent, /1 identification réelle à renseigner/);
  assert.match(app.node('manual-plan-summary').textContent, /1 identification réelle à renseigner/);
  app.open(0);
  assert.match(app.node('manual-species-summary').textContent, /1 identification réelle à renseigner/);
  assert.match(app.node('manual-species-method').textContent, /avant de calculer le prorata/);
  assert.doesNotMatch(app.node('manual-species-method').textContent, /100\s*%|attribué au prorata/);
});

test('completed mixed manual identities expose observed shares and inferred counts without replacing contact cards', () => {
  const app = fixture();
  const group = app.groups[0];
  group.assignmentReady = false;
  group.pendingIdentificationIndices = [1];
  group.proportionalAssignments = [];
  app.ui.showPlan();
  app.open(0);
  const card = app.node('manual-contact-list').children[0];
  group.assignmentReady = true;
  group.pendingIdentificationIndices = [];
  group.completed = 1;
  group.remaining = 0;
  group.progress = 1;
  group.distribution = [
    { label: 'NYCNOC', manualCount: 6, share: .6, assignedCount: 12 },
    { label: 'MYODAU', manualCount: 4, share: .4, assignedCount: 8 }
  ];
  group.proportionalAssignments = Array.from({ length: 20 }, (_, index) => ({ recordIndex: index + 10, label: index < 12 ? 'NYCNOC' : 'MYODAU' }));
  app.plan.assignmentReady = true;
  app.plan.pendingIdentificationIndices = [];
  app.plan.proportionalAssignments = group.proportionalAssignments;
  app.ui.refresh();
  assert.equal(app.node('manual-contact-list').children[0], card);
  assert.match(app.node('manual-species-method').textContent, /60\s*% NYCNOC.*40\s*% MYODAU/);
  assert.match(app.node('manual-species-method').textContent, /20 contacts attribués au prorata.*identifications manuelles sont conservées/);
  assert.match(app.node('manual-species-summary').textContent, /Prorata appliqué/);
  assert.match(app.node('manual-plan-summary').textContent, /20 contacts attribués au prorata/);
});

test('a sensitive small group with only its reviewed best contact shows prorata rather than automatic acceptance', () => {
  const app = fixture();
  const group = app.groups[0];
  Object.assign(group, { total: 5, requiredIndices: [], completed: 0, remaining: 0, progress: 1,
    assignmentReady: true, pendingIdentificationIndices: [],
    distribution: [{ label: 'MYODAU', manualCount: 1, share: 1, assignedCount: 4 }],
    proportionalAssignments: [2, 3, 4, 5].map(recordIndex => ({ recordIndex, label: 'MYODAU' })) });
  app.ui.showPlan();
  app.open(0);
  assert.equal(app.rendered.length, 0);
  assert.match(app.node('manual-species-method').textContent, /100\s*% MYODAU.*4 contacts attribués au prorata/);
  assert.match(app.node('manual-contact-list').children[0].textContent, /attribués au prorata de son identification manuelle/);
  assert.doesNotMatch(app.node('manual-species-summary').textContent, /Validation automatique/);
});

test('random debug assigns known alternate species and marks the output as a simulation', () => {
  const app = fixture({ random: () => .75 });
  app.preferences.debugMode = true;
  app.ui.showPlan();
  app.node('manual-plan-debug-random').fire('click');
  assert.match(app.node('manual-plan-debug-result').textContent, /Simulation de débogage/);
  assert.match(app.node('manual-plan-debug-result').textContent, /espèces? attribuées? au hasard/);
  assert.doesNotMatch(app.node('manual-plan-debug-result').textContent, /Renseignez l’identification réelle/);
  assert.deepEqual(new Set(app.decisions.values()), new Set(['validated', 'invalidated']));
  const catalog = new Set(Names.SPECIES.map(species => species.code));
  for (const batch of app.identificationBatches) for (const { recordIndex, manualId } of batch) {
    assert.ok(catalog.has(manualId));
    const source = app.groups.find(group => group.requiredIndices.includes(recordIndex)).label;
    assert.notEqual(Names.resolve(manualId).key, Names.resolve(source).key);
    assert.equal(app.decisions.get(recordIndex), 'invalidated');
  }
  assert.equal(app.plan.remaining, 0);
  assert.equal(app.plan.assignmentReady, true);
});

test('random debug excludes the source species even when its AUTO-ID is a scientific-name alias', () => {
  const draw = Names.SPECIES.findIndex(species => species.code === 'NYCNOC') / Names.SPECIES.length;
  const app = fixture({ random: () => draw });
  app.groups[0].label = 'Nyctalus noctula';
  app.plan.groups = [app.groups[0]];
  app.plan.requiredIndices = [1];
  app.preferences.debugMode = true;
  app.ui.showPlan();
  app.node('manual-plan-debug-random').fire('click');
  assert.equal(app.decisions.get(1), 'invalidated');
  assert.notEqual(app.manualIds.get(1), 'NYCNOC');
  assert.ok(Names.SPECIES.some(species => species.code === app.manualIds.get(1)));
  assert.equal(app.plan.remaining, 0);
});

test('blank or unusable AUTO-IDs receive actual random species even when the binary draw tries to validate', () => {
  for (const sourceLabel of ['', ' \t\n ', 'MYO\u0000DAS']) {
    const app = fixture({ random: () => 0 });
    Object.assign(app.groups[0], { label: sourceLabel, kind: 'unclassified' });
    app.plan.groups = [app.groups[0]];
    app.plan.requiredIndices = [1];
    app.preferences.debugMode = true;
    app.ui.showPlan();
    app.node('manual-plan-debug-random').fire('click');
    assert.equal(app.decisions.get(1), 'invalidated');
    assert.ok(Names.SPECIES.some(species => species.code === app.manualIds.get(1)));
    assert.equal(app.plan.remaining, 0);
    assert.equal(app.plan.assignmentReady, true);
    assert.equal(app.node('manual-finalize-button').disabled, false);
  }
});

test('random debug completes real workflow assignments, permits finalization and restores generated species', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/manual-workflow-review.csv'));
  const source = await Import.read({ name: 'manual-workflow-review.csv',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  const original = structuredClone(source);
  const saved = new Map();
  const storage = { getItem: key => saved.get(key) || null, setItem: (key, value) => saved.set(key, value) };
  const model = await Decisions.create(source, { storage, crypto: webcrypto });
  const initial = Workflow.build(source, model);
  const referenceIndices = initial.groups.flatMap(group => group.best ? [group.best.recordIndex] : []);
  model.setMany(referenceIndices, 'validated');
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let syncCount = 0, finalized = null;
  const ui = UI.init({
    document: { getElementById: node, createElement: tag => element(tag) },
    random: () => .75,
    getPlan: () => Workflow.build(source, model),
    getPreferences: () => ({ debugMode: true }),
    renderContactCard: () => element('article'),
    setMany: (indices, status) => model.setMany(indices, status),
    setManualIds: entries => model.setManualIds(entries),
    onDecisionsChanged: () => syncCount++,
    onBackToBest() {},
    onFinalize: plan => { finalized = Summary.build(source, plan); }
  });
  ui.showPlan();
  node('manual-plan-debug-random').fire('click');
  const completed = Workflow.build(source, model);
  assert.equal(completed.remaining, 0);
  assert.equal(completed.assignmentReady, true);
  assert.deepEqual(completed.pendingIdentificationIndices, []);
  assert.equal(syncCount, 1);
  assert.equal(node('manual-finalize-button').disabled, false);
  const actual = completed.requiredIndices.map(index => model.get(index));
  assert.ok(actual.some(decision => decision.status === 'validated'));
  assert.ok(actual.some(decision => decision.status === 'invalidated'));
  for (const decision of actual.filter(item => item.status === 'invalidated')) {
    assert.ok(Names.SPECIES.some(species => species.code === decision.manualId));
    assert.notEqual(Names.resolve(decision.manualId).key, Names.resolve(decision.sourceAutoId).key);
  }
  for (const index of referenceIndices) {
    assert.equal(model.get(index).status, 'validated', 'the random action leaves reviewed best contacts intact');
  }
  const noiseIndex = source.records.findIndex(record => record[source.headers.indexOf('AUTO-ID')] === 'Noise');
  assert.equal(model.get(noiseIndex), null, 'source Noise contacts never receive debug decisions');
  node('manual-finalize-button').fire('click');
  assert.ok(finalized);
  assert.equal(finalized.totals.sourceContacts, source.records.length);
  assert.equal(finalized.totals.afterContacts + finalized.totals.afterNoise, source.records.length);
  const restored = await Decisions.create(source, { storage, crypto: webcrypto });
  assert.deepEqual(restored.snapshot(), model.snapshot());
  assert.equal(Workflow.build(source, restored).assignmentReady, true);
  assert.deepEqual(source, original);
});

test('finalization waits for completed controls and actual identification assignments', () => {
  const app = fixture();
  app.plan.assignmentReady = false;
  app.plan.pendingIdentificationIndices = [1, 3, 4];
  app.ui.showPlan();
  const button = app.node('manual-finalize-button');
  assert.equal(button.disabled, true);
  assert.match(app.node('manual-finalize-status').textContent, /3 contrôles supplémentaires restent à terminer/);
  button.fire('click');
  assert.deepEqual(app.callbacks.finalized, []);

  app.plan.remaining = 0;
  app.plan.pendingIdentificationIndices = [3];
  app.ui.refresh();
  assert.equal(button.disabled, true, 'binary validation cannot bypass a missing actual species');
  assert.match(app.node('manual-finalize-status').textContent, /1 identification réelle reste à renseigner/);
  button.fire('click');
  assert.deepEqual(app.callbacks.finalized, []);

  app.plan.pendingIdentificationIndices = [];
  app.plan.assignmentReady = true;
  app.ui.refresh();
  assert.equal(button.disabled, false);
  assert.match(app.node('manual-finalize-status').textContent, /Tous les contrôles sont terminés/);
  button.fire('click');
  assert.deepEqual(app.callbacks.finalized, [app.plan]);
});

test('finalization rechecks the current gate and cannot run from hidden or detail screens', () => {
  const app = fixture();
  Object.assign(app.plan, { assignmentReady: true, remaining: 0, pendingIdentificationIndices: [] });
  app.ui.showPlan();
  const button = app.node('manual-finalize-button');
  assert.equal(button.disabled, false);

  app.plan.ready = false;
  button.fire('click');
  assert.equal(button.disabled, true);
  assert.match(app.node('manual-finalize-status').textContent, /chaque meilleur contact/);
  app.plan.ready = true;
  app.ui.refresh();
  app.open(0);
  button.fire('click');
  app.ui.hide();
  button.fire('click');
  assert.deepEqual(app.callbacks.finalized, []);
  assert.equal(button.disabled, true);

  app.ui.showPlan();
  button.fire('click');
  assert.deepEqual(app.callbacks.finalized, [app.plan]);
  assert.equal(app.node('manual-plan-overview').hidden, false);
});

test('groups requiring no additional checks may finalize when the reviewed references and assignments are complete', () => {
  const app = fixture();
  app.plan.groups = [app.groups[1]];
  Object.assign(app.plan, { requiredIndices: [], assignmentReady: true, remaining: 0, pendingIdentificationIndices: [] });
  app.ui.showPlan();
  assert.equal(app.node('manual-finalize-button').disabled, false);
  app.node('manual-finalize-button').fire('click');
  assert.deepEqual(app.callbacks.finalized, [app.plan]);

  app.plan.assignmentReady = false;
  app.ui.refresh();
  assert.equal(app.node('manual-finalize-button').disabled, true);
  app.node('manual-finalize-button').fire('click');
  assert.equal(app.callbacks.finalized.length, 1);
});
