import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/app';
import { Grader } from '../server/grader';
import { PROFICIENCY_QUESTIONS } from '../src/study/questionnaires';
import { getTask } from '../src/study/tasks';
import { SUS_ITEMS, TLX_ITEMS, AGENCY_ITEMS } from '../src/study/surveyItems';

let server: Server;
let base = '';
const dataDir = mkdtempSync(join(tmpdir(), 'calibra-'));
const grader = new Grader();

beforeAll(async () => {
  await grader.start();
  const app = createApp({ dataDir, grader, researchKey: 'secret' });
  await new Promise<void>((ok) => {
    server = app.listen(0, () => ok());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}, 60000);

afterAll(() => {
  server?.close();
  grader.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call(path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => null)) as any, text: '' };
}

const answers = Object.fromEntries(PROFICIENCY_QUESTIONS.map((q) => [q.id, q.options.find((o) => o !== q.answer)!]));
const background = { yearOfStudy: '2nd year', experience: '1 to 2 years', pythonConfidence: 3, aiToolUse: 'Weekly', consent: true };

describe('study API', () => {
  it('balances orders across participants', async () => {
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await call('/api/sessions', { id: `BAL-${i}`, ...background });
      expect(r.status).toBe(200);
      seen.push(r.data.stepIndex);
    }
    const overview = await call('/api/overview?key=secret');
    expect(overview.data.orders.map((o: any) => o.started)).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('rejects duplicate ids and missing consent', async () => {
    expect((await call('/api/sessions', { id: 'BAL-0', ...background })).status).toBe(409);
    expect((await call('/api/sessions', { id: 'NEW-1', ...background, consent: false })).status).toBe(400);
  });

  it('never sends conditions, hidden tests, solutions or answers to the browser', async () => {
    const r = await call('/api/sessions', { id: 'LEAK-1', ...background, orderOverride: 0 });
    const json = JSON.stringify(r.data);
    for (const c of ['direct', 'always', 'adaptive']) expect(json).not.toContain(`"${c}"`);
    const q = await call('/api/proficiency');
    expect(JSON.stringify(q.data)).not.toContain('"answer"');

    await call('/api/sessions/LEAK-1/proficiency', { answers });
    const s = await call('/api/sessions/LEAK-1/instructions', {});
    const task = s.data.task;
    const def = getTask(task.id);
    const text = JSON.stringify(task);
    expect(text).not.toContain(def.solutionCode.trim());
    for (const t of def.tests.filter((t) => t.hidden)) expect(text).not.toContain(t.call);
    expect(text).not.toContain('correctness');
    expect(task.advice).toBeNull();
  });

  it('runs a whole session and grades on the server', async () => {
    const pid = 'FLOW-1';
    // order 0 = direct, always, adaptive
    let s = (await call('/api/sessions', { id: pid, ...background, orderOverride: 0 })).data;
    s = (await call(`/api/sessions/${pid}/proficiency`, { answers })).data;
    s = (await call(`/api/sessions/${pid}/instructions`, {})).data;

    while (s.steps[s.stepIndex].kind !== 'debrief') {
      const step = s.steps[s.stepIndex];
      if (step.kind === 'task') {
        const def = getTask(step.taskId);
        if (step.role !== 'transfer') {
          // advice can't be skipped and needs a real diagnosis
          expect((await call(`/api/sessions/${pid}/tasks/${def.id}/submit`, { finalCode: def.starterCode, decision: 'accept' })).status).toBe(409);
          expect((await call(`/api/sessions/${pid}/tasks/${def.id}/diagnosis`, { diagnosisText: 'short' })).status).toBe(400);
          let advice = (await call(`/api/sessions/${pid}/tasks/${def.id}/diagnosis`, { diagnosisText: 'I think the loop bound is wrong', suspectedLine: null })).data;
          if (advice.patchWithheld) expect(advice.patch).toBeNull();
          if (advice.check) {
            advice = (await call(`/api/sessions/${pid}/tasks/${def.id}/verify`, { answer: advice.check.options[0] })).data;
            expect(advice.patch).toBe(def.patchCode);
          }
          const r = await call(`/api/sessions/${pid}/tasks/${def.id}/submit`, {
            finalCode: def.solutionCode,
            decision: 'reject',
            decisionHistory: [{ decision: 'reject', at: new Date().toISOString() }],
            counters: { testRuns: 1 },
          });
          expect(r.status).toBe(200);
          expect(r.data.visiblePassed).toBe(r.data.visibleTotal);
          s = r.data.session;
        } else {
          const r = await call(`/api/sessions/${pid}/tasks/${def.id}/submit`, { finalCode: def.starterCode });
          s = r.data.session;
        }
      } else if (step.kind === 'post_task') {
        s = (await call(`/api/sessions/${pid}/surveys/post_task`, { responses: { confidence: 5, difficulty: 3, helpfulness: 4, effort: 3 } })).data;
      } else if (step.kind === 'post_condition') {
        const responses = Object.fromEntries([...TLX_ITEMS.map((i) => [i.id, 50]), ...SUS_ITEMS.map((i) => [i.id, 3]), ...AGENCY_ITEMS.map((i) => [i.id, 4])]);
        s = (await call(`/api/sessions/${pid}/surveys/post_condition`, { responses })).data;
      } else if (step.kind === 'final') {
        s = (await call(`/api/sessions/${pid}/surveys/final`, { responses: { prefer_overall: 'Part 3', prefer_trust: 'Part 2', prefer_least_effort: 'Part 1' } })).data;
      } else throw new Error(`unexpected step ${step.kind}`);
    }

    const debrief = await call(`/api/sessions/${pid}/debrief`);
    expect(debrief.data.tasks).toHaveLength(6);
    expect(debrief.data.tasks.filter((t: any) => !t.aiWasCorrect)).toHaveLength(3);

    expect((await call('/api/export/attempts.json')).status).toBe(401);
    const attempts = (await call('/api/export/attempts.json?key=secret')).data.filter((a: any) => a.participantId === pid);
    expect(attempts).toHaveLength(8);
    const experimental = attempts.filter((a: any) => a.role === 'experimental');
    expect(new Set(experimental.map((a: any) => a.condition))).toEqual(new Set(['direct', 'always', 'adaptive']));
    expect(experimental.every((a: any) => a.finalCorrect)).toBe(true);
    // rejecting a correct suggestion is underreliance, rejecting a wrong one is appropriate
    for (const a of experimental) expect(a.reliance).toBe(a.aiCorrectness === 'correct' ? 'under' : 'appropriate');
    const transfer = attempts.find((a: any) => a.role === 'transfer');
    expect(transfer.finalCorrect).toBe(false);
    expect(transfer.hiddenTotal).toBeGreaterThan(0);

    const surveys = (await call('/api/export/surveys.json?key=secret')).data.filter((r: any) => r.participantId === pid);
    const post = surveys.filter((r: any) => r.kind === 'post_condition');
    expect(post.map((r: any) => r.condition)).toEqual(['direct', 'always', 'adaptive']);
    expect(post[0].scores).toMatchObject({ rawTlx: 50, sus: 50, agencyMean: 4 });
    const final = surveys.find((r: any) => r.kind === 'final');
    expect(final.responses.prefer_overall_condition).toBe('adaptive');

    const csv = await fetch(`${base}/api/export/attempts.csv?key=secret`).then((r) => r.text());
    expect(csv.split('\n')[0]).toContain('support_level');
  }, 120000);

  it('keeps the task condition on events that arrive after the participant has moved on', async () => {
    const pid = 'LATE-1';
    // order 0 starts with direct, which has no check, so the first task can be submitted straight away
    await call('/api/sessions', { id: pid, ...background, orderOverride: 0 });
    await call(`/api/sessions/${pid}/proficiency`, { answers });
    let s = (await call(`/api/sessions/${pid}/instructions`, {})).data;

    const practice = s.task.id;
    const advice = (await call(`/api/sessions/${pid}/tasks/${practice}/diagnosis`, { diagnosisText: 'the condition skips a case' })).data;
    await call(`/api/sessions/${pid}/tasks/${practice}/verify`, { answer: advice.check.options[0] });
    s = (await call(`/api/sessions/${pid}/tasks/${practice}/submit`, { finalCode: s.task.starterCode, decision: 'accept' })).data.session;

    const taskId = s.task.id;
    await call(`/api/sessions/${pid}/tasks/${taskId}/diagnosis`, { diagnosisText: 'the loop stops one item early' });
    s = (await call(`/api/sessions/${pid}/tasks/${taskId}/submit`, { finalCode: s.task.starterCode, decision: 'reject' })).data.session;
    expect(s.steps[s.stepIndex].kind).toBe('post_task');

    // a queued event from the task, delivered while the participant is on the questionnaire
    await call(`/api/sessions/${pid}/events`, [{ id: 'evt_late_1', type: 'tests_run', at: new Date().toISOString(), taskId, payload: {} }]);

    const events = (await call('/api/export/events.json?key=secret')).data;
    expect(events.find((e: any) => e.id === 'evt_late_1')?.condition).toBe('direct');
  }, 60000);

  it('stops participant code that never ends', async () => {
    const r = await grader.run('def f():\n    while True:\n        pass', [{ name: 'loop', call: 'f()', expected: 'None' }]);
    expect(r[0].passed).toBe(false);
    expect(r[0].error).toBe('timed out');
    const after = await grader.run('def f():\n    return 1', [{ name: 'ok', call: 'f()', expected: '1' }]);
    expect(after[0].passed).toBe(true);
  }, 60000);
});
