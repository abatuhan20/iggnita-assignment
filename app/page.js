import Link from 'next/link';
import { getEngine } from '../lib/store.js';
import { portfolio } from '../lib/summary.js';

export const dynamic = 'force-dynamic';

export default function Home() {
  const projects = portfolio(getEngine().state);
  return (
    <>
      <h1>Portfolio</h1>
      <table>
        <thead>
          <tr><th>Project</th><th>Customer</th><th>PM</th><th>Where it stands</th><th>Target commissioning</th><th>Flags</th></tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id}>
              <td><Link href={`/projects/${p.id}`}><b>{p.id}</b> {p.name}</Link><div className="muted">{p.type}</div></td>
              <td>{p.customer}</td>
              <td>{p.projectManager}</td>
              <td><span className={`badge ${p.phase === 'Mixed' ? 'back' : ''}`}>{p.phase}</span> {p.summary}</td>
              <td>{p.target_commissioning_date}</td>
              <td>
                {p.openIssues.map((r) => <div key={r}><span className="badge back">{r}</span></div>)}
                {p.overdueTasks.length > 0 && <div className="err">{p.overdueTasks.length} overdue task(s): {p.overdueTasks.map((t) => t.id).join(', ')}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">JSON: <a href="/api/portfolio">/api/portfolio</a>, <a href="/api/projects/P-001">/api/projects/P-001</a>, <a href="/api/projects/P-001/history?unit=U2">/api/projects/P-001/history?unit=U2</a></p>
    </>
  );
}
