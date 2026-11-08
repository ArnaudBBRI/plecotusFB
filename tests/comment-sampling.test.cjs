const test = require('node:test');
const assert = require('node:assert/strict');
const Workflow = require('../manual-workflow.js');

test('adding or editing contact comments never changes the mandatory sample', () => {
  const source = {
    fileName: 'commentaires.csv',
    headers: ['IN FILE', 'AUTO-ID', 'MATCH RATIO', 'Qual'],
    records: Array.from({ length: 30 }, (_, index) => ['son-' + index + '.wav', 'NYCNOC', '.9', String(30 - index)])
  };
  const decisions = { decisions: [{ recordIndex: 0, status: 'validated', manualId: 'NYCNOC' }] };
  const expected = Workflow.build(source, decisions).groups[0].selectedIndices;
  const annotated = {
    ...source, headers: [...source.headers, 'COMMENTAIRE PLECOTUS'],
    records: source.records.map((row, index) => [...row, index % 2 ? 'Cris faibles\nÀ réécouter.' : ''])
  };
  const original = structuredClone(annotated);
  assert.deepEqual(Workflow.build(annotated, decisions).groups[0].selectedIndices, expected);
  annotated.records[3][4] = 'Avis du collègue : séquence irrégulière, "clics".';
  assert.deepEqual(Workflow.build(annotated, decisions).groups[0].selectedIndices, expected);
  assert.deepEqual(annotated.records[0], original.records[0], 'building a plan must leave comment cells intact');
});
