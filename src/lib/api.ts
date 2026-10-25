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
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Cannot reach the study server. Check the connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `The server answered with an error (${res.status}).`, res.status);
  return data as T;
}

const base = (id: string) => `/api/sessions/${encodeURIComponent(id)}`;

export const api = {
  register: (p: Record<string, unknown>) => request<SessionView>('/api/sessions', p),
  session: (id: string) => request<SessionView>(base(id)),
  proficiencyQuestions: () => request<{ id: string; prompt: string; code: string; options: string[] }[]>('/api/proficiency'),
  submitProficiency: (id: string, answers: Record<string, string>) => request<SessionView>(`${base(id)}/proficiency`, { answers }),
  finishInstructions: (id: string) => request<SessionView>(`${base(id)}/instructions`, {}),
  diagnose: (id: string, taskId: string, body: { diagnosisText: string; suspectedLine: number | null }) =>
    request<Advice>(`${base(id)}/tasks/${taskId}/diagnosis`, body),
  verify: (id: string, taskId: string, answer: string) => request<Advice>(`${base(id)}/tasks/${taskId}/verify`, { answer }),
  submit: (id: string, taskId: string, body: Record<string, unknown>) =>
    request<{ visiblePassed: number; visibleTotal: number; session: SessionView }>(`${base(id)}/tasks/${taskId}/submit`, body),
  survey: (id: string, kind: string, responses: Record<string, number | string>) => request<SessionView>(`${base(id)}/surveys/${kind}`, { responses }),
  debrief: (id: string) =>
    request<{ tasks: { title: string; part: number; aiWasCorrect: boolean; explanation: string; completed: boolean }[]; conditionOrder?: string[] }>(
      `${base(id)}/debrief`,
    ),
};

// ---- event log ----
// Events wait in localStorage until the server has them, so a dropped
// connection or a reload doesn't lose any.

const OUTBOX = 'calibra.events';
type QueuedEvent = { participantId: string; id: string; type: string; at: string; taskId: string | null; payload: Record<string, unknown> };

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

type SaveState = 'saved' | 'saving' | 'offline';
const listeners = new Set<(s: SaveState) => void>();
let saveState: SaveState = 'saved';
const setSave = (s: SaveState) => {
  saveState = s;
  listeners.forEach((l) => l(s));
};
export const onSaveState = (fn: (s: SaveState) => void) => {
  listeners.add(fn);
  fn(saveState);
  return () => void listeners.delete(fn);
};

let timer: number | undefined;
let flushing = false;

export function logEvent(participantId: string, type: string, taskId: string | null, payload: Record<string, unknown> = {}) {
  writeQueue([...queue(), { participantId, id: newId('evt_'), type, at: nowIso(), taskId, payload }]);
  clearTimeout(timer);
  timer = window.setTimeout(flushEvents, 1500);
}

export async function flushEvents() {
  if (flushing) return;
  flushing = true;
  try {
    let q = queue();
    while (q.length) {
      setSave('saving');
      const pid = q[0].participantId;
      const batch = q.filter((e) => e.participantId === pid).slice(0, 100);
      try {
        await request(`${base(pid)}/events`, batch.map(({ participantId, ...e }) => e));
      } catch (e) {
        // A 404 means the session is gone (e.g. a wiped demo); drop those rows.
        if (e instanceof ApiError && e.status === 404) {
          q = q.filter((x) => x.participantId !== pid);
          writeQueue(q);
          continue;
        }
        setSave('offline');
        clearTimeout(timer);
        timer = window.setTimeout(flushEvents, 5000);
        return;
      }
      const sent = new Set(batch.map((b) => b.id));
      q = queue().filter((x) => !sent.has(x.id));
      writeQueue(q);
    }
    setSave('saved');
  } finally {
    flushing = false;
  }
}

window.addEventListener('online', () => void flushEvents());
window.addEventListener('pagehide', () => void flushEvents());
