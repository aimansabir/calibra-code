import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { ErrorNote } from '../components/Form';

type Overview = { participants: number; completed: number; attempts: number; orders: { order: string[]; started: number; completed: number }[] };

const NAMES: Record<string, string> = { direct: 'Direct AI', always: 'Always Verify', adaptive: 'CALIBRA CODE' };
const COLLECTIONS = ['participants', 'attempts', 'surveys', 'events', 'sessions'];

// Not linked from the participant app. Shows order balance and export links only.
export function Researcher() {
  const [key, setKey] = useState(() => sessionStorage.getItem('calibra.key') ?? '');
  const [demo, setDemo] = useState(false);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const q = (extra = '') => `?key=${encodeURIComponent(key)}${demo ? '&demo=1' : ''}${extra}`;

  const load = () => {
    setError(null);
    request<Overview>(`/api/overview${q()}`).then(
      (d) => {
        setData(d);
        try {
          sessionStorage.setItem('calibra.key', key);
        } catch {
          // ignore
        }
      },
      (e) => {
        setData(null);
        setError(e.message);
      },
    );
  };
  useEffect(load, [demo]);

  return (
    <div className="page">
      <h1>CALIBRA CODE · researcher</h1>
      <div className="card form">
        <label className="field">
          <span>Research key (only needed when the server sets RESEARCH_KEY)</span>
          <span className="row">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} />
            <button onClick={load}>Load</button>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span>Include demo sessions</span>
        </label>
        <ErrorNote error={error} />
      </div>

      {data && (
        <>
          <div className="card">
            <h2>Progress</h2>
            <p>
              {data.participants} participants started, {data.completed} completed, {data.attempts} task attempts.
            </p>
            <table className="tests">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Conditions</th>
                  <th scope="col">Started</th>
                  <th scope="col">Completed</th>
                  <th scope="col">Pinned link</th>
                </tr>
              </thead>
              <tbody>
                {data.orders.map((o, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>{o.order.map((c) => NAMES[c] ?? c).join(' → ')}</td>
                    <td>{o.started}</td>
                    <td>{o.completed}</td>
                    <td>
                      <a href={`/?order=${i + 1}`}>/?order={i + 1}</a> · <a href={`/?demo=1&order=${i + 1}`}>demo</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Without ?order the server gives each new participant the least used order.</p>
          </div>
          <div className="card">
            <h2>Export</h2>
            <ul>
              {COLLECTIONS.map((c) => (
                <li key={c}>
                  {c}: <a href={`/api/export/${c}.csv${q()}`}>CSV</a> · <a href={`/api/export/${c}.json${q()}`}>JSON</a>
                </li>
              ))}
            </ul>
            <p className="muted small">
              Run <code>npm run analyze</code> on the server to compute the condition comparisons from these files.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
