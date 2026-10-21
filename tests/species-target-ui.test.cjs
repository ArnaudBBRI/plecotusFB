const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('../core.js');
const A = require('../automation.js');
const P = require('../review-plan.js');

// Run the actual app handlers with a small DOM double. No UI helper is exposed in production.
function ui(count = 14, selections = {}, reviews = {}, drafts = {}) {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, {
      value: '', dataset: {}, classList: { toggle() {}, remove() {} },
      querySelectorAll() { return []; }, setAttribute(name, value) { this[name] = value; }
    });
    return nodes.get(id);
  };
  const window = { BatReviewCore: C, BatClassification: A, BatReviewPlan: P, addEventListener() {} };
  const document = {
    getElementById: node, body: node('body'), querySelector() { return null; },
    querySelectorAll() { return []; }, addEventListener() {}
  };
  let source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.ok(source.endsWith('})();\n'), 'The test attaches hooks at the app closure boundary.');
  source = source.slice(0, -6) + `
    render = () => recalculate();
    persist = () => {};
    window.targetTest = {state, targetPercent, targetCount, updateTargetPreview, applyTargetPercent, recalculate};
  })();`;
  vm.runInNewContext(source, {
    window, document, location: { origin: 'file://' }, localStorage: { getItem() { return null; } },
    setTimeout() { return 1; }, clearTimeout() {}
  }, { filename: 'app.js' });
  const headers = ['IN FILE', 'AUTO ID', 'PULSES', 'MATCHING', 'MATCH RATIO', 'MANUAL ID'];
  const records = Array.from({ length: count }, (_, i) => [`r-${i}.wav`, 'BARBAR', 100, 100 - i, '.5', '']);
  const data = { headers, ...C.analyze(headers, records) };
  const h = window.targetTest;
  Object.assign(h.state, { data, rowById: new Map(data.rows.map(row => [row.id, row])), selections, reviews, drafts });
  h.recalculate();
  const input = value => ({
    value: String(value), dataset: { targetPercent: 'species:BARBAR' }, validity: { badInput: false },
    setAttribute(name, value) { this[name] = value; }, focus() { this.focused = true; }
  });
  return { h, input, group: () => h.state.classification.groups[0], toast: node('toast') };
}

test('species target accepts decimal percentages and applies the rounded-up contact quota', () => {
  const { h, input, group } = ui(51);
  h.applyTargetPercent(input('8.5'));
  assert.equal(group().samplePercent, 8.5);
  assert.equal(group().sampleTarget, 5);
  assert.equal(group().explicitTarget, false);
  assert.equal(group().selectedIds.length, 5);
  assert.ok(group().selectedIds.includes(group().anchorId));
});

test('reapplying an equivalent displayed percentage preserves an exact legacy count', () => {
  const selections = { 'species:BARBAR': { sampleTarget: 3, selectedIds: ['contact-2', 'contact-3'] } };
  const { h, input, group } = ui(7, selections);
  const displayed = h.targetPercent(group());
  assert.equal(displayed, '42.857143');
  assert.equal(Math.ceil(7 * Number(displayed) / 100), 4, 'Rounding this displayed rate naively would add an unwanted check.');
  assert.equal(h.targetCount(group(), Number(displayed)), 3);
  h.applyTargetPercent(input(displayed));
  assert.equal(group().sampleTarget, 3);
  assert.equal(group().explicitTarget, true);
  assert.equal(h.state.selections, selections, 'An unchanged field does not convert the saved exact target.');
});

test('a new percentage clears a saved exact target while preserving custom selection and decisions', () => {
  const selections = { 'species:BARBAR': { sampleTarget: 3, selectedIds: ['contact-2', 'contact-3'] } };
  const reviews = { 'contact-1': { status: 'confirmed', label: 'BARBAR' } };
  const drafts = { 'contact-2': { status: 'corrected', label: 'PIPPIP', notes: 'À écouter' } };
  const { h, input, group } = ui(14, selections, reviews, drafts);
  const chosen = [...group().selectedIds];
  const beforeReviews = JSON.stringify(reviews); const beforeDrafts = JSON.stringify(drafts);
  h.applyTargetPercent(input('50'));
  assert.equal(group().sampleTarget, 7);
  assert.equal(group().samplePercent, 50);
  assert.equal(Object.hasOwn(h.state.selections['species:BARBAR'], 'sampleTarget'), false);
  assert.equal(JSON.stringify(group().selectedIds), JSON.stringify(chosen));
  assert.equal(group().selectionDeficit, 4, 'A larger target exposes the deficit without replacing hand-picked contacts.');
  assert.equal(JSON.stringify(h.state.reviews), beforeReviews);
  assert.equal(JSON.stringify(h.state.drafts), beforeDrafts);
});

test('invalid percentage fields leave the saved target unchanged and focus the field', () => {
  for (const value of ['', ' ', 'bad', '-0.01', '100.01', 'Infinity']) {
    const { h, input, group, toast } = ui();
    const field = input(value); const before = JSON.stringify(h.state.selections);
    h.applyTargetPercent(field);
    assert.equal(group().sampleTarget, 3);
    assert.equal(JSON.stringify(h.state.selections), before);
    assert.equal(field.focused, true);
    assert.equal(field['aria-invalid'], 'true');
    assert.match(toast.textContent, /pourcentage entre 0 et 100/);
  }
  const { h, input } = ui(); const field = input(20); field.validity.badInput = true;
  h.applyTargetPercent(field);
  assert.equal(field.focused, true);
  assert.deepEqual(Object.keys(h.state.selections), []);
});

test('zero percent retains one obligatory reference, while 100 percent selects all contacts', () => {
  const { h, input, group } = ui();
  h.applyTargetPercent(input(0));
  assert.equal(group().samplePercent, 0);
  assert.equal(group().sampleTarget, 1);
  assert.equal(group().selectedIds.length, 1);
  assert.ok(group().selectedIds.includes(group().anchorId));
  h.applyTargetPercent(input(100));
  assert.equal(group().sampleTarget, 14);
  assert.equal(group().selectedIds.length, 14);
});

test('percentage preview is reversible until applied and a lower target retains extra custom checks', () => {
  const selections = { 'species:BARBAR': { selectedIds: ['contact-2', 'contact-3', 'contact-4'] } };
  const { h, input, group } = ui(14, selections, { 'contact-1': { status: 'confirmed', label: 'BARBAR' } });
  const chosen = JSON.stringify(group().selectedIds);
  assert.equal(h.updateTargetPreview(input(0)), 0);
  assert.equal(group().sampleTarget, 3, 'Editing the percentage alone has no effect on classification.');
  assert.equal(h.state.selections, selections);
  h.applyTargetPercent(input(0));
  assert.equal(group().sampleTarget, 1);
  assert.equal(JSON.stringify(group().selectedIds), chosen);
  assert.equal(group().requiredCount, 3, 'Unchecked selected contacts remain mandatory even below the new quota.');
});
