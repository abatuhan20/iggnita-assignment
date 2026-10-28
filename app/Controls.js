'use client';
// Every write goes through POST /api/projects/:id/actions; the server enforces all rules.
// The UI only shows the reasons it gets back.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const KEY = 'iggnita.user';

function useUser() {
  const [user, setUser] = useState('');
  useEffect(() => {
    const read = () => setUser(localStorage.getItem(KEY) || '');
    read();
    window.addEventListener('iggnita-user', read);
    return () => window.removeEventListener('iggnita-user', read);
  }, []);
  return user;
}

export function WhoAmI({ people }) {
  const user = useUser();
  const [typed, setTyped] = useState('');
  const set = (v) => { localStorage.setItem(KEY, v); window.dispatchEvent(new Event('iggnita-user')); };
  const known = people.some((p) => p.id === user);
  return (
    <span className="who">
      I am:{' '}
      <select value={known ? user : ''} onChange={(e) => set(e.target.value)}>
        <option value="">— pick —</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.role})</option>)}
      </select>{' '}
      or{' '}
      <input placeholder="type a name" value={typed} size={12} onChange={(e) => setTyped(e.target.value)} onBlur={() => typed.trim() && set(typed.trim())} />
    </span>
  );
}

function useAction(projectId) {
  const router = useRouter();
  const user = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run(action, payload = {}, { refresh = true } = {}) {
    setError(null);
    if (!user && action !== 'previewLoadTest' && action !== 'suggestInvalidations') {
      setError({ message: 'Pick who you are (top right) first.', details: [] });
      return null;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, by: user, ...payload }),
      });
      const body = await res.json();
      if (!res.ok) { setError({ message: body.error, details: body.details || [] }); return null; }
      if (refresh) router.refresh();
      return body;
    } catch (e) {
      setError({ message: String(e), details: [] });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}

const ErrorBox = ({ error }) =>
  error ? (
    <div className="err">
      {error.message}
      {error.details.length > 0 && <ul>{error.details.map((d) => <li key={d}>{d}</li>)}</ul>}
    </div>
  ) : null;

export function ActionButton({ projectId, action, payload, label, disabled }) {
  const { run, busy, error } = useAction(projectId);
  return (
    <>
      <button disabled={disabled || busy} onClick={() => run(action, payload)}>{label}</button>
      <ErrorBox error={error} />
    </>
  );
}

export function AddDocumentForm({ projectId, units }) {
  const { run, busy, error } = useAction(projectId);
  const [type, setType] = useState('commissioning_report');
  const [title, setTitle] = useState('');
  const [appliesTo, setAppliesTo] = useState([]);
  const toggle = (id) => setAppliesTo((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  return (
    <div className="card">
      <b>Add a document</b>
      <div className="row">
        <div>
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {['site_survey_report', 'design_approval', 'mechanical_completion', 'commissioning_report', 'other'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} size={34} /></div>
        <div>
          <label>Applies to (none ticked = project-wide)</label>
          {units.map((u) => (
            <label key={u.id} style={{ display: 'inline', marginRight: 10 }}>
              <input type="checkbox" checked={appliesTo.includes(u.id)} onChange={() => toggle(u.id)} /> {u.name}
            </label>
          ))}
        </div>
        <button disabled={busy} onClick={async () => { if (await run('addDocument', { type, title, appliesTo })) setTitle(''); }}>Add</button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

const sevClass = { error: 'bad', warning: 'back', info: '' };

export function LoadTestPanel({ projectId, units }) {
  const { run, busy, error } = useAction(projectId);
  const [file, setFile] = useState(null); // { name, text } | { sample: true }
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [manual, setManual] = useState({ unitId: units[0]?.id, outcome: 'pass', reason: '' });

  const payload = () => (file?.sample ? { useSample: true } : { csvText: file.text, filename: file.name });
  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile({ name: f.name, text: await f.text() });
    setPreview(null);
    setDone(null);
  }
  return (
    <div className="card">
      <b>Import a load-test file</b>
      <div className="row">
        <div><label>CSV from the data logger</label><input type="file" accept=".csv,text/csv" onChange={pick} /></div>
        <button onClick={() => { setFile({ sample: true }); setPreview(null); setDone(null); }}>Use the sample file (P-001)</button>
        <button disabled={!file || busy} onClick={async () => setPreview(await run('previewLoadTest', payload(), { refresh: false }))}>Preview</button>
        <button disabled={!file || busy} onClick={async () => { const r = await run('importLoadTest', payload()); if (r) { setDone(r.events.length); setPreview(null); } }}>Import &amp; record results</button>
      </div>
      {file && <div className="muted">Selected: {file.sample ? 'data/load-test-P-001.csv (sample)' : file.name}</div>}
      {done && <div>Recorded {done} unit result(s). Results appear under each unit below and in the history.</div>}
      <ErrorBox error={error} />
      {preview && (
        <div>
          <h4>Result per unit (rule: ≥ {preview.rule.thresholdPct}% of rated for ≥ {preview.rule.hours} continuous hours)</h4>
          <table>
            <tbody>
              {Object.values(preview.units).map((u) => (
                <tr key={u.unitId}>
                  <td><b>{u.unitId}</b></td>
                  <td><span className={`badge ${u.result === 'pass' ? 'ok' : 'bad'}`}>{u.result.toUpperCase()}</span></td>
                  <td>{u.reasons.map((r) => <div key={r}>{r}</div>)}{u.avgAmbientC != null && <div className="muted">Average ambient {u.avgAmbientC} °C</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4>What was found in the file ({preview.findings.length})</h4>
          <ul>{preview.findings.map((f, i) => <li key={i}><span className={`badge ${sevClass[f.severity]}`}>{f.severity}</span> {f.message}</li>)}</ul>
        </div>
      )}
      <hr />
      <b>Record a result by hand</b> <span className="muted">(commissioning engineer's decision, a sign-off, or a re-test)</span>
      <div className="row">
        <div><label>Unit</label><select value={manual.unitId} onChange={(e) => setManual({ ...manual, unitId: e.target.value })}>{units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label>Outcome</label><select value={manual.outcome} onChange={(e) => setManual({ ...manual, outcome: e.target.value })}><option>pass</option><option>fail</option></select></div>
        <div><label>Short reason (required)</label><input size={50} value={manual.reason} onChange={(e) => setManual({ ...manual, reason: e.target.value })} /></div>
        <button disabled={busy} onClick={async () => { if (await run('recordLoadTest', manual)) setManual({ ...manual, reason: '' }); }}>Record</button>
      </div>
    </div>
  );
}

// Raise an issue: the app suggests what is affected from rules; the person can untick / adjust.
export function RaiseIssueForm({ projectId, units, phases, labels }) {
  const { run, busy, error } = useAction(projectId);
  const [f, setF] = useState({ ref: '', description: '', unitIds: [], targetPhase: 'Design', component: '' });
  const [sug, setSug] = useState(null); // suggestion: { equipment, tasks, documents, tests }
  const [off, setOff] = useState({}); // key -> true when unticked
  const [repl, setRepl] = useState({}); // equipmentId -> { model, weeks }
  const toggleUnit = (id) => setF((x) => ({ ...x, unitIds: x.unitIds.includes(id) ? x.unitIds.filter((u) => u !== id) : [...x.unitIds, id] }));
  const on = (key) => !off[key];

  async function suggest() {
    const r = await run('suggestInvalidations', { unitIds: f.unitIds, targetPhase: f.targetPhase, component: f.component || null }, { refresh: false });
    if (r) { setSug(r); setOff({}); }
  }
  async function raise() {
    const invalidations = sug && {
      equipment: sug.equipment.filter((id) => on(`e:${id}`)),
      tasks: sug.tasks.filter((id) => on(`t:${id}`)),
      documents: sug.documents.filter((d) => on(`d:${d.id}`)),
      tests: sug.tests.filter((u) => on(`x:${u}`)),
    };
    const replacements = invalidations
      ? invalidations.equipment.filter((id) => repl[id]?.model).map((id) => ({ replaces: id, model: repl[id].model, leadTimeWeeks: Number(repl[id].weeks) }))
      : [];
    const r = await run('raiseIssue', { ...f, invalidations, replacements });
    if (r) { setSug(null); setF({ ref: '', description: '', unitIds: [], targetPhase: 'Design', component: '' }); }
  }
  
  return (
    <div className="card">
      <b>Raise an issue and send units back</b>
      <div className="row">
        <div><label>Reference</label><input value={f.ref} placeholder="NCR-014" size={10} onChange={(e) => setF({ ...f, ref: e.target.value })} /></div>
        <div>
          <label>Against units</label>
          {units.map((u) => (
            <label key={u.id} style={{ display: 'inline', marginRight: 10 }}>
              <input type="checkbox" checked={f.unitIds.includes(u.id)} onChange={() => { toggleUnit(u.id); setSug(null); }} /> {u.name} <span className="muted">({u.phase})</span>
            </label>
          ))}
        </div>
        <div><label>Back to phase</label><select value={f.targetPhase} onChange={(e) => { setF({ ...f, targetPhase: e.target.value }); setSug(null); }}>{phases.slice(0, -1).map((p) => <option key={p}>{p}</option>)}</select></div>
        <div><label>Failed component</label><select value={f.component} onChange={(e) => { setF({ ...f, component: e.target.value }); setSug(null); }}><option value="">(not specified)</option><option>engine</option><option>alternator</option><option>switchgear</option></select></div>
      </div>
      <label>Short description</label>
      <textarea rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      <p><button disabled={busy || f.unitIds.length === 0} onClick={suggest}>1. Work out what is affected</button> <span className="muted">(you can untick items before raising it)</span></p>
      {sug && (
        <div>
          <b>Will become invalid:</b>
          <ul>
            {sug.equipment.map((id) => (
              <li key={id}>
                <input type="checkbox" checked={on(`e:${id}`)} onChange={() => setOff({ ...off, [`e:${id}`]: on(`e:${id}`) })} /> equipment {labels.equipment[id]}
                {on(`e:${id}`) && (
                  <span> → replace with <input placeholder="new model" size={12} value={repl[id]?.model || ''} onChange={(e) => setRepl({ ...repl, [id]: { ...repl[id], model: e.target.value } })} /> lead time <input type="number" min="1" style={{ width: 50 }} value={repl[id]?.weeks || ''} onChange={(e) => setRepl({ ...repl, [id]: { ...repl[id], weeks: e.target.value } })} /> weeks</span>
                )}
              </li>
            ))}
            {sug.tasks.map((id) => (
              <li key={id}><input type="checkbox" checked={on(`t:${id}`)} onChange={() => setOff({ ...off, [`t:${id}`]: on(`t:${id}`) })} /> task {labels.tasks[id]} (must be redone)</li>
            ))}
            {sug.documents.map((d) => (
              <li key={d.id}><input type="checkbox" checked={on(`d:${d.id}`)} onChange={() => setOff({ ...off, [`d:${d.id}`]: on(`d:${d.id}`) })} /> document {labels.documents[d.id]} — for {d.unitIds.join(', ')} only</li>
            ))}
            {sug.tests.map((u) => (
              <li key={u}><input type="checkbox" checked={on(`x:${u}`)} onChange={() => setOff({ ...off, [`x:${u}`]: on(`x:${u}`) })} /> load-test result of {u} (a re-test is needed)</li>
            ))}
          </ul>
          <p className="muted">Everything else stays valid. Nothing is deleted: invalidated records stay in the history.</p>
          <button disabled={busy} onClick={raise}>2. Raise issue &amp; send back</button>
        </div>
      )}
      <ErrorBox error={error} />
    </div>
  );
  
}
export function ResetButton() {
  const router = useRouter();
  const [error, setError] = useState(null);
  async function reset() {
    if (!window.confirm('Back to the seed data? The current log is kept as a .bak.jsonl file.')) return;
    const res = await fetch('/api/reset', { method: 'POST' });
    if (res.ok) router.refresh();
    else setError((await res.json()).error);
  }
  return (
    <>
      <button onClick={reset}>Reset button for demo</button>
      {error && <span className="err"> {error}</span>}
    </>
  );
}
