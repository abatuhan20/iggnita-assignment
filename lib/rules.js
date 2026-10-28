// "What does a send-back invalidate?" (R4). The person raising the issue can edit the result,
// but by default the application works it out from these rules, so nothing is hard-coded per issue.
//
// Given: which units go back, to which earlier phase, and (optionally) which component failed.
//   Documents : a design_approval is invalid FOR THE AFFECTED UNITS ONLY when the unit goes back
//               to Design or earlier; a site_survey_report when it goes back to Survey; a
//               commissioning_report always (the unit's state changed). Everything else stays.
//   Equipment : valid equipment of the failed component type that belongs to the affected units.
//   Tasks     : DONE Installation tasks of the affected units whose title matches the failed
//               component (COMPONENT_KEYWORDS), when the unit goes back before Installation ends.
//   Tests     : the affected units' load-test results (they described the plant as it was).
// Project-wide items (survey, mechanical completion, switchgear, grid connection) and parts that
// do not depend on the failed component are left valid.

import { COMPONENT_KEYWORDS } from './constants.js';
import { docValidFor, taskStatus } from './state.js';

// Reading guide for the function below, in the order it works:
//   1. equipment  -> the failed component type, only for the units going back
//   2. tasks      -> done Installation tasks whose title mentions that component
//   3. documents  -> design approval (if going back to Design), commissioning report
//   4. tests      -> the units' load-test results
// The result is only a PROPOSAL; the person raising the issue can untick items in the UI.
export function suggestInvalidations(state, projectId, unitIds, targetPhase, component) {
  const project = state.projects[projectId];
  const target = state.phases.indexOf(targetPhase);
  const idx = (p) => state.phases.indexOf(p);

  const equipment = component
    ? project.equipment
        .filter((e) => e.valid && e.type === component && (unitIds.includes(e.unit_id) || (e.unit_id === null && component === 'switchgear')))
        .map((e) => e.id)
    : [];

  const keywords = component ? COMPONENT_KEYWORDS[component] || [component] : [];
  const tasks = component
    ? project.tasks
        .filter(
          (t) =>
            unitIds.includes(t.unit_id) &&
            idx(t.phase) > target &&
            taskStatus(t) === 'done' &&
            keywords.some((k) => t.title.toLowerCase().includes(k)),
        )
        .map((t) => t.id)
    : [];

  const documents = [];
  for (const d of project.documents) {
    const hit = unitIds.filter((u) => docValidFor(d, u));
    if (hit.length === 0) continue;
    const invalidate =
      (d.type === 'design_approval' && target <= idx('Design')) ||
      (d.type === 'site_survey_report' && target <= idx('Survey')) ||
      d.type === 'commissioning_report';
    if (invalidate) documents.push({ id: d.id, unitIds: hit });
  }

  return { equipment, tasks, documents, tests: [...unitIds] };
}
