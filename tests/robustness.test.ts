import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyExclusions } from '../analysis/exclusions';
import { ConfigError, loadConfig } from '../server/config';
import { Grader } from '../server/grader';
import { Researcher } from '../server/researcher';
import { Store } from '../server/store';
import { Study } from '../server/study';
import { STUDY_VERSION, PROTOCOL_VERSION } from '../server/version';
import { AGENCY_ITEMS, SUS_ITEMS, TLX_ITEMS } from '../src/study/surveyItems';
import { getTask } from '../src/study/tasks';
import type { TaskAttempt } from '../src/study/types';
import { participant, startServer, toFirstTask, type Api } from './helpers';

const dataDir = mkdtempSync(join(tmpdir(), 'calibra-robust-'));
const grader = new Grader();
let api: Api;

beforeAll(async () => {
  await grader.start();
  api = await startServer(dataDir, grader);
}, 60000);

afterAll(async () => {
  await api?.close();
  grader.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

const postCondition = () => Object.fromEntries([...TLX_ITEMS.map((i) => [i.id, 40]), ...SUS_ITEMS.map((i) => [i.id, 3]), ...AGENCY_ITEMS.map((i) => [i.id, 5])]);

describe('session tokens', () => {
  it('are required for every participant endpoint', async () => {
    const p = await participant(api, 'AUTH-1');
    const other = await participant(api, 'AUTH-2');
    expect(p.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    const paths: [string, unknown?][] = [
      [''],
      ['/proficiency', { answers: {} }],
      ['/instructions', {}],
      ['/tasks/x/diagnosis', {}],
      ['/tasks/x/verify', {}],
      ['/tasks/x/submit', {}],
      ['/surveys/post_task', { responses: {} }],
      ['/events', []],
      ['/debrief'],
    ];
    for (const [path, body] of paths) {
      const url = `/api/sessions/AUTH-1${path}`;
      expect((await api.call(url, body)).status, `no token: ${path}`).toBe(401);
      expect((await api.call(url, body, { auth: 'not-the-token' })).status, `wrong token: ${path}`).toBe(401);
      expect((await api.call(url, body, { auth: other.token })).status, `other participant's token: ${path}`).toBe(401);
    }
    // a token in the URL is not accepted
    expect((await api.call(`/api/sessions/AUTH-1?token=${p.token}`)).status).toBe(401);
    expect((await p.as('')).status).toBe(200);
    expect((await api.call('/api/sessions/NOPE-1', undefined, { auth: p.token })).status).toBe(404);
  });

  it('only hand the token out once and never export it', async () => {
    const p = await participant(api, 'AUTH-3');
    expect((await p.as('')).data.token).toBeUndefined();
    await p.as('/events', [{ id: 'evt_auth3', type: 'step_open', stepIndex: 0, taskId: null }]);

    const all = await api.research('/api/export/all.json');
    expect(all.status).toBe(200);
    expect(all.text).toContain('AUTH-3');
    for (const c of ['participants', 'sessions', 'attempts', 'surveys', 'events', 'technical_issues']) {
      for (const fmt of ['csv', 'json']) {
        const r = await api.research(`/api/export/${c}.${fmt}?demo=1`);
        expect(r.status).toBe(200);
        expect(r.text).not.toContain(p.token);
        expect(r.text).not.toContain('tokenHash');
      }
    }
    expect(all.text).not.toContain(p.token);
    expect(all.data.credentials).toBeUndefined();
    expect((await api.research('/api/export/credentials.json')).status).toBe(404);
    // and only a hash is stored on disk
    for (const f of readdirSync(dataDir)) expect(readFileSync(join(dataDir, f), 'utf8')).not.toContain(p.token);
  });

  it('a re-registered demo ID gets a new token and the old one stops working', async () => {
    const first = await participant(api, 'DEMO-AUTH', { isDemo: true });
    const second = await participant(api, 'DEMO-AUTH', { isDemo: true });
    expect(second.token).not.toBe(first.token);
    expect((await first.as('')).status).toBe(401);
    expect((await second.as('')).status).toBe(200);
  });
});

describe('research key', () => {
  it('is read from the Authorization header, never the query string', async () => {
    for (const path of ['/api/overview', '/api/export/attempts.json', '/api/export/all.json']) {
      expect((await api.call(path)).status).toBe(401);
      expect((await api.call(`${path}?key=test-research-key-123`)).status).toBe(401);
      expect((await api.call(path, undefined, { auth: 'wrong' })).status).toBe(401);
      expect((await api.research(path)).status).toBe(200);
    }
    expect((await api.call('/api/technical-issues', { participantId: 'AUTH-1', taskId: 'x', reason: 'abc', exclude: true })).status).toBe(401);
  });
});

describe('versions', () => {
  it('are stored on participant, session, attempt, survey and event records', async () => {
    const p = await participant(api, 'VER-1');
    await toFirstTask(p);
    await p.as('/events', [{ id: 'evt_ver', type: 'x', stepIndex: 3, taskId: null }]);
    const expected = { studyVersion: STUDY_VERSION, protocolVersion: PROTOCOL_VERSION };
    expect(STUDY_VERSION).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
    for (const c of ['participants', 'sessions', 'attempts', 'events']) {
      const rows = (await api.research(`/api/export/${c}.json`)).data.filter((r: any) => (r.participantId ?? r.id) === 'VER-1');
      expect(rows.length, c).toBeGreaterThan(0);
      for (const r of rows) expect(r, c).toMatchObject(expected);
    }
    const health = await api.call('/api/health');
    expect(health.data).toMatchObject({ ok: true, storage: 'ok', ...expected });
  }, 60000);
});

describe('delayed events', () => {
  it('keep the step, block, position and task they were created on', async () => {
    const p = await participant(api, 'DELAY-1');
    let s = await toFirstTask(p);
    const taskStep = s.stepIndex; // first experimental task: block 0, position 0, direct
    const taskId = s.task.id;
    expect(s.steps[taskStep]).toMatchObject({ kind: 'task', role: 'experimental' });

    await p.as(`/tasks/${taskId}/diagnosis`, { diagnosisText: 'the loop stops one item early' });
    s = (await p.as(`/tasks/${taskId}/submit`, { finalCode: s.task.starterCode, decision: 'reject' })).data.session;
    s = (await p.as('/surveys/post_task', { responses: { confidence: 4, difficulty: 4, helpfulness: 4, effort: 4 } })).data;
    const secondTask = s.task.id;
    expect(s.stepIndex).toBe(taskStep + 2);

    // all of these were queued while offline and arrive two steps later
    const at = new Date().toISOString();
    await p.as('/events', [
      { id: 'evt_d_practice', type: 'tests_run', at, stepIndex: 2, taskId: s.steps[2].taskId },
      { id: 'evt_d_task', type: 'tests_run', at, stepIndex: taskStep, taskId },
      { id: 'evt_d_survey', type: 'step_open', at, stepIndex: taskStep + 1, taskId },
      { id: 'evt_d_instr', type: 'step_open', at, stepIndex: 1, taskId: null },
      // stamps that don't fit are not trusted
      { id: 'evt_d_mismatch', type: 'tests_run', at, stepIndex: 2, taskId },
      { id: 'evt_d_future', type: 'tests_run', at, stepIndex: 40, taskId: secondTask },
      // an event queued by an older version of the app, without a stamp
      { id: 'evt_d_legacy', type: 'tests_run', at, taskId },
      { id: 'evt_d_nothing', type: 'heartbeat', at },
    ]);

    const events = new Map<string, any>((await api.research('/api/export/events.json')).data.map((e: any) => [e.id, e]));
    expect(events.get('evt_d_task')).toMatchObject({
      stepIndex: taskStep,
      stepKind: 'task',
      taskId,
      role: 'experimental',
      condition: 'direct',
      block: 0,
      indexInBlock: 0,
      attribution: 'client',
      receivedAtStepIndex: taskStep + 2,
    });
    expect(events.get('evt_d_practice')).toMatchObject({ stepIndex: 2, role: 'practice', condition: null, block: null, attribution: 'client' });
    expect(events.get('evt_d_survey')).toMatchObject({ stepIndex: taskStep + 1, stepKind: 'post_task', taskId, condition: 'direct', block: 0, attribution: 'client' });
    expect(events.get('evt_d_instr')).toMatchObject({ stepIndex: 1, stepKind: 'instructions', taskId: null, attribution: 'client' });
    expect(events.get('evt_d_mismatch')).toMatchObject({ stepIndex: taskStep, taskId, attribution: 'task' });
    expect(events.get('evt_d_future')).toMatchObject({ stepIndex: taskStep + 2, taskId: secondTask, indexInBlock: 1, attribution: 'task' });
    expect(events.get('evt_d_legacy')).toMatchObject({ stepIndex: taskStep, condition: 'direct', attribution: 'task' });
    expect(events.get('evt_d_nothing')).toMatchObject({ stepIndex: taskStep + 2, attribution: 'current' });
  }, 60000);

  it('replayed events are stored once', async () => {
    const p = await participant(api, 'DELAY-2');
    const e = { id: 'evt_replay_1', type: 'step_open', stepIndex: 0, taskId: null };
    await p.as('/events', [e]);
    await p.as('/events', [e]); // the response to the first send was lost, so the queue sent it again
    const rows = (await api.research('/api/export/events.json')).data.filter((r: any) => r.id === 'evt_replay_1');
    expect(rows).toHaveLength(1);
  });
});

describe('duplicate submissions', () => {
  it('a double-clicked or retried task submit saves one attempt', async () => {
    const p = await participant(api, 'DUP-1');
    const s = await toFirstTask(p);
    const taskId = s.task.id;
    await p.as(`/tasks/${taskId}/diagnosis`, { diagnosisText: 'the loop stops one item early' });
    const body = { finalCode: getTask(taskId).solutionCode, decision: 'reject' };
    const results = await Promise.all([p.as(`/tasks/${taskId}/submit`, body), p.as(`/tasks/${taskId}/submit`, body), p.as(`/tasks/${taskId}/submit`, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    for (const r of results.filter((r) => r.status === 409)) expect(r.data.code).toBe('stale_step');
    const attempts = (await api.research('/api/export/attempts.json')).data.filter((a: any) => a.participantId === 'DUP-1' && a.taskId === taskId);
    expect(attempts).toHaveLength(1);
    expect((await p.as('')).data.steps[(await p.as('')).data.stepIndex].kind).toBe('post_task');
  }, 60000);

  it('a survey sent twice is saved once', async () => {
    const p = await participant(api, 'DUP-2');
    let s = await toFirstTask(p);
    await p.as(`/tasks/${s.task.id}/diagnosis`, { diagnosisText: 'the loop stops one item early' });
    s = (await p.as(`/tasks/${s.task.id}/submit`, { finalCode: s.task.starterCode, decision: 'accept' })).data.session;
    const responses = { confidence: 4, difficulty: 4, helpfulness: 4, effort: 4 };
    const [a, b] = await Promise.all([p.as('/surveys/post_task', { responses }), p.as('/surveys/post_task', { responses })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const surveys = (await api.research('/api/export/surveys.json')).data.filter((r: any) => r.participantId === 'DUP-2' && r.kind === 'post_task');
    expect(surveys).toHaveLength(1);
  }, 60000);
});

describe('incomplete surveys', () => {
  it('are rejected without moving the participant on', async () => {
    const p = await participant(api, 'SURV-1');
    let s = await toFirstTask(p);
    await p.as(`/tasks/${s.task.id}/diagnosis`, { diagnosisText: 'the loop stops one item early' });
    s = (await p.as(`/tasks/${s.task.id}/submit`, { finalCode: s.task.starterCode, decision: 'accept' })).data.session;
    const step = s.stepIndex;

    const missing = await p.as('/surveys/post_task', { responses: { confidence: 4, difficulty: 4 } });
    expect(missing.status).toBe(400);
    expect(missing.data.error).toContain('2 left');
    expect((await p.as('/surveys/post_task', { responses: {} })).status).toBe(400);
    expect((await p.as('/surveys/post_task', {})).status).toBe(400);
    expect((await p.as('/surveys/post_task', { responses: { confidence: 9, difficulty: 4, helpfulness: 4, effort: 4 } })).status).toBe(400);
    expect((await p.as('/surveys/post_task', { responses: { confidence: 'lots', difficulty: 4, helpfulness: 4, effort: 4 } })).status).toBe(400);
    expect((await p.as('')).data.stepIndex).toBe(step);
    expect((await api.research('/api/export/surveys.json')).data.filter((r: any) => r.participantId === 'SURV-1')).toHaveLength(0);

    s = (await p.as('/surveys/post_task', { responses: { confidence: 4, difficulty: 4, helpfulness: 4, effort: 4 } })).data;
    expect(s.stepIndex).toBe(step + 1);
  }, 60000);

  it('post-part and final questionnaires need every required item', async () => {
    const p = await participant(api, 'SURV-2');
    let s = await toFirstTask(p);
    for (let i = 0; i < 2; i++) {
      await p.as(`/tasks/${s.task.id}/diagnosis`, { diagnosisText: 'the loop stops one item early' });
      s = (await p.as(`/tasks/${s.task.id}/submit`, { finalCode: s.task.starterCode, decision: 'accept' })).data.session;
      s = (await p.as('/surveys/post_task', { responses: { confidence: 4, difficulty: 4, helpfulness: 4, effort: 4 } })).data;
    }
    expect(s.steps[s.stepIndex].kind).toBe('post_condition');
    const full = postCondition();
    const { agency_control, ...noAgency } = full;
    expect((await p.as('/surveys/post_condition', { responses: noAgency })).status).toBe(400);
    const { tlx_mental, ...noTlx } = full;
    expect((await p.as('/surveys/post_condition', { responses: noTlx })).status).toBe(400);
    expect((await p.as('/surveys/post_condition', { responses: { ...full, sus_1: 7 } })).status).toBe(400);
    expect((await p.as('/surveys/post_condition', { responses: { ...full, tlx_effort: 120 } })).status).toBe(400);
    expect((await p.as('/surveys/post_condition', { responses: full })).status).toBe(200);
    expect((await p.as('/surveys/final', { responses: { prefer_overall: 'Part 1' } })).status).toBe(409); // not there yet
  }, 60000);
});

describe('reload and restart recovery', () => {
  it('a session resumes with the same token after the server restarts', async () => {
    const p = await participant(api, 'REL-1');
    const s = await toFirstTask(p);
    const taskId = s.task.id;
    await p.as(`/tasks/${taskId}/diagnosis`, { diagnosisText: 'off by one in the loop bound', suspectedLine: 3 });

    // a second server on the same data folder knows nothing in memory
    const restarted = await startServer(dataDir, grader);
    try {
      const as = (path: string, body?: unknown) => restarted.call(`/api/sessions/REL-1${path}`, body, { auth: p.token });
      expect((await restarted.call('/api/sessions/REL-1', undefined, { auth: 'wrong' })).status).toBe(401);
      const view = (await as('')).data;
      expect(view.stepIndex).toBe(s.stepIndex);
      expect(view.task.id).toBe(taskId);
      expect(view.task.advice.student).toEqual({ diagnosisText: 'off by one in the loop bound', suspectedLine: 3 });
      const r = await as(`/tasks/${taskId}/submit`, { finalCode: getTask(taskId).solutionCode, decision: 'reject' });
      expect(r.status).toBe(200);
      expect(r.data.session.steps[r.data.session.stepIndex].kind).toBe('post_task');
    } finally {
      await restarted.close();
    }
  }, 60000);
});

describe('technical issues', () => {
  it('can be recorded, replaced and removed by a researcher', async () => {
    const p = await participant(api, 'TECH-1');
    const s = await toFirstTask(p);
    const taskId = s.task.id;

    const bad = [
      { participantId: 'TECH-1', taskId, reason: 'crash' },
      { participantId: 'TECH-1', taskId, reason: 'x', exclude: true },
      { participantId: 'TECH-1', taskId: 'not-a-task', reason: 'crash', exclude: true },
    ];
    for (const b of bad) expect((await api.research('/api/technical-issues', b)).status).toBe(400);
    expect((await api.research('/api/technical-issues', { participantId: 'NOBODY', taskId, reason: 'crash', exclude: true })).status).toBe(404);

    const r = await api.research('/api/technical-issues', { participantId: 'TECH-1', taskId, reason: 'Python failed to load', exclude: false });
    expect(r.status).toBe(200);
    expect(r.data).toMatchObject({ participantId: 'TECH-1', taskId, role: 'experimental', condition: 'direct', block: 0, exclude: false, studyVersion: STUDY_VERSION });
    // a second record for the same task replaces the first
    await api.research('/api/technical-issues', { participantId: 'TECH-1', taskId, reason: 'Laptop restarted mid-task', exclude: true });

    let overview = (await api.research('/api/overview')).data;
    const issues = overview.issues.filter((i: any) => i.participantId === 'TECH-1');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ reason: 'Laptop restarted mid-task', exclude: true });
    expect(overview.progress.find((x: any) => x.id === 'TECH-1').issues).toHaveLength(1);

    expect((await api.research(`/api/technical-issues/TECH-1/${taskId}`, undefined, 'DELETE')).status).toBe(200);
    expect((await api.research(`/api/technical-issues/TECH-1/${taskId}`, undefined, 'DELETE')).status).toBe(404);
    overview = (await api.research('/api/overview')).data;
    expect(overview.issues.filter((i: any) => i.participantId === 'TECH-1')).toHaveLength(0);
  }, 60000);

  it('excluded attempts are dropped from the analysis and every exclusion is reported', () => {
    const a = (participantId: string, taskId: string) => ({ participantId, taskId }) as TaskAttempt;
    const attempts = [a('P1', 't1'), a('P1', 't2'), a('P2', 't1')];
    const issue = (participantId: string, taskId: string, exclude: boolean, removed = false) => ({
      id: `${participantId}::${taskId}`,
      participantId,
      taskId,
      role: 'experimental',
      condition: 'direct',
      reason: `issue ${participantId}`,
      exclude,
      removed,
      recordedAt: '2026-01-01T00:00:00.000Z',
    });
    const { kept, exclusions, flaggedKept } = applyExclusions(
      attempts,
      [issue('P1', 't1', true), issue('P2', 't1', false), issue('P2', 't2', true, true), issue('P1', 't9', true), issue('P3', 't1', true)],
      new Set(['P1', 'P2']),
    );
    expect(kept).toEqual([a('P1', 't2'), a('P2', 't1')]);
    expect(exclusions.map((e) => [e.participantId, e.taskId, e.status])).toEqual([
      ['P1', 't1', 'excluded'],
      ['P1', 't9', 'no attempt saved'],
      ['P3', 't1', 'participant not completed'],
    ]);
    expect(flaggedKept.map((i) => i.participantId)).toEqual(['P2']);
  });

  it('the analysis script applies and lists the exclusions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'calibra-analysis-'));
    const out = join(dir, 'out');
    try {
      const store = new Store(dir);
      const conds = ['direct', 'always', 'adaptive'] as const;
      for (const pid of ['A1', 'A2']) {
        store.append('participants', [{ id: pid, orderIndex: 0, conditionOrder: conds, completedAt: '2026-01-01T01:00:00.000Z', isDemo: false }]);
        conds.forEach((c, block) => {
          for (const i of [0, 1]) {
            store.append('attempts', [
              {
                id: `${pid}-${c}-${i}`,
                participantId: pid,
                isDemo: false,
                role: 'experimental',
                taskId: `${c}-${i}`,
                condition: c,
                block,
                indexInBlock: i,
                aiCorrectness: i === 0 ? 'correct' : 'incorrect',
                reliance: 'appropriate',
                finalCorrect: true,
                hiddenPassed: 1,
                hiddenTotal: 1,
                completionMs: 60000,
                testRunsAfterAdvice: 1,
                evidenceViews: 0,
                verificationCorrect: null,
              },
            ]);
          }
        });
      }
      store.append('participants', [{ id: 'A3', orderIndex: 1, conditionOrder: conds, isDemo: false }]);
      store.append('technical_issues', [
        { id: 'A1::always-1', participantId: 'A1', taskId: 'always-1', role: 'experimental', condition: 'always', reason: 'Wi-Fi dropped during the task', exclude: true, removed: false, recordedAt: '2026-01-02T00:00:00.000Z', isDemo: false },
        { id: 'A2::direct-0', participantId: 'A2', taskId: 'direct-0', role: 'experimental', condition: 'direct', reason: 'Fire alarm', exclude: false, removed: false, recordedAt: '2026-01-02T00:00:00.000Z', isDemo: false },
      ]);

      execFileSync(process.execPath, ['--import', 'tsx', 'analysis/analyze.ts', dir, `--out=${out}`], { stdio: 'pipe' });
      const summary = readFileSync(join(out, 'summary.md'), 'utf8');
      expect(summary).toContain('## Exclusions');
      expect(summary).toContain('Attempts excluded for technical issues: **1**');
      expect(summary).toContain('| A1 | always-1 | experimental | Always Verify | Wi-Fi dropped during the task |');
      expect(summary).toContain('kept in the analysis: 1 (A2/direct-0)');
      expect(summary).toContain('Participants who did not finish are left out: 1 (A3)');
      expect(readFileSync(join(out, 'exclusions.csv'), 'utf8')).toContain('A1,always-1,experimental,always,Wi-Fi dropped during the task');
      const rows = readFileSync(join(out, 'participant_condition.csv'), 'utf8').split('\n');
      const header = rows[0].split(',');
      const tasks = (pid: string, c: string) => rows.map((r) => r.split(',')).find((r) => r[0] === pid && r[header.indexOf('condition')] === c)?.[header.indexOf('tasks')];
      expect(tasks('A1', 'always')).toBe('1');
      expect(tasks('A1', 'direct')).toBe('2');
      expect(tasks('A2', 'direct')).toBe('2');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});

describe('researcher overview', () => {
  it('shows progress, current step, last activity, warnings, balance and versions', async () => {
    const p = await participant(api, 'OVR-1');
    const s = await toFirstTask(p);
    const o = (await api.research('/api/overview')).data;
    expect(o.server).toEqual({ studyVersion: STUDY_VERSION, protocolVersion: PROTOCOL_VERSION });
    const row = o.progress.find((x: any) => x.id === 'OVR-1');
    expect(row.current).toMatchObject({ index: s.stepIndex, kind: 'task', role: 'experimental', part: 1, condition: 'direct', taskId: s.task.id });
    expect(Date.now() - Date.parse(row.lastActivity)).toBeLessThan(60000);
    expect(row.studyVersion).toBe(STUDY_VERSION);
    // no events were sent for the practice task in this test
    expect(row.warnings).toContain(`No interaction events for ${s.steps[2].taskId}`);
    expect(row.tasks.filter((t: any) => t.reached).map((t: any) => t.taskId)).toEqual([s.steps[2].taskId, s.task.id]);
    expect(o.pairs).toHaveLength(3);
    const started = o.pairs.reduce((n: number, p: any) => n + p.byCondition.direct.started, 0);
    expect(started).toBe(o.participants);
    expect(o.versions.find((v: any) => v.version === `${STUDY_VERSION} / ${PROTOCOL_VERSION}`).participants).toBeGreaterThan(0);

    expect(row.warnings.some((w: string) => w.startsWith('No activity'))).toBe(false);

    // the same data seen an hour later flags the unfinished session as inactive
    const later = new Researcher(new Store(dataDir), new Study(new Store(dataDir), grader)).overview(false, Date.now() + 60 * 60 * 1000);
    expect(later.progress.find((x) => x.id === 'OVR-1')!.warnings.some((w) => w.startsWith('No activity for 60 minutes'))).toBe(true);
  }, 60000);
});

describe('runtime failure recovery', () => {
  it('the grader comes back after its process dies', async () => {
    grader.stop();
    await new Promise((ok) => setTimeout(ok, 200));
    const r = await grader.run('def f():\n    return 2', [{ name: 'ok', call: 'f()', expected: '2' }]);
    expect(r[0].passed).toBe(true);
    const health = await api.call('/api/health');
    expect(health.status).toBe(200);
    expect(health.data.grader).toBe('ready');
  }, 60000);
});

describe('startup validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'calibra-config-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const problems = (env: Record<string, string>) => {
    try {
      loadConfig({ DATA_DIR: dir, ...env });
      return [];
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      return (e as ConfigError).problems;
    }
  };

  it('accepts a development setup and warns about open exports', () => {
    const { config, warnings } = loadConfig({ DATA_DIR: dir, PORT: '4000' });
    expect(config).toMatchObject({ port: 4000, dataDir: dir, production: false });
    expect(warnings.some((w) => w.includes('RESEARCH_KEY'))).toBe(true);
  });

  it('refuses to start production without a strong key or a build', () => {
    expect(problems({ NODE_ENV: 'production', STATIC_DIR: join(dir, 'nope') }).join('\n')).toMatch(/RESEARCH_KEY is required[\s\S]*index\.html/);
    expect(problems({ NODE_ENV: 'production', RESEARCH_KEY: 'short' }).join('\n')).toContain('at least 16');
    expect(problems({ PORT: 'abc' }).join('\n')).toContain('PORT');
  });

  it('refuses a data folder it cannot create', () => {
    // a file sits where the folder should be
    new Store(dir).append('events', [{ id: 'x' }]);
    expect(problems({ DATA_DIR: join(dir, 'events.jsonl', 'sub') }).join('\n')).toContain('DATA_DIR');
  });
});
