// Event-sourced state: the append-only event log is the only thing that is ever written.
// buildState() folds seed + events into the current picture. Nothing here mutates the past.

import { EQUIPMENT_STATUSES } from './constants.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

function initProject(p) {
  const project = clone(p);
  project.units = p.units.map((u) => ({
    ...clone(u),
    phase: p.current_phase, // phase lives on the UNIT, so units can be in different phases
    sentBack: null, // { ref, fromPhase, toPhase } while a unit is "back"
    tests: [], // every load-test result ever recorded for this unit
    testInvalidatedSeq: -1,
  }));
  project.equipment = p.equipment.map((e) => ({
    ...clone(e),
    valid: true,
    invalidatedBy: null,
    supersededBy: null,
    replaces: null,
    seedDates: clone(e.status_dates || {}), // what the seed said; later moves are events
  }));
  project.tasks = p.tasks.map((t) => ({
    ...clone(t),
    completedSeq: t.status === 'done' ? 0 : null,
    invalidatedSeq: null,
    invalidatedBy: null,
  }));
  project.documents = p.documents.map((d) => ({
    id: d.id,
    type: d.type,
    title: d.title,
    date: d.date,
    by: d.by,
    appliesTo: d.unit_id ? [d.unit_id] : null, // null = project-wide
    invalidFor: [], // [{ unitIds, ref, seq }]
    fromSeed: true,
  }));
  return project;
}

export function taskStatus(task) {
  const done = task.completedSeq !== null && (task.invalidatedSeq === null || task.completedSeq > task.invalidatedSeq);
  if (done) return 'done';
  return task.invalidatedSeq !== null ? 'redo' : 'todo';
}

export function docAppliesTo(doc, unitId) {
  return doc.appliesTo === null || doc.appliesTo.includes(unitId);
}
export function docValidFor(doc, unitId) {
  return docAppliesTo(doc, unitId) && !doc.invalidFor.some((i) => i.unitIds.includes(unitId));
}
export function testValid(unit, test) {
  return test.seq > unit.testInvalidatedSeq;
}
export function latestValidTest(unit) {
  const valid = unit.tests.filter((t) => testValid(unit, t));
  return valid.length ? valid[valid.length - 1] : null;
}

// HOW THE STATE IS BUILT (this is the heart of the design):
//   state = seed data (projects.json)  +  every event in the log, applied in order.
// We never store "the current state" anywhere. We only store what HAPPENED (events), and compute
// the current picture from them each time. So "going back" cannot overwrite the past: the past
// is the list of events, and going back is one more event at the end of the list (R4 + R5).
export function buildState(seed, events = [], people = []) {
  const state = {
    asOf: seed.as_of,
    phases: seed.phases,
    typicalDays: seed.typical_phase_duration_days,
    people: Object.fromEntries(people.map((p) => [p.id, p])),
    projects: {},
    issues: [],
    lastSeq: 0,
  };
  for (const p of seed.projects) state.projects[p.id] = initProject(p);
  for (const e of events) {
    applyEvent(state, e);
    state.lastSeq = e.seq;
  }
  return state;
}

const find = (arr, id) => arr.find((x) => x.id === id);

function applyEvent(state, e) {
  const project = state.projects[e.projectId];
  switch (e.type) {
    case 'task.completed': {
      const t = find(project.tasks, e.taskId);
      t.completedSeq = e.seq;
      t.status = taskStatus(t);
      break;
    }
    case 'document.added':
      project.documents.push({ ...e.doc, invalidFor: [] });
      break;
    case 'equipment.advanced': {
      const eq = find(project.equipment, e.equipmentId);
      eq.status = e.to;
      eq.status_dates = { ...eq.status_dates, [e.to]: e.date };
      break;
    }
    case 'loadtest.recorded': {
      const unit = find(project.units, e.unitId);
      unit.tests.push({
        seq: e.seq,
        at: e.at,
        by: e.by,
        outcome: e.outcome,
        source: e.source,
        reason: e.reason,
        evaluation: e.evaluation || null,
        file: e.file || null,
      });
      break;
    }
    case 'unit.advanced': {
      const unit = find(project.units, e.unitId);
      unit.phase = e.to;
      if (unit.sentBack && state.phases.indexOf(e.to) >= state.phases.indexOf(unit.sentBack.fromPhase)) {
        unit.sentBack = null; // the unit is back where it was when the issue was raised
      }
      break;
    }
    case 'issue.raised': {
      // A send-back (e.g. NCR-014). It is ONE event, and applying it does these things:
      //  a) the listed UNITS (only those!) get the earlier phase  -> others are untouched
      //  b) invalid equipment is flagged (not deleted) and the replacement is added as a NEW record
      //  c) invalid tasks get "invalidatedSeq", which makes them "must be redone"
      //  d) documents get an "invalid for these units" note (so D-102 stays valid for U1 and U3)
      //  e) the units' load-test results are marked invalid (they stay in unit.tests as history)
      state.issues.push(e);
      for (const unitId of e.unitIds) {
        const unit = find(project.units, unitId);
        unit.sentBack = { ref: e.ref, fromPhase: e.unitFrom[unitId], toPhase: e.targetPhase };
        unit.phase = e.targetPhase;
      }
      const inv = e.invalidations;
      for (const id of inv.equipment) {
        const eq = find(project.equipment, id);
        eq.valid = false;
        eq.invalidatedBy = e.ref;
      }
      for (const rec of e.replacementRecords) {
        const old = find(project.equipment, rec.replaces);
        old.supersededBy = rec.id;
        project.equipment.push({ ...rec, valid: true, invalidatedBy: null, supersededBy: null });
      }
      for (const id of inv.tasks) {
        const t = find(project.tasks, id);
        t.invalidatedSeq = e.seq;
        t.invalidatedBy = e.ref;
        t.status = taskStatus(t);
      }
      for (const d of inv.documents) {
        find(project.documents, d.id).invalidFor.push({ unitIds: d.unitIds, ref: e.ref, seq: e.seq });
      }
      for (const unitId of inv.tests) {
        find(project.units, unitId).testInvalidatedSeq = e.seq;
      }
      break;
    }
    default:
      throw new Error(`Unknown event type: ${e.type}`);
  }
}

export const nextStatus = (status) => EQUIPMENT_STATUSES[EQUIPMENT_STATUSES.indexOf(status) + 1] || null;
export const getProject = (state, id) => state.projects[id] || null;
export const getUnit = (project, id) => project.units.find((u) => u.id === id) || null;
