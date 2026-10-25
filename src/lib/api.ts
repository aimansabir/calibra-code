import { newId, nowIso } from './id';

// Shapes the server sends to the participant's browser. They only ever hold
// what the current screen needs: no conditions, hidden tests or answer keys.
export type Step =
  | { kind: 'proficiency' }
  | { kind: 'instructions' }
  | { kind: 'task'; taskId: string; role: 'practice' | 'experimental' | 'transfer'; part: number | null; index: number }
  | { kind: 'post_task'; taskId: string; role: 'experimental' | 'transfer'; part: number | null }
  | { kind: 'post_condition'; part: number }
  | { kind: 'final' }
  | { kind: 'debrief' };

export interface VisibleTest {
  name: string;
  call: string;
  expected: string;
}

export interface PatchTest extends VisibleTest {
  actual?: string;
  passed: boolean;
}

export interface Check {
  activity: string;
  question: string;
  options: string[];
  lineNumber: number | null;
  lineText: string | null;
  call: string | null;
}

export interface Advice {
  diagnosis: string;
  rationale: string;
  targetLines: number[];
  patch: string | null;
  patchWithheld: boolean;
  showComparison: boolean;
  showEvidence: boolean;
  evidenceOpen: boolean;
  staticWarnings: { line: number; message: string }[];
  student: { diagnosisText: string; suspectedLine: number | null };
  check: Check | null;
  checkDone: boolean;
  checkFeedback: { correct: boolean | null; text: string | null } | null;
  patchTests?: PatchTest[] | null;
  demo?: { condition: string; level: string; score: number | null; reasons: string[]; activity: string };
}

export interface PublicTask {
  id: string;
  role: 'practice' | 'experimental' | 'transfer';
  title: string;
  functionName: string;
  objective: string;
  expected: string;
  examples: string[];
  constraints: string[];
  starterCode: string;
  visibleTests: VisibleTest[];
  hiddenTestCount: number;
  hasAi: boolean;
  advice: Advice | null;
}

export interface SessionView {
  participantId: string;
  isDemo: boolean;
  steps: Step[];
  stepIndex: number;
  task: PublicTask | null;
  demo?: { conditionOrder: string[]; orderIndex: number; proficiency: string | null; stepCondition: string | null };
  // Only in the registration response.
  token?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

// The server answers 'stale_step' when the step is already done, e.g. a submit
// that went through but whose response was lost. The app reloads the session
// instead of showing an error.
const staleListeners = new Set<() => void>();
export const onStale = (fn: () => void) => {
  staleListeners.add(fn);
  return () => void staleListeners.delete(fn);
};
export const isStale = (e: unknown) => e instanceof ApiError && e.code === 'stale_step';

export async function request<T>(path: string, body?: unknown, opts: { token?: string; method?: string; keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  try {
    res = await fetch(path, {
      method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive: opts.keepalive,
    });
  } catch {
    throw new ApiError('Cannot reach the study server. Check the connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(data.error ?? `The server answered with an error (${res.status}).`, res.status, data.code);
    if (isStale(err)) staleListeners.forEach((l) => l());
    throw err;
  }
  return data as T;
}

// ---- session credentials ----
// The token from registration goes with every request for that session.

const SESSION_KEY = 'calibra.session';
export type StoredSession = { participantId: string; token: string };
let memorySession: StoredSession | null = null;

export function storedSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return memorySession;
    const s = JSON.parse(raw);
    // Older versions stored only the ID, which can't be resumed without a token.
    return s && typeof s.participantId === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return memorySession;
  }
}

export function storeSession(s: StoredSession | null) {
  memorySession = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // private window, the session just won't survive a reload
  }
}

const tokenFor = (id: string) => {
  const s = storedSession();
  return s?.participantId === id ? s.token : undefined;
};

const base = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;
const call = <T>(id: string, path: string, body?: unknown) => request<T>(base(id) + path, body, { token: tokenFor(id) });

export const api = {
  register: (p: Record<string, unknown>) => request<SessionView>('/api/sessions', p),
  session: (id: string) => call<SessionView>(id, ''),
  proficiencyQuestions: () => request<{ id: string; prompt: string; code: string; options: string[] }[]>('/api/proficiency'),
  submitProficiency: (id: string, answers: Record<string, string>) => call<SessionView>(id, '/proficiency', { answers }),
  finishInstructions: (id: string) => call<SessionView>(id, '/instructions', {}),
  diagnose: (id: string, taskId: string, body: { diagnosisText: string; suspectedLine: number | null }) =>
    call<Advice>(id, `/tasks/${taskId}/diagnosis`, body),
  verify: (id: string, taskId: string, answer: string) => call<Advice>(id, `/tasks/${taskId}/verify`, { answer }),
  submit: (id: string, taskId: string, body: Record<string, unknown>) =>
    call<{ visiblePassed: number; visibleTotal: number; session: SessionView }>(id, `/tasks/${taskId}/submit`, body),
  survey: (id: string, kind: string, responses: Record<string, number | string>) => call<SessionView>(id, `/surveys/${kind}`, { responses }),
  debrief: (id: string) =>
    call<{ tasks: { title: string; part: number; aiWasCorrect: boolean; explanation: string; completed: boolean }[]; conditionOrder?: string[] }>(
      id,
      '/debrief',
    ),
};

// ---- event log ----
// Events wait in localStorage until the server has them, so a dropped
// connection or a reload doesn't lose any.

const OUTBOX = 'calibra.events';
// Each event carries the step it was created on and the token to send it with,
// so it is attributed correctly however late it arrives.
type QueuedEvent = {
  participantId: string;
  token?: string;
  id: string;
  type: string;
  at: string;
  stepIndex: number;
  taskId: string | null;
  payload: Record<string, unknown>;
};
export type EventContext = { participantId: string; stepIndex: number; taskId: string | null };

function readQueue(): QueuedEvent[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX) ?? '[]');
  } catch {
    return [];
  }
}

function writeQueue(q: QueuedEvent[]) {
  try {
    localStorage.setItem(OUTBOX, JSON.stringify(q));
  } catch {
    // storage blocked; events stay in memory for this page only
    memoryQueue = q;
  }
}

let memoryQueue: QueuedEvent[] | null = null;
const queue = () => memoryQueue ?? readQueue();

// 'offline' means the browser reports no network or the last send failed.
export type SaveState = { state: 'saved' | 'saving' | 'offline'; pending: number };
const listeners = new Set<(s: SaveState) => void>();
let saveState: SaveState = { state: 'saved', pending: 0 };
const setSave = (state: SaveState['state']) => {
  saveState = { state, pending: queue().length };
  listeners.forEach((l) => l(saveState));
};
export const onSaveState = (fn: (s: SaveState) => void) => {
  listeners.add(fn);
  fn(saveState);
  return () => void listeners.delete(fn);
};

let timer: number | undefined;
let flushing = false;
const RETRY_MS = 5000;

export function logEvent(ctx: EventContext, type: string, payload: Record<string, unknown> = {}) {
  const e: QueuedEvent = { ...ctx, token: tokenFor(ctx.participantId), id: newId('evt_'), type, at: nowIso(), payload };
  writeQueue([...queue(), e]);
  const offline = saveState.state === 'offline';
  if (offline) setSave('offline'); // refresh the waiting count
  clearTimeout(timer);
  timer = window.setTimeout(flushEvents, offline ? RETRY_MS : 1500);
}

export async function flushEvents(opts: { keepalive?: boolean } = {}) {
  if (flushing) return;
  flushing = true;
  try {
    let q = queue();
    while (q.length) {
      setSave('saving');
      const { participantId: pid, token } = q[0];
      const batch = q.filter((e) => e.participantId === pid && e.token === token).slice(0, 100);
      try {
        await request(
          `${base(pid)}/events`,
          batch.map(({ participantId, token, ...e }) => e),
          { token: token ?? tokenFor(pid), keepalive: opts.keepalive },
        );
      } catch (e) {
        // 404: the session is gone (e.g. a wiped demo). 401: the token will never be
        // accepted (a re-registered demo ID, or events queued before tokens). Drop those rows.
        if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
          const dropped = new Set(batch.map((b) => b.id));
          q = queue().filter((x) => !dropped.has(x.id));
          writeQueue(q);
          continue;
        }
        setSave('offline');
        clearTimeout(timer);
        timer = window.setTimeout(flushEvents, RETRY_MS);
        return;
      }
      const sent = new Set(batch.map((b) => b.id));
      q = queue().filter((x) => !sent.has(x.id));
      writeQueue(q);
    }
    setSave(navigator.onLine === false ? 'offline' : 'saved');
  } finally {
    flushing = false;
  }
}

window.addEventListener('online', () => void flushEvents());
window.addEventListener('offline', () => setSave('offline'));
window.addEventListener('pagehide', () => void flushEvents({ keepalive: true }));
