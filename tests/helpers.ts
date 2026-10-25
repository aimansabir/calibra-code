import type { Server } from 'node:http';
import { createApp } from '../server/app';
import type { Grader } from '../server/grader';
import { PROFICIENCY_QUESTIONS } from '../src/study/questionnaires';

export const KEY = 'test-research-key-123';
export const answers = Object.fromEntries(PROFICIENCY_QUESTIONS.map((q) => [q.id, q.options.find((o) => o !== q.answer)!]));
export const background = { yearOfStudy: '2nd year', experience: '1 to 2 years', pythonConfidence: 3, aiToolUse: 'Weekly', consent: true };

// One running app on a random port. Starting a second one on the same data
// folder is how the tests simulate a server restart.
export async function startServer(dataDir: string, grader: Grader) {
  const app = createApp({ dataDir, grader, researchKey: KEY });
  const server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;

  async function call(path: string, body?: unknown, opts: { auth?: string; method?: string } = {}) {
    const res = await fetch(base + path, {
      method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { 'Content-Type': 'application/json', ...(opts.auth ? { Authorization: `Bearer ${opts.auth}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      // CSV
    }
    return { status: res.status, data, text };
  }

  return {
    base,
    call,
    research: (path: string, body?: unknown, method?: string) => call(path, body, { auth: KEY, method }),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}

export type Api = Awaited<ReturnType<typeof startServer>>;

// A participant with their token, who can walk through the session.
export async function participant(api: Api, id: string, extra: Record<string, unknown> = {}) {
  const r = await api.call('/api/sessions', { id, ...background, orderOverride: 0, ...extra });
  if (r.status !== 200) throw new Error(`register failed: ${r.status} ${r.text}`);
  const token = r.data.token as string;
  const as = (path: string, body?: unknown) => api.call(`/api/sessions/${id}${path}`, body, { auth: token });
  return { id, token, first: r.data, as };
}

export type P = Awaited<ReturnType<typeof participant>>;

// From registration to the first experimental task (order 0: direct first, which has no check).
export async function toFirstTask(p: P) {
  await p.as('/proficiency', { answers });
  let s = (await p.as('/instructions', {})).data;
  const practice = s.task.id;
  const advice = (await p.as(`/tasks/${practice}/diagnosis`, { diagnosisText: 'the condition skips a case' })).data;
  if (advice.check) await p.as(`/tasks/${practice}/verify`, { answer: advice.check.options[0] });
  s = (await p.as(`/tasks/${practice}/submit`, { finalCode: s.task.starterCode, decision: 'accept' })).data.session;
  return s;
}
