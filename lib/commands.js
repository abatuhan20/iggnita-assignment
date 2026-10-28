// Commands validate against the current state and return EVENTS (never mutate anything).
// The engine stamps events with seq / time / author and appends them to the log.

import { createHash } from 'node:crypto';
import { DomainError, EQUIPMENT_STATUSES, addWeeks } from './constants.js';
import { evaluateGate } from './gates.js';
import { evaluateLoadTest } from './loadtest.js';
import { suggestInvalidations } from './rules.js';
import { latestValidTest, nextStatus, taskStatus } from './state.js';

const need = (v, what) => {
  if (v === undefined || v === null || String(v).trim() === '') throw new DomainError(`${what} is required`);
  return typeof v === 'string' ? v.trim() : v;
};

function projectOf(state, id) {
  const p = state.projects[id];
  if (!p) throw new DomainError(`Project ${id} not found`, { status: 404 });
  return p;
}
function unitOf(project, id) {
  const u = project.units.find((x) => x.id === id);
  if (!u) throw new DomainError(`Unit ${id} not found in ${project.id}`, { status: 404 });
  return u;
}
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export const commands = {
  completeTask(state, { projectId, taskId, by }) {
    need(by, 'Who you are ("by")');
    const project = projectOf(state, projectId);
    const task = project.tasks.find((t) => t.id === taskId);
    if (!task) throw new DomainError(`Task ${taskId} not found`, { status: 404 });
    if (taskStatus(task) === 'done') throw new DomainError(`Task ${taskId} is already done`, { status: 409 });
    return [{ type: 'task.completed', projectId, taskId }];
  },

  addDocument(state, { projectId, type, title, appliesTo = null, date, by, id }) {
    need(by, 'Who you are ("by")');
    const project = projectOf(state, projectId);
    type = need(type, 'Document type');
    title = need(title, 'Document title');
    if (appliesTo !== null) {
      if (!Array.isArray(appliesTo) || appliesTo.length === 0) appliesTo = null; // empty = project-wide
      else appliesTo.forEach((u) => unitOf(project, u));
    }
    date = date || state.asOf;
    if (!isDate(date)) throw new DomainError('Document date must be YYYY-MM-DD');
    if (!id) {
      const nums = project.documents.map((d) => Number(d.id.replace(/\D/g, ''))).filter(Number.isFinite);
      id = `D-${Math.max(...nums, 0) + 1}`;
    }
    if (project.documents.some((d) => d.id === id)) throw new DomainError(`Document ${id} already exists`, { status: 409 });
    return [{ type: 'document.added', projectId, doc: { id, type, title, date, by, appliesTo } }];
  },

  advanceEquipment(state, { projectId, equipmentId, date, by }) {
    need(by, 'Who you are ("by")');
    const project = projectOf(state, projectId);
    const eq = project.equipment.find((e) => e.id === equipmentId);
    if (!eq) throw new DomainError(`Equipment ${equipmentId} not found`, { status: 404 });
    if (!eq.valid) throw new DomainError(`${equipmentId} was invalidated by ${eq.invalidatedBy} and cannot move on`, { status: 409 });
    const to = nextStatus(eq.status);
    if (!to) throw new DomainError(`${equipmentId} is already ${eq.status}, the last status`, { status: 409 });
    date = date || state.asOf;
    if (!isDate(date)) throw new DomainError('Date must be YYYY-MM-DD');
    const prevDate = eq.status_dates[eq.status];
    if (prevDate && date < prevDate) throw new DomainError(`${to} date ${date} is before ${eq.status} date ${prevDate}`);
    return [{ type: 'equipment.advanced', projectId, equipmentId, from: eq.status, to, date }];
  },

  // Move ONE unit to its next phase, but only if its gate is open (R2). If not, the error
  // carries the list of reasons ("Unit 2 engine is still Ordered") and the UI shows it.
  // Partial handover (R1/R2) = call this for Unit 1 and Unit 3 only; Unit 2 is not touched.
  advanceUnit(state, { projectId, unitId, by }) {
    need(by, 'Who you are ("by")');
    const project = projectOf(state, projectId);
    const unit = unitOf(project, unitId);
    const gate = evaluateGate(state, projectId, unitId);
    if (!gate.ok) {
      throw new DomainError(`${unit.name} cannot enter ${gate.to ?? 'a next phase'} yet`, { status: 409, details: gate.missing });
    }
    return [{ type: 'unit.advanced', projectId, unitId, from: gate.from, to: gate.to }];
  },

  // Manual result by a commissioning engineer, also used for the re-test and for sign-offs.
  recordLoadTest(state, { projectId, unitId, outcome, reason, by, source = 'manual' }) {
    need(by, 'Who you are ("by")');
    const project = projectOf(state, projectId);
    unitOf(project, unitId);
    if (!['pass', 'fail'].includes(outcome)) throw new DomainError('Outcome must be "pass" or "fail"');
    reason = need(reason, 'A short reason');
    return [{ type: 'loadtest.recorded', projectId, unitId, outcome, reason, source }];
  },

  // Evaluates the file and records one result per unit found in it.
  importLoadTest(state, { projectId, csvText, filename = 'upload.csv', by }) {
    need(by, 'Who you are ("by")');
    const project = projectOf(state, projectId);
    const evaluation = evaluateLoadTest(need(csvText, 'The CSV file'), project.units);
    const sha = createHash('sha256').update(csvText).digest('hex').slice(0, 12);
    const events = [];
    for (const res of Object.values(evaluation.units)) {
      if (res.result === 'no_data') continue;
      const own = evaluation.findings.filter((f) => f.unitId === res.unitId && f.severity !== 'info');
      events.push({
        type: 'loadtest.recorded',
        projectId,
        unitId: res.unitId,
        outcome: res.result,
        source: 'import',
        reason: `${res.reasons.map((r) => r.replace(/\.$/, '')).join('. ')}.`,
        file: { name: filename, sha256: sha },
        evaluation: { ...res, findings: own.map((f) => f.message) },
      });
    }
    if (events.length === 0) throw new DomainError('The file contains no usable readings for this project');
    return events;
  },

  suggestInvalidations(state, { projectId, unitIds, targetPhase, component }) {
    projectOf(state, projectId);
    return suggestInvalidations(state, projectId, unitIds, targetPhase, component || null);
  },

  // R4. Raise an issue and send units back. Steps:
  //   1. basic checks: author, reference unique, description, at least one unit
  //   2. every unit must currently be in a phase AFTER the target phase (you can only go back)
  //   3. what becomes invalid: either what the person picked, or our rules (rules.js)
  //   4. replacement orders (new equipment record, expected date = today + lead time)
  //   5. return ONE event; state.js applies it. Nothing existing is edited.
  raiseIssue(state, input) {
    const { projectId, description, unitIds, targetPhase, component, by } = input;
    need(by, 'Who you are ("by")');
    const project = projectOf(state, projectId);
    const ref = need(input.ref, 'Issue reference (e.g. NCR-014)');
    if (state.issues.some((i) => i.ref.toLowerCase() === ref.toLowerCase())) throw new DomainError(`Issue ${ref} already exists`, { status: 409 });
    need(description, 'A short description');
    if (!Array.isArray(unitIds) || unitIds.length === 0) throw new DomainError('Pick at least one unit the issue is raised against');
    const units = unitIds.map((u) => unitOf(project, u));
    const targetIdx = state.phases.indexOf(targetPhase);
    if (targetIdx === -1) throw new DomainError(`Unknown phase "${targetPhase}"`);
    for (const u of units) {
      if (targetIdx >= state.phases.indexOf(u.phase)) {
        throw new DomainError(`${u.name} is in ${u.phase}; an issue can only send it back to an EARLIER phase, not ${targetPhase}`);
      }
    }

    const inv = input.invalidations || suggestInvalidations(state, projectId, unitIds, targetPhase, component || null);
    const invalidations = {
      equipment: inv.equipment || [],
      tasks: inv.tasks || [],
      documents: inv.documents || [],
      tests: inv.tests || unitIds,
    };
    invalidations.equipment.forEach((id) => {
      const e = project.equipment.find((x) => x.id === id);
      if (!e) throw new DomainError(`Equipment ${id} not found`, { status: 404 });
      if (!e.valid) throw new DomainError(`Equipment ${id} is already invalid`);
    });
    invalidations.tasks.forEach((id) => {
      if (!project.tasks.some((t) => t.id === id)) throw new DomainError(`Task ${id} not found`, { status: 404 });
    });
    invalidations.documents.forEach((d) => {
      if (!project.documents.some((x) => x.id === d.id)) throw new DomainError(`Document ${d.id} not found`, { status: 404 });
    });

    // Replacement orders (e.g. ALT-2.1-A -> ALT-2.5-B, 10 weeks). Recorded as NEW equipment.
    const replacementRecords = [];
    for (const r of input.replacements || []) {
      if (!invalidations.equipment.includes(r.replaces)) throw new DomainError(`${r.replaces} is not being invalidated, so it cannot be replaced`);
      const old = project.equipment.find((e) => e.id === r.replaces);
      const weeks = Number(r.leadTimeWeeks);
      if (!Number.isFinite(weeks) || weeks <= 0) throw new DomainError('Replacement lead time must be a positive number of weeks');
      replacementRecords.push({
        id: `${old.id}-R${project.equipment.filter((e) => e.replaces === old.id || e.id.startsWith(`${old.id}-R`)).length + 1}`,
        replaces: old.id,
        unit_id: old.unit_id,
        type: old.type,
        model: need(r.model, 'Replacement model'),
        serial: null,
        status: 'Ordered',
        status_dates: { Ordered: state.asOf },
        expected_delivery: addWeeks(state.asOf, weeks),
        lead_time_weeks: weeks,
        notes: `Replaces ${old.model} (${old.id}) after ${ref}`,
      });
    }

    return [
      {
        type: 'issue.raised',
        projectId,
        ref,
        description: description.trim(),
        unitIds,
        targetPhase,
        component: component || null,
        unitFrom: Object.fromEntries(units.map((u) => [u.id, u.phase])),
        invalidations,
        replacementRecords,
      },
    ];
  },
};

export { EQUIPMENT_STATUSES, latestValidTest };
