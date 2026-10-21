// Verify real browser downloads against their saved project, without reproducing
// source CSV exports or relying on filenames as contact identities.
// node tests/export-check.cjs project.json reviewed.csv review-log.csv [summary.csv] [classified.csv] [semimanual.csv] [activities.csv]
const fs = require('node:fs');
const assert = require('node:assert/strict');
const Core = require('../core.js');
const Automation = require('../automation.js');

const [projectPath, reviewedPath, logPath, summaryPath, classifiedPath, semimanualPath, activitiesPath] = process.argv.slice(2);
if (!projectPath || !reviewedPath || !logPath) {
  process.stderr.write('Usage: node tests/export-check.cjs project.json reviewed.csv review-log.csv [summary.csv] [classified.csv] [semimanual.csv] [activities.csv]\n');
  process.exitCode = 1;
} else {
  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  assert.equal(project.format, 'plecotus-review');
  assert.ok([1, 2, 3].includes(project.version), 'Recognized saved-project version.');
  const selections = project.version === 3 ? project.selections || {} : {};
  if (project.version === 3) {
    assert.ok(project.selections && typeof project.selections === 'object' && !Array.isArray(project.selections), 'Version 3 saves the per-species controls.');
    assert.equal(project.policy.version, 2, 'Version 3 uses the new species policy.');
    assert.deepEqual(project.policy, Automation.normalizePolicy(project.policy), 'Stored policy contains the current sample percentage and Noise preference.');
  }
  const source = Core.parseCSV(project.source.text);
  const analysis = Core.analyze(source.headers, source.records);
  analysis.headers = source.headers;
  const classification = Automation.classify(analysis, project.reviews || {}, project.policy, project.drafts || {}, selections);
  const groups = new Map(classification.groups.map(group => [group.key, group]));
  const updated = Core.parseCSV(fs.readFileSync(reviewedPath, 'utf8'));
  const log = Core.parseCSV(fs.readFileSync(logPath, 'utf8'));
  const reviewedStatuses = new Set(['confirmed', 'corrected', 'uncertain', 'noise']);
  const originalManualColumn = analysis.columns.manualId;
  const expectedHeaders = source.headers.slice();
  let manualColumn = originalManualColumn;
  if (manualColumn < 0) { manualColumn = expectedHeaders.length; expectedHeaders.push('MANUAL ID'); }
  assert.deepEqual(updated.headers, expectedHeaders, 'Export preserves all source headers and their order.');
  assert.equal(updated.records.length, source.records.length, 'No source contact is removed or merged.');
  assert.equal(log.records.length, source.records.length, 'Review log contains every source contact.');
  assert.equal(updated.delimiter, source.delimiter, 'Export preserves the detected source CSV dialect.');

  const logHeaders = ['SOURCE ROW', 'INDIR', 'FOLDER', 'IN FILE', 'CHANNEL', 'OFFSET', 'DATE', 'TIME', 'NIGHT', 'AUTO ID', 'ORIGINAL MANUAL ID', 'REVIEW STATUS', 'REVIEW LABEL', 'REVIEWER', 'REVIEWED AT', 'NOTES', 'GROUP RANK', 'REFERENCE PICK', 'MATCHING', 'PULSES', 'MATCH RATIO', 'MARGIN', 'DATA ISSUES'];
  if (classification) logHeaders.push('ASSIGNED LABEL', 'ASSIGNMENT ORIGIN', 'ASSIGNMENT STATUS', 'REQUIRED MANUAL CHECK', 'CHECK ROLE', 'ASSIGNMENT REASON', 'CLASSIFICATION POLICY', 'SEMIMANUAL ID', 'SEMIMANUAL METHOD', 'GLOBAL GROUP', 'SAMPLE SELECTED', 'SAMPLE TARGET');
  assert.deepEqual(log.headers, logHeaders);
  const safe = value => /^[\t\r\n ]*[=+@-]/.test(String(value)) ? "'" + value : value;
  let changed = 0, checkedCount = 0, imported = 0;
  analysis.rows.forEach((row, index) => {
    const decision = (project.reviews || {})[row.id];
    const isReviewed = decision && reviewedStatuses.has(decision.status);
    const expected = row.raw.slice();
    while (expected.length < expectedHeaders.length) expected.push('');
    if (isReviewed) { expected[manualColumn] = decision.label; checkedCount++; }
    else if (row.manualId) imported++;
    assert.deepEqual(updated.records[index], expected, 'Only submitted MANUAL ID decisions may change source row ' + (index + 1) + '.');
    if (updated.records[index][manualColumn] !== (originalManualColumn < 0 ? '' : row.raw[originalManualColumn])) changed++;
    const status = isReviewed ? decision.status : row.manualId ? 'imported' : 'unreviewed';
    const assignment = classification.byId.get(row.id);
    const group = groups.get(assignment.groupKey);
    const expectedLogValues = [row.index + 1, row.indir, row.rawFolder, row.file, row.channel, row.offset, row.date, row.time, row.night, row.autoId, row.manualId, status, isReviewed ? decision.label : row.manualId || '', isReviewed ? decision.reviewer : '', isReviewed ? decision.timestamp : '', isReviewed ? decision.notes : '', assignment.rank, assignment.isAnchor ? 'yes' : 'no', row.matching ?? '', row.pulses ?? '', row.ratio ?? '', row.margin ?? '', row.issues.join(' | ')];
    if (classification) {
      expectedLogValues.push(assignment.label, assignment.origin, assignment.status, assignment.requiresReview ? 'yes' : 'no', assignment.role, assignment.reason, JSON.stringify(classification.policy), assignment.semimanualLabel, assignment.semimanualMethod, assignment.groupKey, group.selectedIds.includes(row.id) ? 'yes' : 'no', group.sampleTarget);
    }
    const expectedLog = expectedLogValues.map(value => String(safe(value == null ? '' : value)));
    assert.deepEqual(log.records[index], expectedLog, 'Audit record preserves contact identity and decision for source row ' + (index + 1) + '.');
    if (isReviewed || row.manualId) {
      assert.equal(assignment.origin, 'manual', 'A real human label retains priority over SEMIMANUAL ID.');
      assert.equal(assignment.label, String(isReviewed ? decision.label : row.manualId).trim());
    }
  });
  if (classification) {
    const metrics = classification.metrics;
    const roundtrip = JSON.parse(JSON.stringify(project));
    const restored = Automation.classify(analysis, roundtrip.reviews || {}, roundtrip.policy, roundtrip.drafts || {}, roundtrip.version === 3 ? roundtrip.selections || {} : {});
    const outcomes = result => result.assignments.map(({ id, label, origin, status, requiresReview, role, groupKey, rank, isAnchor, semimanualLabel, semimanualMethod }) => ({ id, label, origin, status, requiresReview, role, groupKey, rank, isAnchor, semimanualLabel, semimanualMethod }));
    assert.deepEqual(outcomes(restored), outcomes(classification), 'JSON project roundtrip preserves decisions, per-species selections and assignments.');
    const controls = result => result.groups.map(({ key, mode, sampleTarget, selectedIds, distribution }) => ({ key, mode, sampleTarget, selectedIds, distribution }));
    assert.deepEqual(controls(restored), controls(classification), 'Roundtrip preserves targets, custom choices and integer proportional allocation.');
    for (const origin of ['manual', 'inferred', 'ignored', 'pending']) assert.equal(metrics[origin], classification.assignments.filter(item => item.origin === origin).length, 'Reported ' + origin + ' total equals the actual row outcomes.');
    assert.equal(metrics.manual, checkedCount + imported, 'Submitted and imported human decisions count as manual.');
    const noIdKey = value => String(value).trim().normalize('NFD').replace(/[\u0300-\u036f\s_-]+/g, '').toUpperCase();
    const explicitNoIdLabels = new Set(['NoID', 'NoID Pip', 'NoID Ser', 'NoID Myo', 'NoID Ple', 'Unidentified bat', 'Chauve-souris non identifiée', 'Pipistrelle non identifiée', 'Sérotule non identifiée', 'Murin non identifié', 'Oreillard non identifié', 'Chiroptère non identifié', 'Chiroptère indéterminé', 'Chiroptera sp.', 'Chiroptera indet.'].map(noIdKey));
    const expectedUncertain = classification.assignments.filter(item => item.status === 'inferred-uncertain' || item.status === 'uncertain' && !explicitNoIdLabels.has(noIdKey(item.label))).length;
    assert.equal(metrics.uncertain, expectedUncertain, 'Explicit NoID outcomes are countable results even in older uncertain-status decisions; other manual and inferred uncertainty stays separate.');
    assert.equal(metrics.manual + metrics.inferred + metrics.ignored + metrics.pending, source.records.length, 'Every contact has one current outcome.');
    assert.equal(metrics.required + metrics.waiting, metrics.pending, 'All pending contacts are mandatory or waiting.');
    assert.equal(classification.summary.reduce((sum, entry) => sum + entry.total, 0), source.records.length, 'Summary preserves all contacts.');
    for (const entry of classification.summary) assert.equal(entry.manual + entry.inferred + entry.ignored + entry.pending, entry.total, 'Each summary outcome conserves contacts.');
    const identity = value => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const keys = new Set(analysis.rows.map(row => row.kind + ':' + identity(row.autoId)));
    assert.deepEqual(new Set(groups.keys()), keys, 'Species groups span the entire CSV across folders and nights.');
    const descending = (a, b) => {
      const va = typeof a === 'number' && Number.isFinite(a), vb = typeof b === 'number' && Number.isFinite(b);
      return va && vb ? b - a : va ? -1 : vb ? 1 : 0;
    };
    for (const group of classification.groups) {
      const rows = analysis.rows.filter(row => row.kind + ':' + identity(row.autoId) === group.key);
      const ranked = rows.slice().sort((a, b) => descending(a.matching, b.matching) || descending(a.ratio, b.ratio) || descending(a.margin, b.margin) || a.index - b.index);
      ranked.forEach((row, index) => assert.equal(classification.byId.get(row.id).rank, index + 1, 'Global rank follows matching, ratio, margin, then source order.'));
      if (group.kind !== 'species') {
        assert.ok(rows.every(row => classification.byId.get(row.id).origin !== 'inferred'), 'Noise, NoID and unclassified contacts receive no inferred species labels.');
        continue;
      }
      assert.equal(group.anchorId, ranked[0].id, 'Each species has one globally best reference.');
      assert.ok(group.selectedIds.includes(group.anchorId), 'The reference stays in the chosen sample.');
      assert.equal(group.strata.reduce((sum, bin) => sum + bin.total, 0), rows.length, 'Ratio classes include every species contact.');
      assert.equal(group.strata.reduce((sum, bin) => sum + bin.selectedCount, 0), group.selectedIds.length, 'Ratio classes account for the complete selection.');
      const above = rows.filter(row => typeof row.ratio === 'number' && Number.isFinite(row.ratio) && row.ratio > 0.6 && row.ratio <= 1).length;
      assert.equal(group.ratioAboveThresholdCount, above);
      assert.equal(group.majorityPass, above > rows.length / 2, 'Majority and ratio boundaries are strict.');
      if (group.mode === 'autoid') {
        assert.ok(group.referenceMatches && above > rows.length / 2 && !group.excluded, 'Direct assignment meets all three user conditions.');
        rows.forEach(row => assert.equal(classification.byId.get(row.id).semimanualLabel, row.importedAutoId, 'Fast branch copies raw Auto-ID into every SEMIMANUAL ID cell.'));
      } else if (group.mode === 'proportion' && group.canInfer) {
        assert.ok(group.manualCount >= group.sampleTarget, 'Manual quota is reached before extrapolation.');
        assert.equal(group.pendingValidation.length, 0, 'All selected contacts are checked before extrapolation.');
        const remaining = rows.filter(row => classification.byId.get(row.id).origin === 'inferred').length;
        assert.equal(group.distribution.reduce((sum, entry) => sum + entry.inferredCount, 0), remaining, 'Proportional allocation covers exactly all remaining inferred rows.');
        for (const entry of group.distribution) {
          const exact = remaining * entry.manualCount / group.manualCount;
          assert.ok(entry.inferredCount === Math.floor(exact) || entry.inferredCount === Math.ceil(exact), 'Integer allocation differs from each observed proportion by at most one contact.');
          const allocated = rows.filter(row => {
            const item = classification.byId.get(row.id);
            return item.origin === 'inferred' && (item.status === 'inferred-uncertain') === entry.uncertain && identity(item.label) === identity(entry.label);
          }).length;
          assert.equal(allocated, entry.inferredCount, 'Distribution agrees with actual semi-manual row labels.');
        }
      } else assert.ok(rows.every(row => classification.byId.get(row.id).origin !== 'inferred'), 'Unfinished references or samples produce no extrapolated labels.');
    }
  }
  if (summaryPath) {
    assert.ok(classification, 'Summary export verification requires an analyzed project.');
    const summary = Core.parseCSV(fs.readFileSync(summaryPath, 'utf8'));
    const frenchSummary = summary.headers[0] === 'LIBELLÉ';
    const englishHeaders = ['LABEL', 'CATEGORY', 'MANUALLY CHECKED CONTACTS', 'INFERRED CONTACTS', 'TOTAL CONTACTS', 'SOURCE FILE', 'CHECKS COMPLETE', 'POLICY', 'GENERATED AT'];
    const frenchHeaders = ['LIBELLÉ','CATÉGORIE','CONTACTS VÉRIFIÉS MANUELLEMENT','CONTACTS ATTRIBUÉS PAR LES RÈGLES','TOTAL DES CONTACTS','FICHIER SOURCE','VÉRIFICATIONS TERMINÉES','RÈGLES','DATE DE GÉNÉRATION'];
    const hasIgnored = summary.headers.includes(frenchSummary ? 'CONTACTS IGNORÉS' : 'IGNORED CONTACTS');
    if (hasIgnored) {
      frenchHeaders.splice(4, 0, 'CONTACTS IGNORÉS');
      englishHeaders.splice(4, 0, 'IGNORED CONTACTS');
    }
    assert.deepEqual(summary.headers, frenchSummary ? frenchHeaders : englishHeaders);
    const translatedOutcomes = {'Noise':'Bruit','No ID':'Sans identification (NoID)','NoID':'Sans identification (NoID)','Unclassified':'Non classé','Unidentified bat':'Chauve-souris non identifiée','Pending classification':'Classification en attente','Uncertain / unresolved':'Identification incertaine / non résolue'};
    const translatedCategories = {taxon:'taxon',noise:'bruit',uncertain:'incertain',unresolved:'non résolu',pending:'en attente'};
    assert.equal(summary.records.length, classification.summary.length, 'No outcome category is omitted or duplicated.');
    const checksComplete = classification.metrics.required === 0 && classification.metrics.waiting === 0;
    let generatedAt;
    classification.summary.forEach((entry, index) => {
      const label = frenchSummary ? translatedOutcomes[entry.label] || entry.label : entry.label;
      const completion = frenchSummary ? (checksComplete ? 'oui' : 'non') : (checksComplete ? 'yes' : 'no');
      const category = frenchSummary ? translatedCategories[entry.category] : entry.category;
      const counts = [label, category, entry.manual, entry.inferred];
      if (hasIgnored) counts.push(entry.ignored);
      const expected = [...counts, entry.total, project.source.name, completion, JSON.stringify(classification.policy)].map(value => String(safe(value)));
      assert.deepEqual(summary.records[index].slice(0, expected.length), expected, 'Summary label, category, counts, source and policy agree for outcome ' + (index + 1) + '.');
      const timestamp = summary.records[index][expected.length];
      assert.ok(Number.isFinite(Date.parse(timestamp)) && new Date(timestamp).toISOString() === timestamp, 'Generated timestamp is a UTC ISO time.');
      if (generatedAt) assert.equal(timestamp, generatedAt, 'One export shares one generated timestamp.');
      generatedAt = timestamp;
    });
    assert.equal(summary.records.reduce((sum, record) => sum + Number(record[hasIgnored ? 5 : 4]), 0), source.records.length, 'Exported summary totals conserve all contacts.');
  }
  if (classifiedPath) {
    assert.ok(classification, 'Classified export verification requires an analyzed project.');
    const classified = Core.parseCSV(fs.readFileSync(classifiedPath, 'utf8'));
    const metadataHeaders = ['PLECOTUS SOURCE ROW', 'PLECOTUS ASSIGNED LABEL', 'PLECOTUS ORIGIN', 'PLECOTUS STATUS', 'PLECOTUS CHECK REQUIRED', 'PLECOTUS CHECK ROLE', 'PLECOTUS REASON', 'PLECOTUS POLICY', 'PLECOTUS SEMIMANUAL ID', 'PLECOTUS SEMIMANUAL METHOD', 'PLECOTUS GLOBAL GROUP', 'PLECOTUS SAMPLE SELECTED', 'PLECOTUS SAMPLE TARGET'];
    const classifiedHeaders = source.headers.slice();
    for (const name of metadataHeaders) {
      let unique = name;
      while (classifiedHeaders.some(header => header.toUpperCase() === unique.toUpperCase())) unique += ' (new)';
      classifiedHeaders.push(unique);
    }
    assert.deepEqual(classified.headers, classifiedHeaders, 'Original source headers and collision-safe provenance headers are preserved.');
    assert.equal(classified.delimiter, source.delimiter, 'Classified export keeps the source dialect.');
    assert.equal(classified.records.length, source.records.length, 'Every source contact is retained in original order.');
    analysis.rows.forEach((row, index) => {
      const assignment = classification.byId.get(row.id);
      const group = groups.get(assignment.groupKey);
      assert.deepEqual(classified.records[index].slice(0, source.headers.length), row.raw, 'All source cells, including MANUAL ID and NOTES, are unchanged in classified row ' + (index + 1) + '.');
      const expected = [row.index + 1, assignment.label, assignment.origin, assignment.status, assignment.requiresReview ? 'yes' : 'no', assignment.role, assignment.reason, JSON.stringify(classification.policy), assignment.semimanualLabel, assignment.semimanualMethod, assignment.groupKey, group.selectedIds.includes(row.id) ? 'yes' : 'no', group.sampleTarget].map(value => String(safe(value)));
      assert.deepEqual(classified.records[index].slice(source.headers.length), expected, 'Provenance and current assignment agree for classified row ' + (index + 1) + '.');
    });
  }
  if (semimanualPath) {
    const semi = Core.parseCSV(fs.readFileSync(semimanualPath, 'utf8'));
    const headers = expectedHeaders.slice();
    const candidates = headers.map((header, index) => header.toUpperCase().replace(/[^A-Z0-9]/g, '') === 'SEMIMANUALID' ? index : -1).filter(index => index >= 0);
    assert.ok(candidates.length <= 1, 'Source SEMIMANUAL ID must have one unambiguous column.');
    let semiColumn = candidates[0];
    if (semiColumn === undefined) { semiColumn = headers.length; headers.push('SEMIMANUAL ID'); }
    assert.deepEqual(semi.headers, headers, 'Semi-manual export preserves original headers, appending only missing decision columns.');
    assert.equal(semi.delimiter, source.delimiter, 'Semi-manual export preserves the source dialect.');
    assert.equal(semi.records.length, source.records.length, 'Semi-manual export preserves every source contact in order.');
    analysis.rows.forEach((row, index) => {
      const decision = (project.reviews || {})[row.id];
      const reviewed = decision && reviewedStatuses.has(decision.status);
      const assignment = classification.byId.get(row.id);
      const expected = row.raw.slice();
      while (expected.length < headers.length) expected.push('');
      if (reviewed) expected[manualColumn] = decision.label;
      expected[semiColumn] = assignment.semimanualLabel;
      assert.deepEqual(semi.records[index], expected, 'Only submitted manual decisions and current SEMIMANUAL ID may change source row ' + (index + 1) + '.');
      if (assignment.origin === 'inferred' && !reviewed && !row.manualId) assert.equal(semi.records[index][manualColumn], '', 'An extrapolated label never enters MANUAL ID.');
      if (!assignment.semimanualLabel) assert.equal(semi.records[index][semiColumn], '', 'Stale source semi-manual labels are cleared when no rule currently assigns a label.');
    });
  }
  if (activitiesPath) {
    const Names = require('../species.js');
    assert.equal(classification.metrics.pending, 0, 'Final activity export is available only after mandatory controls are complete.');
    assert.match(require('node:path').basename(activitiesPath), /^activites_chiropteres(?: \(\d+\))?\.csv$/, 'Activity export uses the requested filename, allowing the browser duplicate-download suffix.');
    const bytes = fs.readFileSync(activitiesPath);
    const text = bytes.toString('utf8');
    assert.ok(text.startsWith('\ufeff'), 'Activity export includes a UTF-8 BOM for spreadsheet compatibility.');
    assert.ok(bytes.equals(Buffer.from(text, 'utf8')), 'Activity CSV contains valid UTF-8 bytes.');
    const activities = Core.parseCSV(text);
    assert.deepEqual(activities.headers, ['Nom scientifique', 'Nom vernaculaire', 'Nombre de contacts'], 'Activity report has exactly the three requested French columns.');
    assert.equal(activities.delimiter, ';', 'Activity report uses a semicolon delimiter.');
    const named = Names.activityRows(classification.summary);
    const expected = named.map(row => [row.scientificName, row.frenchName, row.contacts].map(value => String(safe(value))));
    assert.deepEqual(activities.records, expected, 'Scientific names, French names, alias aggregation and contact totals agree with final human-priority assignments.');
    assert.equal(new Set(named.map(row => row.key)).size, named.length, 'Every canonical taxon appears once, including code/scientific/French aliases.');
    assert.ok(activities.records.every(row => row.length === 3 && /^[1-9][0-9]*$/.test(row[2])), 'Every activity row has exactly three cells and a positive integer contact count.');
    const included = classification.summary.filter(Names.isActivitySummaryEntry);
    const includedTotal = included.reduce((sum, row) => sum + row.total, 0);
    const outsideTotal = classification.summary.filter(row => !included.includes(row)).reduce((sum, row) => sum + row.total, 0);
    assert.equal(activities.records.reduce((sum, row) => sum + Number(row[2]), 0), includedTotal, 'Activity counts include every eligible taxon or explicit NoID outcome once, and exclude Noise, pending contacts and unspecified uncertainty.');
    assert.equal(includedTotal + outsideTotal, classification.metrics.total, 'Activity contacts plus the separate excluded outcome counts conserve every source row.');
    const examples = Names.activityRows([
      {label: 'EPTSER', category: 'taxon', total: 1},
      {label: 'Eptesicus serotinus', category: 'taxon', total: 1},
      {label: 'Sérotine commune', category: 'taxon', total: 1},
      {label: 'MYODAS', category: 'taxon', total: 1},
      {label: 'Myotis dasycneme', category: 'taxon', total: 1},
      {label: 'Murin des marais', category: 'taxon', total: 1},
      {label: 'Noise', category: 'noise', total: 50},
      {label: 'Pending classification', category: 'pending', total: 50},
      {label: 'Uncertain / unresolved', category: 'uncertain', total: 50},
      {label: 'NoID', category: 'unresolved', total: 50}
    ]).map(row => [row.key, row.scientificName, row.frenchName, row.contacts]);
    assert.deepEqual(examples, [
      ['EPTSER', 'Eptesicus serotinus', 'Sérotine commune', 3],
      ['MYODAS', 'Myotis dasycneme', 'Murin des marais', 3],
      ['unidentified', 'NoID', 'Chauve-souris non identifiée', 50]
    ], 'Known requested naming examples merge all three aliases and include explicitly assigned NoID contacts, excluding Noise, pending contacts and unspecified uncertainty.');
    if (project.source.name === 'activities-id.csv') {
      assert.deepEqual(activities.records, [
        ['Eptesicus serotinus', 'Sérotine commune', '3'],
        ['Myotis dasycneme', 'Murin des marais', '2']
      ], 'Independent activity fixture expectations: three Sérotines, two Murins and no Noise or source NYCNOC count.');
    }
  }
  process.stdout.write('Verified ' + analysis.rows.length + ' contacts: ' + checkedCount + ' submitted decisions, ' + changed + ' manual-label changes, ' + imported + ' untouched imported manual labels. All other source fields, row identities, channel/offset values and review-log fields match.\n');
  if (classification) process.stdout.write('Verified classification conservation: ' + classification.metrics.manual + ' manual + ' + classification.metrics.inferred + ' inferred + ' + classification.metrics.ignored + ' ignored + ' + classification.metrics.pending + ' pending = ' + classification.metrics.total + ' contacts.' + (summaryPath ? ' Summary export verified.' : '') + (classifiedPath ? ' Classified export verified.' : '') + (semimanualPath ? ' SEMIMANUAL ID export verified.' : '') + (activitiesPath ? ' Three-column activities export verified.' : '') + '\n');
}
