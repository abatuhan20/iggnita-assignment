// One-command replay of the NCR-014 scenario on an in-memory copy of the seed (nothing is written).
//   npm run demo
import fs from 'node:fs';
import { Engine } from '../lib/engine.js';
import { evaluateGate } from '../lib/gates.js';
import { summaryText, validityReport } from '../lib/summary.js';

const read = (f) => fs.readFileSync(`data/${f}`, 'utf8');
let tick = 0;
const e = new Engine({
  seed: JSON.parse(read('projects.json')),
  people: JSON.parse(read('people.json')),
  now: () => `2026-10-26T10:${String(tick++).padStart(2, '0')}:00Z`,
});
const P = () => e.state.projects['P-001'];
const say = (t) => console.log(`\n=== ${t}`);
const gateOf = (u) => evaluateGate(e.state, 'P-001', u);

say('1. Import the logger file (Kemal Arslan, commissioning engineer)');
const imp = e.dispatch('importLoadTest', { projectId: 'P-001', csvText: read('load-test-P-001.csv'), filename: 'load-test-P-001.csv', by: 'kemal.arslan' });
for (const ev of imp) console.log(`  ${ev.unitId}: ${ev.outcome.toUpperCase()} — ${ev.reason}`);

say('2. Unit 3 is a judgement call: Kemal signs it off by hand, with a reason');
e.dispatch('recordLoadTest', {
  projectId: 'P-001', unitId: 'U3', outcome: 'pass', by: 'kemal.arslan',
  reason: 'Strict rule fails only because the reading at 10:45 is missing (logger dropout). Neighbours 1940 / 1966 kW, well above 1900 kW.',
});
console.log('  U3 sign-off recorded (the earlier strict FAIL stays in the history)');

say('3. Selin Kaya raises NCR-014 against Unit 2 only, back to Design');
e.dispatch('raiseIssue', {
  projectId: 'P-001', ref: 'NCR-014', unitIds: ['U2'], targetPhase: 'Design', component: 'alternator', by: 'selin.kaya',
  description: 'Unit 2 load test failed: alternator ALT-2.1-A undersized for ~31 C ambient at its position (Units 1 and 3: ~24 C, ventilated hall).',
  replacements: [{ replaces: 'P001-U2-ALT', model: 'ALT-2.5-B', leadTimeWeeks: 10 }],
});
console.log(`  ${summaryText(e.state, P())}`);

say('4. What is invalid, what remains valid');
const r = validityReport(e.state, P());
for (const d of r.documents) console.log(`  doc ${d.id} ${d.type}: valid for [${d.validFor.join(', ')}]${d.invalidFor.length ? `, INVALID for [${d.invalidFor.join(', ')}]` : ''}`);
for (const q of r.equipment) console.log(`  equipment ${q.id} (${q.model}, ${q.unit}): ${q.valid ? 'valid' : `INVALID (${q.invalidatedBy})`}${q.supersededBy ? ` -> replaced by ${q.supersededBy}` : ''}`);
for (const t of r.tasks.filter((x) => x.unit === 'Unit 2')) console.log(`  task ${t.id} ${t.title}: ${t.mustBeRedone ? 'INVALID, must be redone' : 'still valid'}`);
for (const t of r.tests) console.log(`  load test ${t.unit}: ${t.valid ? t.outcome : `INVALID${t.note ? ` — ${t.note}` : ''}`}`);

say('5. Partial handover: Units 1 and 3 go on while Unit 2 is in Design');
console.log(`  Unit 1 gate: ${gateOf('U1').missing.join('; ')}`);
e.dispatch('addDocument', { projectId: 'P-001', type: 'commissioning_report', title: 'Commissioning report, Units 1 and 3', appliesTo: ['U1', 'U3'], by: 'kemal.arslan' });
for (const u of ['U1', 'U3']) e.dispatch('advanceUnit', { projectId: 'P-001', unitId: u, by: 'selin.kaya' });
console.log(`  ${summaryText(e.state, P())}`);

say('6. Unit 2 walks forward through the same gates');
const step = (label, fn) => { console.log(`  ${label}`); fn(); };
console.log(`  blocked: ${gateOf('U2').missing.join('; ')}`);
step('design re-approval for Unit 2 only -> Procurement', () => {
  e.dispatch('addDocument', { projectId: 'P-001', type: 'design_approval', title: 'Design approval rev C (Unit 2)', appliesTo: ['U2'], by: 'selin.kaya' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });
});
console.log(`  blocked: ${gateOf('U2').missing.join('; ')}`);
step('ALT-2.5-B delivered -> Installation', () => {
  e.dispatch('advanceEquipment', { projectId: 'P-001', equipmentId: 'P001-U2-ALT-R1', date: '2027-01-04', by: 'murat.demir' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });
});
console.log(`  blocked: ${gateOf('U2').missing.join('; ')}`);
step('T-1204, T-1205, T-1206 redone -> Commissioning', () => {
  for (const t of ['T-1204', 'T-1205', 'T-1206']) e.dispatch('completeTask', { projectId: 'P-001', taskId: t, by: 'murat.demir' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });
});
console.log(`  blocked: ${gateOf('U2').missing.join('; ')}`);
step('re-test passed + commissioning report -> Handover', () => {
  e.dispatch('recordLoadTest', { projectId: 'P-001', unitId: 'U2', outcome: 'pass', reason: 'Re-test with ALT-2.5-B: 4h at 98 % of rated', by: 'kemal.arslan' });
  e.dispatch('addDocument', { projectId: 'P-001', type: 'commissioning_report', title: 'Commissioning report, Unit 2', appliesTo: ['U2'], by: 'kemal.arslan' });
  e.dispatch('advanceUnit', { projectId: 'P-001', unitId: 'U2', by: 'selin.kaya' });
});
console.log(`  ${summaryText(e.state, P())}`);

say('7. History of Unit 2');
for (const h of e.history({ projectId: 'P-001', unitId: 'U2' })) {
  console.log(`  ${(h.source === 'seed' ? h.when : h.when.replace('T', ' ').slice(0, 16)).padEnd(16)} ${(h.by || '—').padEnd(13)} ${h.text}`);
}
