// Phase gates (R2). One function, used for EVERY unit of EVERY project: there is no special path
// for a unit that was sent back. Returns plain-words reasons for whatever is missing.

import { EQUIPMENT_STATUSES, MAJOR_EQUIPMENT } from './constants.js';
import { docValidFor, latestValidTest, taskStatus } from './state.js';

const statusIdx = (s) => EQUIPMENT_STATUSES.indexOf(s);

function validDoc(project, type, unit) {
  return project.documents.find((d) => d.type === type && docValidFor(d, unit.id));
}

// Why a document of this type does not count for this unit (never existed vs. invalidated).
function missingDoc(project, type, unit) {
  const stale = project.documents.filter((d) => d.type === type && (d.appliesTo === null || d.appliesTo.includes(unit.id)));
  const invalidated = stale.find((d) => d.invalidFor.some((i) => i.unitIds.includes(unit.id)));
  if (invalidated) {
    const ref = invalidated.invalidFor.find((i) => i.unitIds.includes(unit.id)).ref;
    return `No valid ${type} for ${unit.name}: ${invalidated.id} was invalidated by ${ref}, a new one is needed`;
  }
  return `No ${type} document for ${unit.name}`;
}

// R2. "Can THIS UNIT move into the next phase?" Answer = { ok, missing: [plain-words reasons] }.
// The switch below is the five gate rules of the brief, one case per phase being ENTERED.
// Only VALID things count (a document/equipment/task invalidated by an issue is ignored), which is
// why a unit that was sent back needs exactly the new things and nothing special-cased.
export function evaluateGate(state, projectId, unitId) {
  const project = state.projects[projectId];
  const unit = project.units.find((u) => u.id === unitId);
  const idx = state.phases.indexOf(unit.phase);
  const to = state.phases[idx + 1] || null;
  const result = { projectId, unitId, from: unit.phase, to, ok: false, missing: [] };
  if (!to) {
    result.missing.push(`${unit.name} is already in the last phase (${unit.phase})`);
    return result;
  }
  const missing = result.missing;

  switch (to) {
    case 'Design':
      if (!validDoc(project, 'site_survey_report', unit)) missing.push(missingDoc(project, 'site_survey_report', unit));
      if (project.grid_capacity_confirmed_kw == null)
        missing.push('Grid connection capacity is not confirmed (grid_capacity_confirmed_kw is not set)');
      break;

    case 'Procurement':
      if (!validDoc(project, 'design_approval', unit)) missing.push(missingDoc(project, 'design_approval', unit));
      break;

    case 'Installation':
      for (const type of MAJOR_EQUIPMENT) {
        const items = project.equipment.filter(
          (e) => e.type === type && e.valid && (e.unit_id === unit.id || e.unit_id === null),
        );
        if (items.length === 0) {
          missing.push(`${unit.name} has no ${type} registered`);
          continue;
        }
        for (const e of items) {
          if (statusIdx(e.status) < statusIdx('Delivered')) {
            const label = e.unit_id ? `${unit.name} ${type}` : `Project ${type}`;
            const eta = e.expected_delivery ? ` (expected ${e.expected_delivery})` : '';
            missing.push(`${label} ${e.model} (${e.id}) is still ${e.status}${eta}`);
          }
        }
      }
      break;

    case 'Commissioning': {
      const tasks = project.tasks.filter(
        (t) => t.phase === 'Installation' && (t.unit_id === null || t.unit_id === unit.id),
      );
      for (const t of tasks) {
        const st = taskStatus(t);
        if (st === 'done') continue;
        const where = t.unit_id ? unit.name : 'project-wide';
        const why = st === 'redo' ? ` — must be redone after ${t.invalidatedBy}` : '';
        missing.push(`Installation task ${t.id} "${t.title}" (${where}) is not done${why}`);
      }
      if (!validDoc(project, 'mechanical_completion', unit))
        missing.push(missingDoc(project, 'mechanical_completion', unit));
      break;
    }

    case 'Handover': {
      const test = latestValidTest(unit);
      if (!test) {
        const had = unit.tests.length > 0;
        missing.push(
          had
            ? `${unit.name} has no valid load-test result (earlier results were invalidated, a re-test is needed)`
            : `${unit.name} has no load-test result yet`,
        );
      } else if (test.outcome !== 'pass') {
        missing.push(`${unit.name} has not passed its load test (latest result: fail — ${test.reason || 'no reason given'})`);
      }
      if (!validDoc(project, 'commissioning_report', unit))
        missing.push(missingDoc(project, 'commissioning_report', unit));
      break;
    }
    default:
      missing.push(`No gate defined for ${to}`);
  }

  result.ok = missing.length === 0;
  return result;
}
