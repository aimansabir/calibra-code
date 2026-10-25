import { useCallback, useEffect, useState } from 'react';
import { request } from '../lib/api';
import { ErrorNote } from '../components/Form';

type Cond = 'direct' | 'always' | 'adaptive';
type StepInfo = { index: number; total: number; kind: string; taskId: string | null; role: string | null; part: number | null; condition: Cond | null };
type Issue = { id: string; participantId: string; taskId: string; role: string; condition: Cond | null; reason: string; exclude: boolean; recordedAt: string; attemptId: string | null };
type ParticipantRow = {
  id: string;
  isDemo: boolean;
  createdAt: string;
  completedAt: string | null;
  orderIndex: number;
  conditionOrder: Cond[];
  pairByCondition: Record<Cond, string> | null;
  proficiency: string | null;
  studyVersion: string | null;
  protocolVersion: string | null;
  current: StepInfo;
  tasks: { taskId: string; role: string; part: number | null; condition: Cond | null; stepIndex: number; reached: boolean }[];
  lastActivity: string | null;
  attempts: number;
  events: number;
  warnings: string[];
  issues: Issue[];
};
type Overview = {
  generatedAt: string;
  server: { studyVersion: string; protocolVersion: string };
  participants: number;
  completed: number;
  attempts: number;
  orders: { order: Cond[]; started: number; completed: number }[];
  pairs: { pair: string; byCondition: Record<Cond, { started: number; completed: number }> }[];
  versions: { version: string; participants: number }[];
  progress: ParticipantRow[];
  issues: Issue[];
};

const NAMES: Record<string, string> = { direct: 'Direct AI', always: 'Always Verify', adaptive: 'CALIBRA CODE' };
const CONDS: Cond[] = ['direct', 'always', 'adaptive'];
const COLLECTIONS = ['participants', 'attempts', 'surveys', 'events', 'sessions', 'technical_issues'];
const KEY = 'calibra.key';
const REFRESH_MS = 30000;

function storedKey() {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

function stepText(s: StepInfo) {
  const where = s.part ? `Part ${s.part}${s.condition ? ` (${NAMES[s.condition]})` : ''}` : '';
  const what =
    s.kind === 'task'
      ? `${s.role} task ${s.taskId}`
      : s.kind === 'post_task'
        ? `post-task survey for ${s.taskId}`
        : s.kind === 'post_condition'
          ? 'post-part survey'
          : s.kind === 'final'
            ? 'final survey'
            : s.kind;
  return [where, what].filter(Boolean).join(' · ');
}

function ago(iso: string | null, now: number) {
  if (!iso) return '–';
  const min = Math.round((now - Date.parse(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

// Not linked from the participant app. Progress, balance, data warnings,
// technical issues and exports. The key goes in a header, never in a URL.
export function Researcher() {
  const [key, setKey] = useState(storedKey);
  const [demo, setDemo] = useState(false);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [issueFor, setIssueFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const opts = () => ({ token: key || undefined });
  const q = demo ? '?demo=1' : '';

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    request<Overview>(`/api/overview${demo ? '?demo=1' : ''}`, undefined, { token: key || undefined })
      .then(
        (d) => {
          setData(d);
          try {
            sessionStorage.setItem(KEY, key);
          } catch {
            // ignore
          }
        },
        (e) => {
          setData(null);
          setError(e.message);
        },
      )
      .finally(() => setLoading(false));
  }, [key, demo]);

  useEffect(load, [demo]);
  useEffect(() => {
    if (!data) return;
    const t = window.setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [data != null, load]);

  // Downloads go through fetch so the key can travel in the Authorization header.
  async function download(name: string) {
    setError(null);
    try {
      const res = await fetch(`/api/export/${name}${q}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Export failed (${res.status}).`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name === 'all.json' ? `calibra-export-${new Date().toISOString().slice(0, 10)}.json` : name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removeIssue(i: Issue) {
    if (!confirm(`Remove the technical issue recorded for ${i.participantId} / ${i.taskId}?`)) return;
    try {
      await request(`/api/technical-issues/${encodeURIComponent(i.participantId)}/${encodeURIComponent(i.taskId)}`, undefined, { ...opts(), method: 'DELETE' });
      setNotice(`Removed the issue for ${i.participantId} / ${i.taskId}.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const now = data ? Date.parse(data.generatedAt) : Date.now();
  const warningCount = data?.progress.reduce((n, p) => n + p.warnings.length, 0) ?? 0;

  return (
    <div className="page researcher">
      <h1>CALIBRA CODE · researcher</h1>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <label className="field">
          <span>Research key (only needed when the server sets RESEARCH_KEY)</span>
          <span className="row">
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="current-password" />
            <button type="submit" disabled={loading}>
              {loading ? 'Loading…' : data ? 'Refresh' : 'Load'}
            </button>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
          <span>Include demo sessions</span>
        </label>
        <ErrorNote error={error} />
        {notice && (
          <p className="flash" role="status">
            {notice}
            <button type="button" className="link" onClick={() => setNotice(null)} aria-label="Dismiss message">
              ×
            </button>
          </p>
        )}
        {data && <p className="muted small">Updated {new Date(data.generatedAt).toLocaleTimeString()}, refreshes every 30 seconds.</p>}
      </form>

      {data && (
        <>
          <section className="stats" aria-label="Summary">
            <Stat label="Started" value={data.participants} />
            <Stat label="Completed" value={data.completed} />
            <Stat label="In progress" value={data.participants - data.completed} />
            <Stat label="Task attempts" value={data.attempts} />
            <Stat label="Technical issues" value={data.issues.length} detail={`${data.issues.filter((i) => i.exclude).length} excluded`} />
            <Stat label="Data warnings" value={warningCount} tone={warningCount ? 'warn' : undefined} />
          </section>

          <section className="card">
            <h2>Versions</h2>
            <p>
              This server runs study version <strong>{data.server.studyVersion}</strong>, protocol <strong>{data.server.protocolVersion}</strong>.
            </p>
            {data.versions.length > 0 && (
              <table className="tests">
                <thead>
                  <tr>
                    <th scope="col">Study / protocol version at registration</th>
                    <th scope="col">Participants</th>
                  </tr>
                </thead>
                <tbody>
                  {data.versions.map((v) => (
                    <tr key={v.version}>
                      <td>{v.version}</td>
                      <td>{v.participants}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <h2>Participants</h2>
            {data.progress.length === 0 ? (
              <p className="muted">No participants yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="tests participants">
                  <thead>
                    <tr>
                      <th scope="col">ID</th>
                      <th scope="col">Order</th>
                      <th scope="col">Progress</th>
                      <th scope="col">Current step</th>
                      <th scope="col">Last activity</th>
                      <th scope="col">Warnings and issues</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.progress.map((p) => (
                      <ParticipantRows
                        key={p.id}
                        p={p}
                        now={now}
                        open={issueFor === p.id}
                        onToggle={() => setIssueFor(issueFor === p.id ? null : p.id)}
                        token={key}
                        onSaved={(msg) => {
                          setIssueFor(null);
                          setNotice(msg);
                          load();
                        }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Technical issues</h2>
            {data.issues.length === 0 ? (
              <p className="muted">None recorded. Use “Record issue” next to a participant when a task was disrupted by a crash, lost connection or interruption.</p>
            ) : (
              <table className="tests">
                <thead>
                  <tr>
                    <th scope="col">Participant</th>
                    <th scope="col">Task</th>
                    <th scope="col">Condition</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Analysis</th>
                    <th scope="col">Recorded</th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.issues.map((i) => (
                    <tr key={i.id}>
                      <td>{i.participantId}</td>
                      <td>
                        {i.taskId} <span className="muted small">({i.role})</span>
                      </td>
                      <td>{i.condition ? NAMES[i.condition] : '–'}</td>
                      <td>{i.reason}</td>
                      <td>{i.exclude ? <span className="badge fail">excluded</span> : <span className="badge">kept</span>}</td>
                      <td>{new Date(i.recordedAt).toLocaleString()}</td>
                      <td>
                        <button className="quiet" onClick={() => removeIssue(i)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="muted small">
              <code>npm run analyze</code> drops excluded attempts and lists every exclusion in its summary.
            </p>
          </section>

          <section className="card">
            <h2>Order balance</h2>
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
          </section>

          <section className="card">
            <h2>Task-pair balance</h2>
            <table className="tests">
              <thead>
                <tr>
                  <th scope="col">Task pair</th>
                  {CONDS.map((c) => (
                    <th key={c} scope="col">
                      {NAMES[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.pairs.map((p) => (
                  <tr key={p.pair}>
                    <th scope="row">Pair {p.pair}</th>
                    {CONDS.map((c) => (
                      <td key={c}>
                        {p.byCondition[c].started} started · {p.byCondition[c].completed} completed
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">Each pair should meet each condition about equally often.</p>
          </section>

          <section className="card">
            <h2>Export</h2>
            <p>
              <button className="primary" onClick={() => download('all.json')}>
                Download everything (JSON)
              </button>
            </p>
            <ul className="exports">
              {COLLECTIONS.map((c) => (
                <li key={c}>
                  <span>{c}</span>
                  <button onClick={() => download(`${c}.csv`)}>CSV</button>
                  <button onClick={() => download(`${c}.json`)}>JSON</button>
                </li>
              ))}
            </ul>
            <p className="muted small">
              {demo ? 'Demo sessions are included.' : 'Demo sessions are left out.'} Run <code>npm run analyze</code> on the server to compute the condition
              comparisons.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, detail, tone }: { label: string; value: number; detail?: string; tone?: 'warn' }) {
  return (
    <div className={`stat card ${tone ?? ''}`}>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {detail && <span className="muted small">{detail}</span>}
    </div>
  );
}

function ParticipantRows(props: { p: ParticipantRow; now: number; open: boolean; onToggle: () => void; token: string; onSaved: (msg: string) => void }) {
  const { p } = props;
  const pct = Math.round((p.current.index / Math.max(1, p.current.total - 1)) * 100);
  return (
    <>
      <tr className={p.warnings.length ? 'has-warnings' : ''}>
        <th scope="row">
          {p.id}
          {p.isDemo && <span className="badge demo">demo</span>}
          <div className="muted small">
            v{p.studyVersion ?? '?'} · protocol {p.protocolVersion ?? '?'}
            {p.proficiency && ` · ${p.proficiency}`}
          </div>
        </th>
        <td>
          {p.orderIndex + 1}
          <div className="muted small">{p.conditionOrder.map((c) => NAMES[c]).join(' → ')}</div>
        </td>
        <td>
          <progress max={100} value={pct} aria-label={`${p.id} progress`} aria-valuetext={`Step ${p.current.index + 1} of ${p.current.total}`} /> {p.current.index + 1}/
          {p.current.total}
          <div className="muted small">
            {p.attempts} attempts · {p.events} events
          </div>
        </td>
        <td>{p.completedAt ? <span className="badge pass">completed</span> : stepText(p.current)}</td>
        <td title={p.lastActivity ? new Date(p.lastActivity).toLocaleString() : undefined}>{ago(p.lastActivity, props.now)}</td>
        <td>
          {p.warnings.length > 0 && (
            <ul className="warn-list">
              {p.warnings.map((w) => (
                <li key={w}>⚠ {w}</li>
              ))}
            </ul>
          )}
          {p.issues.map((i) => (
            <div key={i.id} className="small">
              <span className={`badge ${i.exclude ? 'fail' : ''}`}>issue</span> {i.taskId}: {i.reason}
            </div>
          ))}
          {!p.warnings.length && !p.issues.length && <span className="muted small">none</span>}
        </td>
        <td>
          <button onClick={props.onToggle} aria-expanded={props.open} aria-controls={`issue-${p.id}`}>
            Record issue
          </button>
        </td>
      </tr>
      {props.open && (
        <tr>
          <td colSpan={7} id={`issue-${p.id}`}>
            <IssueForm p={p} token={props.token} onSaved={props.onSaved} onCancel={props.onToggle} />
          </td>
        </tr>
      )}
    </>
  );
}

function IssueForm({ p, token, onSaved, onCancel }: { p: ParticipantRow; token: string; onSaved: (msg: string) => void; onCancel: () => void }) {
  const reached = p.tasks.filter((t) => t.reached);
  const [taskId, setTaskId] = useState(() => p.current.taskId ?? reached.at(-1)?.taskId ?? p.tasks[0]?.taskId ?? '');
  const existing = p.issues.find((i) => i.taskId === taskId);
  const [reason, setReason] = useState(existing?.reason ?? '');
  const [exclude, setExclude] = useState(existing?.exclude ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="issue-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await request('/api/technical-issues', { participantId: p.id, taskId, reason, exclude }, { token: token || undefined });
          onSaved(`Recorded a technical issue for ${p.id} / ${taskId}${exclude ? ', excluded from the analysis' : ''}.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Technical issue for {p.id}</h3>
      <label className="field">
        <span>Task</span>
        <select value={taskId} onChange={(e) => setTaskId(e.target.value)} autoFocus>
          {p.tasks.map((t) => (
            <option key={t.taskId} value={t.taskId}>
              {t.taskId} · {t.role}
              {t.part ? ` · Part ${t.part} (${t.condition ? NAMES[t.condition] : ''})` : ''}
              {t.reached ? '' : ' · not reached yet'}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>What happened?</span>
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} placeholder="e.g. laptop restarted during the task, Python failed to load" />
      </label>
      <label className="check">
        <input type="checkbox" checked={exclude} onChange={(e) => setExclude(e.target.checked)} />
        <span>Exclude this attempt from the analysis</span>
      </label>
      {existing && <p className="muted small">This replaces the issue already recorded for this task.</p>}
      <ErrorNote error={error} />
      <div className="row">
        <button className="primary" disabled={busy || reason.trim().length < 3}>
          {busy ? 'Saving…' : 'Save issue'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
