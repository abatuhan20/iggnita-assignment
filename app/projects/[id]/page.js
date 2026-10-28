import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEngine } from '../../../lib/store.js';
import { projectDetail } from '../../../lib/summary.js';
import { ActionButton, AddDocumentForm, LoadTestPanel, RaiseIssueForm } from '../../Controls.js';

export const dynamic = 'force-dynamic';

const Valid = ({ ok, children }) => <span className={ok ? '' : 'invalid'}>{children}</span>;

export default async function ProjectPage({ params, searchParams }) {
  const { id } = await params;
  const { unit: unitFilter } = await searchParams;
  const engine = getEngine();
  const p = projectDetail(engine.state, id);
  if (!p) notFound();
  const history = engine.history({ projectId: id, unitId: unitFilter || undefined });
  const phases = engine.state.phases;
  const labels = {
    equipment: Object.fromEntries(p.equipment.map((e) => [e.id, `${e.model} (${e.id}, ${e.unit_id || 'project-wide'})`])),
    tasks: Object.fromEntries(p.tasks.map((t) => [t.id, `${t.id} ${t.title} (${t.unit_id || 'project-wide'})`])),
    documents: Object.fromEntries(p.documents.map((d) => [d.id, `${d.id} ${d.type}`])),
  };
  const unitName = (uid) => p.units.find((u) => u.id === uid)?.name || 'project-wide';
  const people = engine.state.people;
  const who = (uid) => people[uid]?.name || uid;

  return (
    <>
      <p><Link href="/">← Portfolio</Link></p>
      <h1>{p.id} · {p.name}</h1>
      <div className="muted">{p.customer} · {p.site} · {p.type} · PM {p.projectManager} · target commissioning {p.target_commissioning_date} · grid capacity confirmed: {p.grid_capacity_confirmed_kw} kW</div>
      <p className="lead">{p.summary}</p>
      {p.issues.map((i) => (
        <div key={i.ref} className="card"><span className="badge back">{i.ref}</span> raised by {who(i.by)} on {i.at.slice(0, 16).replace('T', ' ')} against {i.unitIds.map(unitName).join(', ')} → back to {i.targetPhase}: {i.description}</div>
      ))}

      <h2>Units and phase gates</h2>
      <table>
        <thead><tr><th>Unit</th><th>Phase</th><th>Load test</th><th>Next phase</th></tr></thead>
        <tbody>
          {p.units.map((u) => (
            <tr key={u.id}>
              <td><b>{u.name}</b><div className="muted">{u.rated_kw} kW</div><Link href={`/projects/${id}?unit=${u.id}#history`}>history</Link></td>
              <td>{u.phase} {u.sentBack && <span className="badge back">back · {u.sentBack.ref} (from {u.sentBack.fromPhase})</span>}</td>
              <td>{u.loadTest ? <><span className={`badge ${u.loadTest.outcome === 'pass' ? 'ok' : 'bad'}`}>{u.loadTest.outcome.toUpperCase()}</span> <span className="muted">{u.loadTest.source}, {who(u.loadTest.by)}</span></> : <span className="muted">no valid result</span>}</td>
              <td>
                {!u.nextPhase && <span className="muted">last phase</span>}
                {u.nextPhase && u.ready && <><span className="badge ok">gate to {u.nextPhase} met</span> <ActionButton projectId={id} action="advanceUnit" payload={{ unitId: u.id }} label={`Move to ${u.nextPhase}`} /></>}
                {u.nextPhase && !u.ready && (
                  <>
                    <b>Blocked from entering {u.nextPhase}:</b>
                    <ul>{u.blockedBy.map((m) => <li key={m}>{m}</li>)}</ul>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Equipment</h2>
      <table>
        <thead><tr><th>Id</th><th>Unit</th><th>Item</th><th>Status</th><th>Dates</th><th></th></tr></thead>
        <tbody>
          {p.equipment.map((e) => (
            <tr key={e.id}>
              <td><Valid ok={e.valid}>{e.id}</Valid></td>
              <td>{unitName(e.unit_id)}</td>
              <td><Valid ok={e.valid}>{e.type} · {e.model}</Valid>{e.notes && <div className="muted">{e.notes}</div>}</td>
              <td>{e.valid ? e.status : <span className="badge bad">invalid · {e.invalidatedBy}</span>}{e.supersededBy && <div className="muted">replaced by {e.supersededBy}</div>}</td>
              <td>{Object.entries(e.status_dates).map(([s, d]) => <div key={s}>{s}: {d}</div>)}{e.expected_delivery && e.status === 'Ordered' && <div className="muted">expected {e.expected_delivery}</div>}</td>
              <td>{e.valid && e.status !== 'Commissioned' && <ActionButton projectId={id} action="advanceEquipment" payload={{ equipmentId: e.id }} label="Next status" />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Tasks</h2>
      <table>
        <thead><tr><th>Id</th><th>Phase</th><th>Unit</th><th>Task</th><th>Assignee</th><th>Due</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {p.tasks.map((t) => (
            <tr key={t.id}>
              <td>{t.id}</td><td>{t.phase}</td><td>{unitName(t.unit_id)}</td><td>{t.title}</td><td>{who(t.assignee)}</td><td>{t.due || '—'}</td>
              <td>{t.status === 'redo' ? <span className="badge bad">must be redone · {t.invalidatedBy}</span> : <span className={`badge ${t.status === 'done' ? 'ok' : ''}`}>{t.status}</span>}</td>
              <td>{t.status !== 'done' && <ActionButton projectId={id} action="completeTask" payload={{ taskId: t.id }} label="Complete" />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Documents</h2>
      <table>
        <thead><tr><th>Id</th><th>Type</th><th>Title</th><th>Date · by</th><th>Valid for</th></tr></thead>
        <tbody>
          {p.validity.documents.map((d) => (
            <tr key={d.id}>
              <td>{d.id}</td><td>{d.type}</td><td>{d.title}</td>
              <td>{p.documents.find((x) => x.id === d.id).date} · {who(p.documents.find((x) => x.id === d.id).by)}</td>
              <td>
                {d.validFor.length > 0 && <div>✓ {d.validFor.join(', ')}{d.scope === 'project-wide' ? ' (project-wide)' : ''}</div>}
                {d.invalidFor.length > 0 && <div className="err">✗ {d.invalidFor.join(', ')} — invalidated by {d.invalidatedBy.join(', ')}, new one needed</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <AddDocumentForm projectId={id} units={p.units.map((u) => ({ id: u.id, name: u.name }))} />

      <h2>Load tests</h2>
      <LoadTestPanel projectId={id} units={p.units.map((u) => ({ id: u.id, name: u.name }))} />

      <h2>What is valid, what is not</h2>
      <p className="muted">Invalidated items stay in the history; they simply no longer count for the gates.</p>
      <table>
        <tbody>
          {p.validity.tests.map((t) => <tr key={t.unit}><td>Load test {t.unit}</td><td>{t.valid ? <span className="badge ok">valid · {t.outcome}</span> : <span className="badge bad">{t.results ? 'invalid' : 'none yet'}</span>} {t.note}</td></tr>)}
          {p.validity.equipment.filter((e) => !e.valid).map((e) => <tr key={e.id}><td>Equipment {e.id}</td><td><span className="badge bad">invalid · {e.invalidatedBy}</span> {e.model} → replaced by {e.supersededBy}</td></tr>)}
          {p.validity.tasks.filter((t) => t.mustBeRedone).map((t) => <tr key={t.id}><td>Task {t.id}</td><td><span className="badge bad">must be redone · {t.invalidatedBy}</span> {t.title} ({t.unit})</td></tr>)}
          {p.validity.documents.filter((d) => d.invalidFor.length).map((d) => <tr key={d.id}><td>Document {d.id}</td><td><span className="badge bad">invalid for {d.invalidFor.join(', ')}</span> still valid for {d.validFor.join(', ') || 'nobody'}</td></tr>)}
          <tr><td>Everything else</td><td><span className="badge ok">still valid</span> {p.validity.tasks.filter((t) => t.status === 'done').length} done task(s), {p.validity.equipment.filter((e) => e.valid).length} equipment item(s), {p.validity.documents.filter((d) => d.valid).length} document(s) fully valid</td></tr>
        </tbody>
      </table>

      <h2>Issues</h2>
      <RaiseIssueForm projectId={id} units={p.units.map((u) => ({ id: u.id, name: u.name, phase: u.phase }))} phases={phases} labels={labels} />

      <h2 id="history">History {unitFilter ? `of ${unitName(unitFilter)}` : 'of the project'}</h2>
      <p>
        {unitFilter ? <Link href={`/projects/${id}#history`}>show whole project</Link> : <span className="muted">filter: </span>}
        {p.units.map((u) => <span key={u.id}> <Link href={`/projects/${id}?unit=${u.id}#history`}>{u.name}</Link></span>)}
      </p>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
        <tbody>
          {history.map((h, i) => (
            <tr key={i}>
              <td>{h.source === 'seed' ? h.when : h.when.slice(0, 16).replace('T', ' ')}</td>
              <td>{h.by || <span className="muted">(seed data)</span>}</td>
              <td>{h.text}{h.source === 'event' && h.seq && <span className="muted"> · #{h.seq}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
