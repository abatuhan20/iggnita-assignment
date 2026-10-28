import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLoadTest } from '../lib/loadtest.js';
import { sampleCsv } from './helpers.js';

const units = [{ id: 'U1', rated_kw: 2000 }, { id: 'U2', rated_kw: 2000 }, { id: 'U3', rated_kw: 2000 }];
const header = 'timestamp,unit_id,active_power,power_unit,ambient_temp_c,note\n';
const series = (n, kw, { start = 0, unit = 'U1' } = {}) =>
  Array.from({ length: n }, (_, i) => {
    const m = (start + i) * 15;
    return `2026-10-22 ${String(8 + Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')},${unit},${kw},kW,24,`;
  }).join('\n');

test('the 95 % threshold is inclusive: exactly 1900 kW counts', () => {
  const r = evaluateLoadTest(header + series(17, 1900), units);
  assert.equal(r.units.U1.result, 'pass');
});

test('1899 kW is below the line', () => {
  const r = evaluateLoadTest(header + series(17, 1899), units);
  assert.equal(r.units.U1.result, 'fail');
});

test('4 hours means a 4 h span: 16 readings (3h45) fail, 17 readings (4h00) pass', () => {
  assert.equal(evaluateLoadTest(header + series(16, 1950), units).units.U1.result, 'fail');
  assert.equal(evaluateLoadTest(header + series(17, 1950), units).units.U1.result, 'pass');
});

test('a dip below the threshold breaks the run', () => {
  const rows = [series(10, 1950), series(1, 1500, { start: 10 }), series(10, 1950, { start: 11 })].join('\n');
  const r = evaluateLoadTest(header + rows, units);
  assert.equal(r.units.U1.result, 'fail');
  assert.equal(r.units.U1.longestRun.spanMinutes, 135);
});

test('a missing reading breaks the run (strict) but is flagged as a judgement call when bridging would pass', () => {
  const rows = [series(12, 1950), series(12, 1950, { start: 13 })].join('\n'); // reading #12 missing
  const r = evaluateLoadTest(header + rows, units);
  assert.equal(r.units.U1.result, 'fail');
  assert.equal(r.units.U1.wouldPassIfGapsBridged, true);
  assert.ok(r.findings.some((f) => f.code === 'gap'));
  assert.ok(r.findings.some((f) => f.code === 'judgement_call'));
});

test('two missing readings in a row are never bridged', () => {
  const rows = [series(12, 1950), series(12, 1950, { start: 14 })].join('\n');
  const r = evaluateLoadTest(header + rows, units);
  assert.equal(r.units.U1.wouldPassIfGapsBridged, false);
});

test('the real logger file: U1 pass, U2 fail, U3 fail-but-judgement-call', () => {
  const r = evaluateLoadTest(sampleCsv(), units);
  assert.equal(r.units.U1.result, 'pass');
  assert.equal(r.units.U2.result, 'fail');
  assert.equal(r.units.U3.result, 'fail');
  assert.equal(r.units.U3.wouldPassIfGapsBridged, true);
  assert.equal(r.units.U1.wouldPassIfGapsBridged, false);
});

test('the real logger file: every oddity is noticed and reported', () => {
  const codes = evaluateLoadTest(sampleCsv(), units).findings.map((f) => f.code);
  for (const code of ['duplicate_exact', 'converted_mw', 'unit_id_normalised', 'missing_value', 'implausible_value', 'gap', 'logger_note']) {
    assert.ok(codes.includes(code), `expected a "${code}" finding`);
  }
});

test('MW readings are converted, not misread as 2 kW', () => {
  const r = evaluateLoadTest(header + Array.from({ length: 17 }, (_, i) => `2026-10-22 ${String(8 + Math.floor((i * 15) / 60)).padStart(2, '0')}:${String((i * 15) % 60).padStart(2, '0')},U1,1.96,MW,24,`).join('\n'), units);
  assert.equal(r.units.U1.result, 'pass');
});

test('the 99999 sensor fault is excluded, not counted as a great reading and not a crash', () => {
  const r = evaluateLoadTest(sampleCsv(), units);
  assert.equal(r.units.U1.peakKw < 2100, true);
  assert.ok(r.findings.some((f) => f.code === 'implausible_value' && f.unitId === 'U1'));
});

test('conflicting duplicates are excluded, exact duplicates are dropped', () => {
  const csv = header + '2026-10-22 08:00,U1,1950,kW,24,\n2026-10-22 08:00,U1,1700,kW,24,\n2026-10-22 08:15,U2,1950,kW,24,\n2026-10-22 08:15,U2,1950,kW,24,';
  const r = evaluateLoadTest(csv, units);
  assert.ok(r.findings.some((f) => f.code === 'duplicate_conflict'));
  assert.equal(r.units.U1.validReadings, 0);
  assert.equal(r.units.U2.validReadings, 1);
});

test('a unit with no rows is reported as no data, and a file without the key columns is rejected', () => {
  assert.equal(evaluateLoadTest(header + series(2, 1950), units).units.U3.result, 'no_data');
  assert.throws(() => evaluateLoadTest('a,b\n1,2', units), /no "timestamp" column/);
});
