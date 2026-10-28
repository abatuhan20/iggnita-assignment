// R5: who did what and when, read straight from the append-only log (plus the dated facts
// that came with the seed data). Nothing is edited; "going back" is just another entry.

const who = (state, id) => state.people[id]?.name || id || 'unknown';

function seedEntries(state) {
  const out = [];
  for (const p of Object.values(state.projects)) {
    for (const d of p.documents) {
      if (d.fromSeed) {
        out.push({ source: 'seed', when: d.date, projectId: p.id, unitIds: d.appliesTo, by: who(state, d.by), text: `Document ${d.id} (${d.type}) on file: ${d.title}` });
      }
    }
    for (const e of p.equipment) {
      if (e.replaces) continue;
      for (const [status, date] of Object.entries(e.seedDates || {})) {
        out.push({ source: 'seed', when: date, projectId: p.id, unitIds: e.unit_id ? [e.unit_id] : null, by: null, text: `${e.type} ${e.model} (${e.id}) ${status}` });
      }
    }
    for (const u of p.units) {
      out.push({
        source: 'seed', when: state.asOf, projectId: p.id, unitIds: [u.id], by: null,
        text: `Baseline: ${u.name} was in the system at the start (${state.asOf}) in the phase it had reached by then; earlier phase dates are not part of the seed data`,
      });
    }
  }
  return out;
}

function describe(state, e) {
  const p = state.projects[e.projectId];
  const unit = (id) => p.units.find((u) => u.id === id)?.name || id;
  const units = (ids) => ids.map(unit).join(', ');
  switch (e.type) {
    case 'task.completed': {
      const t = p.tasks.find((x) => x.id === e.taskId);
      return `Task ${t.id} "${t.title}" completed`;
    }
    case 'document.added':
      return `Document ${e.doc.id} (${e.doc.type}) added: ${e.doc.title}${e.doc.appliesTo ? ` — for ${units(e.doc.appliesTo)}` : ' — project-wide'}`;
    case 'equipment.advanced': {
      const eq = p.equipment.find((x) => x.id === e.equipmentId);
      return `${eq.type} ${eq.model} (${eq.id}): ${e.from} → ${e.to} on ${e.date}`;
    }
    case 'loadtest.recorded':
      return `Load test ${e.unitId && unit(e.unitId)}: ${e.outcome.toUpperCase()} (${e.source === 'import' ? `imported from ${e.file.name}` : 'recorded by hand'}) — ${e.reason}`;
    case 'unit.advanced':
      return `${unit(e.unitId)} moved ${e.from} → ${e.to}`;
    case 'issue.raised': {
      const inv = e.invalidations;
      const parts = [];
      if (inv.documents.length) parts.push(`documents ${inv.documents.map((d) => `${d.id} (for ${units(d.unitIds)})`).join(', ')}`);
      if (inv.equipment.length) parts.push(`equipment ${inv.equipment.join(', ')}`);
      if (inv.tasks.length) parts.push(`tasks ${inv.tasks.join(', ')}`);
      if (inv.tests.length) parts.push(`load-test results of ${units(inv.tests)}`);
      const repl = e.replacementRecords.map((r) => `${r.model} ordered as ${r.id}, expected ${r.expected_delivery}`);
      return `Issue ${e.ref} raised against ${units(e.unitIds)}: sent back ${Object.values(e.unitFrom).filter((v, i, a) => a.indexOf(v) === i).join('/')} → ${e.targetPhase}. "${e.description}". Invalidated: ${parts.join('; ') || 'nothing'}.${repl.length ? ` Replacement: ${repl.join('; ')}.` : ''}`;
    }
    default:
      return e.type;
  }
}

function eventUnitIds(state, e) {
  const p = state.projects[e.projectId];
  switch (e.type) {
    case 'task.completed': return [p.tasks.find((t) => t.id === e.taskId).unit_id].filter(Boolean);
    case 'document.added': return e.doc.appliesTo;
    case 'equipment.advanced': return [p.equipment.find((x) => x.id === e.equipmentId).unit_id].filter(Boolean);
    case 'loadtest.recorded':
    case 'unit.advanced': return [e.unitId];
    case 'issue.raised': return e.unitIds;
    default: return null;
  }
}

// R5: the history is NOT a separate table we maintain. It is the event log itself, written out in
// words (describe), plus dated facts from the seed. Filter by unit to read "the story of Unit 2".
export function buildHistory(state, events, { projectId, unitId } = {}) {
  const entries = [...seedEntries(state), ...events.map((e) => {
    const ids = eventUnitIds(state, e);
    return { source: 'event', seq: e.seq, when: e.at, projectId: e.projectId, unitIds: ids && ids.length ? ids : null, by: who(state, e.by), type: e.type, text: describe(state, e) };
  })];
  const keep = (h) => (!projectId || h.projectId === projectId) && (!unitId || h.unitIds === null || h.unitIds.includes(unitId));
  const seeded = entries.filter((h) => h.source === 'seed' && keep(h)).sort((a, b) => a.when.localeCompare(b.when));
  const logged = entries.filter((h) => h.source === 'event' && keep(h)).sort((a, b) => a.seq - b.seq);
  return [...seeded, ...logged];
}
