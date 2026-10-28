// Read models: portfolio, plain-words project summary, valid / invalid report.

import { unitList } from './constants.js';
import { evaluateGate } from './gates.js';
import { docValidFor, latestValidTest, taskStatus } from './state.js';

// R1: these functions turn the state into what the screens show: the portfolio table, the
// plain-words sentence ("Units 1 and 3 ready for Handover; Unit 2 back in Design (NCR-014)."),
// and the valid / invalid report.
export function unitStatus(state, project, unit) {
  const gate = evaluateGate(state, project.id, unit.id);
  const test = latestValidTest(unit);
  return {
    id: unit.id,
    name: unit.name,
    rated_kw: unit.rated_kw,
    phase: unit.phase,
    sentBack: unit.sentBack,
    ready: gate.ok,
    nextPhase: gate.to,
    blockedBy: gate.ok ? [] : gate.missing,
    loadTest: test ? { outcome: test.outcome, reason: test.reason, source: test.source, by: test.by, at: test.at } : null,
  };
}

// "Units 1 and 3 ready for Handover; Unit 2 back in Design (NCR-014)."
export function summaryText(state, project) {
  const statuses = project.units.map((u) => unitStatus(state, project, u));
  const groups = new Map();
  for (const s of statuses) {
    let label;
    if (s.sentBack) label = `back in ${s.phase} (${s.sentBack.ref})`;
    else if (s.ready && s.nextPhase) label = `ready for ${s.nextPhase}`;
    else label = `in ${s.phase}`;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(project.units.find((u) => u.id === s.id));
  }
  if (groups.size === 1) {
    const [[label, units]] = [...groups];
    return units.length === 1 ? `${units[0].name} ${label}.` : `All ${units.length} units ${label}.`;
  }
  return `${[...groups].map(([label, units]) => `${unitList(units)} ${label}`).join('; ')}.`;
}

export function portfolio(state) {
  return Object.values(state.projects).map((p) => {
    const statuses = p.units.map((u) => unitStatus(state, p, u));
    const phases = [...new Set(statuses.map((s) => s.phase))];
    const overdue = p.tasks.filter((t) => taskStatus(t) !== 'done' && t.due && t.due < state.asOf);
    return {
      id: p.id,
      name: p.name,
      customer: p.customer,
      type: p.type,
      projectManager: state.people[p.project_manager]?.name || p.project_manager,
      target_commissioning_date: p.target_commissioning_date,
      phase: phases.length === 1 ? phases[0] : 'Mixed',
      summary: summaryText(state, p),
      units: statuses.length,
      overdueTasks: overdue.map((t) => ({ id: t.id, title: t.title, due: t.due })),
      openIssues: p.units.filter((u) => u.sentBack).map((u) => u.sentBack.ref).filter((r, i, a) => a.indexOf(r) === i),
    };
  });
}

// What is valid and what is not, per item (R4 "what is now invalid and what remains valid").
export function validityReport(state, project) {
  const unitName = (id) => project.units.find((u) => u.id === id)?.name || id;
  const documents = project.documents.map((d) => {
    const applies = d.appliesTo === null ? project.units.map((u) => u.id) : d.appliesTo;
    const validFor = applies.filter((u) => docValidFor(d, u));
    const invalidFor = applies.filter((u) => !docValidFor(d, u));
    return {
      id: d.id, type: d.type, title: d.title,
      scope: d.appliesTo === null ? 'project-wide' : d.appliesTo.map(unitName).join(', '),
      validFor: validFor.map(unitName), invalidFor: invalidFor.map(unitName),
      invalidatedBy: d.invalidFor.map((i) => i.ref),
      valid: invalidFor.length === 0,
    };
  });
  const equipment = project.equipment.map((e) => ({
    id: e.id, type: e.type, model: e.model, unit: e.unit_id ? unitName(e.unit_id) : 'project-wide',
    status: e.status, valid: e.valid, invalidatedBy: e.invalidatedBy, supersededBy: e.supersededBy, replaces: e.replaces,
  }));
  const tasks = project.tasks.map((t) => ({
    id: t.id, title: t.title, phase: t.phase, unit: t.unit_id ? unitName(t.unit_id) : 'project-wide',
    status: taskStatus(t), invalidatedBy: taskStatus(t) === 'done' ? null : t.invalidatedBy,
    valid: taskStatus(t) !== 'redo', mustBeRedone: taskStatus(t) === 'redo',
  }));
  const tests = project.units.map((u) => {
    const latest = u.tests[u.tests.length - 1] || null;
    const valid = latestValidTest(u);
    return {
      unit: u.name, results: u.tests.length,
      valid: !!valid, outcome: valid?.outcome ?? null,
      note: latest && !valid ? `Last result (${latest.outcome}) was invalidated — a re-test is needed` : null,
    };
  });
  return { documents, equipment, tasks, tests };
}

export function projectDetail(state, projectId) {
  const p = state.projects[projectId];
  if (!p) return null;
  return {
    id: p.id, name: p.name, customer: p.customer, site: p.site, type: p.type,
    projectManager: state.people[p.project_manager]?.name || p.project_manager,
    target_commissioning_date: p.target_commissioning_date,
    grid_capacity_confirmed_kw: p.grid_capacity_confirmed_kw,
    asOf: state.asOf,
    summary: summaryText(state, p),
    units: p.units.map((u) => unitStatus(state, p, u)),
    equipment: p.equipment, tasks: p.tasks.map((t) => ({ ...t, status: taskStatus(t) })),
    documents: p.documents,
    issues: state.issues.filter((i) => i.projectId === p.id),
    validity: validityReport(state, p),
  };
}
