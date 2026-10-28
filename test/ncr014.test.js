import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistory } from '../lib/history.js';
import { summaryText, validityReport } from '../lib/summary.js';
import { NCR_014, gate, newEngine, p001AfterImport, sampleCsv, unit } from './helpers.js';

const P001 = (e) => e.state.projects['P-001'];
const byId = (arr, id) => arr.find((x) => x.id === id);

function afterNcr014() {
  const e = newEngine();
  p001AfterImport(e);
  e.dispatch('raiseIssue', NCR_014);
  return e;
}

test('before NCR-014: the logger file gives U1 pass, U2 fail, U3 needs the engineer; the sign-off is a new result with a reason', () => {
  const e = newEngine();
  e.dispatch('importLoadTest', { projectId: 'P-001', csvText: sampleCsv(), filename: 'x.csv', by: 'kemal.arslan' });
  const tests = (id) => unit(e, 'P-001', id).tests;
  assert.deepEqual([tests('U1')[0].outcome, tests('U2')[0].outcome, tests('U3')[0].outcome], ['pass', 'fail', 'fail']);
  e.dispatch('recordLoadTest', { projectId: 'P-001', unitId: 'U3', outcome: 'pass', reason: 'Logger dropout at 10:45', by: 'kemal.arslan' });
  assert.equal(tests('U3').length, 2, 'the strict FAIL stays in the history next to the sign-off');
  assert.equal(tests('U3')[1].source, 'manual');
});

test('a manual result needs a reason and a valid outcome', () => {
  const e = newEngine();
  assert.throws(() => e.dispatch('recordLoadTest', { projectId: 'P-001', unitId: 'U1', outcome: 'pass', reason: ' ', by: 'x' }), /reason/i);
  assert.throws(() => e.dispatch('recordLoadTest', { projectId: 'P-001', unitId: 'U1', outcome: 'maybe', reason: 'r', by: 'x' }), /pass/);
});

test('NCR-014: Unit 2 is back in Design, Units 1 and 3 stay in Commissioning', () => {
  const e = afterNcr014();
  assert.equal(unit(e, 'P-001', 'U2').phase, 'Design');
  assert.equal(unit(e, 'P-001', 'U1').phase, 'Commissioning');
  assert.equal(unit(e, 'P-001', 'U3').phase, 'Commissioning');
  assert.deepEqual(unit(e, 'P-001', 'U2').sentBack, { ref: 'NCR-014', fromPhase: 'Commissioning', toPhase: 'Design' });
});

test('NCR-014: Units 1 and 3 have passed their load tests and wait only for the commissioning report', async () => {
  const e = afterNcr014();
  for (const u of ['U1', 'U3']) {
    const g = await gate(e, 'P-001', u);
    assert.equal(g.to, 'Handover');
    assert.equal(g.missing.length, 1);
    assert.match(g.missing[0], /No commissioning_report/);
  }
});

test('NCR-014: partial handover — U1 and U3 hand over while U2 is still in Design', async () => {
  const e = afterNcr014();
  e.dispatch('addDocument', { projectId: 'P-001', type: 'commissioning_report', title: 'Commissioning report U1+U3', appliesTo: ['U1', 'U3'], by: 'kemal.arslan' });
  assert.equal((await gate(e, 'P-001', 'U1')).ok, true);
  assert.equal((await gate(e, 'P-001', 'U3')).ok, true);
  assert.equal((await gate(e, 'P-001', 'U2')).ok, false, 'the report is not for Unit 2');
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U1', by: 'selin.kaya' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U3', by: 'selin.kaya' });
  assert.deepEqual(P001(e).units.map((u) => u.phase), ['Handover', 'Design', 'Handover']);
  assert.equal(summaryText(e.state, P001(e)), 'Units 1 and 3 in Handover; Unit 2 back in Design (NCR-014).');
});

test('NCR-014: plain-words summary of the project', () => {
  const e = afterNcr014();
  assert.equal(summaryText(e.state, P001(e)), 'Units 1 and 3 in Commissioning; Unit 2 back in Design (NCR-014).');
  e.dispatch('addDocument', { projectId: 'P-001', type: 'commissioning_report', title: 'Report', appliesTo: ['U1', 'U3'], by: 'kemal.arslan' });
  assert.equal(summaryText(e.state, P001(e)), 'Units 1 and 3 ready for Handover; Unit 2 back in Design (NCR-014).');
});

test('NCR-014: design approval D-102 stays valid for Units 1 and 3 but not for Unit 2', () => {
  const e = afterNcr014();
  const d102 = byId(validityReport(e.state, P001(e)).documents, 'D-102');
  assert.deepEqual(d102.validFor, ['Unit 1', 'Unit 3']);
  assert.deepEqual(d102.invalidFor, ['Unit 2']);
  assert.deepEqual(d102.invalidatedBy, ['NCR-014']);
});

test('NCR-014: Unit 2 alternator is invalid and replaced by ALT-2.5-B (new order, 10 weeks); the old record stays', () => {
  const e = afterNcr014();
  const eq = P001(e).equipment;
  const old = byId(eq, 'P001-U2-ALT');
  assert.equal(old.valid, false);
  assert.equal(old.invalidatedBy, 'NCR-014');
  assert.equal(old.model, 'ALT-2.1-A');
  assert.equal(old.status, 'Installed', 'the old record is not rewritten');
  const neu = byId(eq, old.supersededBy);
  assert.equal(neu.model, 'ALT-2.5-B');
  assert.equal(neu.status, 'Ordered');
  assert.equal(neu.expected_delivery, '2027-01-04'); // 2026-10-26 + 10 weeks
  assert.equal(neu.valid, true);
  assert.equal(neu.replaces, 'P001-U2-ALT');
});

test('NCR-014: exactly T-1204, T-1205, T-1206 must be redone; engine, foundation, exhaust and fuel are untouched', () => {
  const e = afterNcr014();
  const tasks = P001(e).tasks;
  for (const id of ['T-1204', 'T-1205', 'T-1206']) assert.equal(byId(tasks, id) && validityReport(e.state, P001(e)).tasks.find((t) => t.id === id).mustBeRedone, true, id);
  const report = validityReport(e.state, P001(e));
  for (const id of ['T-1201', 'T-1202', 'T-1203']) assert.equal(byId(report.tasks, id).status, 'done', id);
  assert.equal(byId(report.equipment, 'P001-U2-ENG').valid, true);
  // Units 1 and 3 installation tasks are untouched
  assert.ok(report.tasks.filter((t) => t.unit !== 'Unit 2' && t.phase === 'Installation').every((t) => t.status === 'done'));
});

test('NCR-014: Unit 2 load-test result is invalid, but the failed result stays in the history', () => {
  const e = afterNcr014();
  const u2 = unit(e, 'P-001', 'U2');
  assert.equal(u2.tests.length, 1);
  assert.equal(u2.tests[0].outcome, 'fail');
  const t = validityReport(e.state, P001(e)).tests.find((x) => x.unit === 'Unit 2');
  assert.equal(t.valid, false);
  assert.match(t.note, /re-test is needed/);
  assert.equal(validityReport(e.state, P001(e)).tests.find((x) => x.unit === 'Unit 1').valid, true);
});

test('NCR-014: project-wide items stay valid (site survey, mechanical completion, switchgear, grid)', () => {
  const e = afterNcr014();
  const report = validityReport(e.state, P001(e));
  assert.equal(byId(report.documents, 'D-101').valid, true);
  assert.equal(byId(report.documents, 'D-103').valid, true);
  assert.equal(byId(report.equipment, 'P001-SWG').valid, true);
  assert.equal(P001(e).grid_capacity_confirmed_kw, 6500);
  assert.ok(report.tasks.filter((t) => t.unit === 'project-wide').every((t) => t.valid));
});

test('NCR-014 is append-only: earlier events are untouched and the raise is one new entry', () => {
  const e = newEngine();
  p001AfterImport(e);
  const before = JSON.stringify(e.events);
  e.dispatch('raiseIssue', NCR_014);
  const after = e.events;
  assert.equal(JSON.stringify(after.slice(0, -1)), before);
  assert.equal(after.at(-1).type, 'issue.raised');
  assert.equal(after.at(-1).by, 'selin.kaya');
  assert.ok(after.at(-1).at);
});

test('NCR-014: Unit 2 travels forward through the SAME gates, no special path, then hands over', async () => {
  const e = afterNcr014();
  // Design -> Procurement needs a design approval valid FOR UNIT 2 (D-102 no longer counts)
  let g = await gate(e, 'P-001', 'U2');
  assert.equal(g.to, 'Procurement');
  assert.match(g.missing[0], /D-102 was invalidated by NCR-014/);
  e.dispatch('addDocument', { projectId: 'P-001', type: 'design_approval', title: 'Design approval rev C (Unit 2 only)', appliesTo: ['U2'], by: 'selin.kaya' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });
  assert.equal(unit(e, 'P-001', 'U2').phase, 'Procurement');
  assert.equal(unit(e, 'P-001', 'U2').sentBack.ref, 'NCR-014', 'still marked as back until it is where it was');

  // Procurement -> Installation: the NEW alternator must be Delivered
  g = await gate(e, 'P-001', 'U2');
  assert.equal(g.to, 'Installation');
  assert.equal(g.missing.length, 1);
  assert.match(g.missing[0], /Unit 2 alternator ALT-2\.5-B \(P001-U2-ALT-R1\) is still Ordered \(expected 2027-01-04\)/);
  e.dispatch('advanceEquipment', { projectId: 'P-001', equipmentId: 'P001-U2-ALT-R1', date: '2027-01-04', by: 'murat.demir' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });

  // Installation -> Commissioning: the three redone tasks (and ONLY those)
  g = await gate(e, 'P-001', 'U2');
  assert.equal(g.to, 'Commissioning');
  assert.deepEqual(g.missing.map((m) => /T-\d+/.exec(m)[0]), ['T-1204', 'T-1205', 'T-1206']);
  for (const taskId of ['T-1204', 'T-1205', 'T-1206']) e.dispatch('completeTask', { projectId: 'P-001', taskId, by: 'murat.demir' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });
  assert.equal(unit(e, 'P-001', 'U2').sentBack, null, 'back where it was: no longer "back"');

  // Commissioning -> Handover: a NEW test and a commissioning report that covers Unit 2
  g = await gate(e, 'P-001', 'U2');
  assert.equal(g.missing.length, 2);
  assert.match(g.missing[0], /no valid load-test result \(earlier results were invalidated/);
  e.dispatch('recordLoadTest', { projectId: 'P-001', unitId: 'U2', outcome: 'pass', reason: 'Re-test with ALT-2.5-B: 4h at 98 %', by: 'kemal.arslan' });
  e.dispatch('addDocument', { projectId: 'P-001', type: 'commissioning_report', title: 'Commissioning report Unit 2', appliesTo: ['U2'], by: 'kemal.arslan' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });
  assert.equal(unit(e, 'P-001', 'U2').phase, 'Handover');
  assert.equal(unit(e, 'P-001', 'U2').tests.length, 2, 'failed result + re-test, both kept');
});

test('NCR-014: the history of Unit 2 tells the whole story, in order', () => {
  const e = afterNcr014();
  const h = buildHistory(e.state, e.events, { projectId: 'P-001', unitId: 'U2' }).map((x) => x.text);
  const idx = (re) => h.findIndex((t) => re.test(t));
  assert.ok(idx(/Document D-102 \(design_approval\) on file/) >= 0, 'it passed Design (approval on file)');
  assert.ok(idx(/Load test Unit 2: FAIL/) > idx(/Document D-102/));
  const raised = idx(/Issue NCR-014 raised against Unit 2: sent back Commissioning → Design/);
  assert.ok(raised > idx(/Load test Unit 2: FAIL/));
  assert.match(h[raised], /Alternator undersized|undersized/);
  assert.match(h[raised], /T-1204, T-1205, T-1206/);
  assert.match(h[raised], /ALT-2\.5-B ordered as P001-U2-ALT-R1, expected 2027-01-04/);
  const entry = buildHistory(e.state, e.events, { projectId: 'P-001', unitId: 'U2' }).find((x) => /Issue NCR-014/.test(x.text));
  assert.equal(entry.by, 'Selin Kaya');
  assert.ok(entry.when);
  // Unit 2's history does not contain Unit 1 / Unit 3 test results
  assert.ok(!h.some((t) => /Load test Unit 1|Load test Unit 3/.test(t)));
});

test('NCR is not hard-coded: P-002 Unit 1 can go back to Design with another reference and component', async () => {
  const e = newEngine();
  const ev = e.dispatch('raiseIssue', {
    projectId: 'P-002', ref: 'NCR-020', unitIds: ['U1'], targetPhase: 'Design', component: 'engine', by: 'tom.bright',
    description: 'Engine room ventilation insufficient',
    replacements: [{ replaces: 'P002-U1-ENG', model: 'DX-1200 Diesel Engine', leadTimeWeeks: 14 }],
  });
  assert.equal(ev.length, 1);
  const u = (id) => e.state.projects['P-002'].units.find((x) => x.id === id);
  assert.equal(u('U1').phase, 'Design');
  assert.equal(u('U2').phase, 'Procurement', 'the other unit carries on');
  const report = validityReport(e.state, e.state.projects['P-002']);
  assert.deepEqual(byId(report.documents, 'D-202').invalidFor, ['Unit 1']);
  assert.deepEqual(byId(report.documents, 'D-202').validFor, ['Unit 2']);
  assert.equal(byId(report.equipment, 'P002-U1-ENG').valid, false);
  assert.equal(byId(report.equipment, 'P002-U1-ALT').valid, true);
  assert.equal(e.state.projects['P-002'].equipment.find((x) => x.replaces === 'P002-U1-ENG').expected_delivery, '2027-02-01');
  // and Unit 1 walks forward through the same gate code as everybody else
  assert.match((await gate(e, 'P-002', 'U1')).missing[0], /D-202 was invalidated by NCR-020/);
});

test('issues are validated: only EARLIER phases, existing units, unique references, a reason', () => {
  const e = newEngine();
  const base = { projectId: 'P-001', ref: 'NCR-1', description: 'x', unitIds: ['U1'], by: 'selin.kaya' };
  assert.throws(() => e.dispatch('raiseIssue', { ...base, targetPhase: 'Commissioning' }), /EARLIER phase/);
  assert.throws(() => e.dispatch('raiseIssue', { ...base, targetPhase: 'Handover' }), /EARLIER phase/);
  assert.throws(() => e.dispatch('raiseIssue', { ...base, targetPhase: 'Design', unitIds: ['U9'] }), /not found/);
  assert.throws(() => e.dispatch('raiseIssue', { ...base, targetPhase: 'Design', unitIds: [] }), /at least one unit/);
  assert.throws(() => e.dispatch('raiseIssue', { ...base, targetPhase: 'Design', description: ' ' }), /description/);
  assert.throws(() => e.dispatch('raiseIssue', { ...base, targetPhase: 'Design', by: '' }), /Who you are/);
  assert.equal(e.events.length, 0);
  e.dispatch('raiseIssue', { ...base, targetPhase: 'Design' });
  assert.throws(() => e.dispatch('raiseIssue', { ...base, targetPhase: 'Design', unitIds: ['U2'] }), /already exists/);
});

test('the person raising the issue can override the suggested invalidations', () => {
  const e = newEngine();
  e.dispatch('raiseIssue', {
    ...NCR_014, replacements: [],
    invalidations: { equipment: ['P001-U2-ALT'], tasks: ['T-1204'], documents: [], tests: ['U2'] },
  });
  const report = validityReport(e.state, e.state.projects['P-001']);
  assert.equal(byId(report.tasks, 'T-1204').mustBeRedone, true);
  assert.equal(byId(report.tasks, 'T-1205').mustBeRedone, false);
  assert.equal(byId(report.documents, 'D-102').valid, true, 'only what was picked is invalidated');
});
