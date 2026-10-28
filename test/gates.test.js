import test from 'node:test';
import assert from 'node:assert/strict';
import { gate, newEngine, unit } from './helpers.js';

test('P-003 cannot enter Procurement without a customer design approval, and says so', async () => {
  const e = newEngine();
  const g = await gate(e, 'P-003', 'U1');
  assert.equal(g.to, 'Procurement');
  assert.equal(g.ok, false);
  assert.match(g.missing[0], /No design_approval document for Unit 1/);
});

test('adding the design approval opens the Procurement gate, then the unit can move', async () => {
  const e = newEngine();
  e.dispatch('addDocument', { projectId: 'P-003', type: 'design_approval', title: 'Customer approval rev A', by: 'selin.kaya' });
  assert.equal((await gate(e, 'P-003', 'U1')).ok, true);
  e.dispatch('advanceUnit', { projectId: 'P-003', unitId: 'U1', by: 'selin.kaya' });
  assert.equal(unit(e, 'P-003', 'U1').phase, 'Procurement');
});

test('blocked advance throws with the reasons attached', () => {
  const e = newEngine();
  assert.throws(
    () => e.dispatch('advanceUnit', { projectId: 'P-003', unitId: 'U1', by: 'selin.kaya' }),
    (err) => err.status === 409 && err.details.length === 1,
  );
  assert.equal(e.events.length, 0, 'a refused command writes nothing');
});

test('Installation gate names each undelivered major equipment item (P-002)', async () => {
  const e = newEngine();
  const u1 = await gate(e, 'P-002', 'U1');
  assert.equal(u1.ok, false);
  assert.deepEqual(u1.missing, ['Project switchgear LV ATS Panel 2500A (P002-SWG) is still Ordered (expected 2026-11-30)']);
  const u2 = await gate(e, 'P-002', 'U2');
  assert.equal(u2.missing.length, 2);
  assert.ok(u2.missing.some((m) => m.startsWith('Unit 2 engine DX-1000 Diesel Engine (P002-U2-ENG) is still Ordered (expected 2027-01-08)')));
});

test('moving equipment to its next status records the date and unblocks the gate', async () => {
  const e = newEngine();
  e.dispatch('advanceEquipment', { projectId: 'P-002', equipmentId: 'P002-SWG', date: '2026-10-25', by: 'tom.bright' });
  const swg = e.state.projects['P-002'].equipment.find((x) => x.id === 'P002-SWG');
  assert.equal(swg.status, 'Delivered');
  assert.equal(swg.status_dates.Delivered, '2026-10-25');
  assert.equal((await gate(e, 'P-002', 'U1')).ok, true);
  assert.equal((await gate(e, 'P-002', 'U2')).ok, false, 'U2 engine is still Ordered');
});

test('equipment cannot skip a status or go back in time', () => {
  const e = newEngine();
  assert.throws(() => e.dispatch('advanceEquipment', { projectId: 'P-002', equipmentId: 'P002-SWG', date: '2026-01-01', by: 'x' }), /before Ordered date/);
  // P001-SWG is Installed in the seed: one step to Commissioned, then there is nothing after that.
  e.dispatch('advanceEquipment', { projectId: 'P-001', equipmentId: 'P001-SWG', date: '2026-10-21', by: 'x' });
  assert.throws(() => e.dispatch('advanceEquipment', { projectId: 'P-001', equipmentId: 'P001-SWG', by: 'x' }), /last status/);
});

test('Commissioning gate: unfinished Installation tasks are listed (P-002 U1 with delivered kit)', async () => {
  const e = newEngine();
  for (const id of ['P002-SWG']) e.dispatch('advanceEquipment', { projectId: 'P-002', equipmentId: id, date: '2026-10-25', by: 'x' });
  e.dispatch('advanceUnit', { projectId: 'P-002', unitId: 'U1', by: 'tom.bright' }); // Procurement -> Installation
  const g = await gate(e, 'P-002', 'U1');
  assert.equal(g.to, 'Commissioning');
  assert.ok(g.missing.some((m) => m.includes('T-2002') && m.includes('project-wide')));
  assert.ok(g.missing.some((m) => m.includes('T-2101')));
  assert.ok(!g.missing.some((m) => m.includes('T-2201')), "Unit 2's tasks do not block Unit 1");
  assert.ok(g.missing.some((m) => /No mechanical_completion document/.test(m)));
});

test('Handover gate needs a passing load test AND a commissioning_report (P-001 before any test)', async () => {
  const e = newEngine();
  const g = await gate(e, 'P-001', 'U1');
  assert.equal(g.to, 'Handover');
  assert.equal(g.missing.length, 2);
  assert.match(g.missing[0], /no load-test result yet/);
  assert.match(g.missing[1], /No commissioning_report/);
});

test('no phase can be skipped and the last phase has no next gate', async () => {
  const e = newEngine();
  const g = await gate(e, 'P-003', 'U1');
  assert.equal(g.to, 'Procurement'); // never Installation
});
