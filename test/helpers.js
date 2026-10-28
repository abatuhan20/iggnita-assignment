import fs from 'node:fs';
import path from 'node:path';
import { Engine } from '../lib/engine.js';

const dir = path.join(process.cwd(), 'data');
export const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
export const seed = () => JSON.parse(read('projects.json'));
export const people = () => JSON.parse(read('people.json'));
export const sampleCsv = () => read('load-test-P-001.csv');

// A fresh in-memory engine (no file written) with a fixed clock so events are deterministic.
export function newEngine() {
  let n = 0;
  return new Engine({ seed: seed(), people: people(), now: () => `2026-10-26T09:${String(n++).padStart(2, '0')}:00Z` });
}

export const gate = async (engine, projectId, unitId) => {
  const { evaluateGate } = await import('../lib/gates.js');
  return evaluateGate(engine.state, projectId, unitId);
};
export const unit = (engine, projectId, unitId) => engine.state.projects[projectId].units.find((u) => u.id === unitId);

// Brings P-001 to the state "right before NCR-014": load test imported, Unit 3 signed off by the engineer.
export function p001AfterImport(engine) {
  engine.dispatch('importLoadTest', { projectId: 'P-001', csvText: sampleCsv(), filename: 'load-test-P-001.csv', by: 'kemal.arslan' });
  engine.dispatch('recordLoadTest', {
    projectId: 'P-001', unitId: 'U3', outcome: 'pass', by: 'kemal.arslan',
    reason: 'Single missing 15-min reading at 10:45 (logger dropout); neighbours at 1940 and 1966 kW, well above 1900 kW.',
  });
}

export const NCR_014 = {
  projectId: 'P-001', ref: 'NCR-014', unitIds: ['U2'], targetPhase: 'Design', component: 'alternator', by: 'selin.kaya',
  description: 'Unit 2 load test failed: alternator ALT-2.1-A undersized for ~31 C ambient at its position.',
  replacements: [{ replaces: 'P001-U2-ALT', model: 'ALT-2.5-B', leadTimeWeeks: 10 }],
};
