import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildPlan, ORDERS } from '../src/study/plan';
import { compareDiagnosis, supportFor } from '../src/study/adaptive';
import { classifyReliance } from '../src/study/reliance';
import { PROFICIENCY_QUESTIONS, rawTlx, scoreProficiency, susScore, AGENCY_ITEMS, POST_TASK_ITEMS, SUS_ITEMS, TLX_ITEMS } from '../src/study/questionnaires';
import { getTask, TASKS, visibleTests } from '../src/study/tasks';
import type {
  AdaptiveSignals,
  Condition,
  Decision,
  Participant,
  StudyPlan,
  SupportPlan,
  TaskAttempt,
  TaskDef,
  TestResult,
  VerificationActivity,
} from '../src/study/types';
import type { Grader } from './grader';
import type { Store } from './store';
import { newId } from '../src/lib/id';
import { versions } from './version';

export class StudyError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // Lets the browser tell "this step is already done" apart from other conflicts.
    readonly code?: 'stale_step',
  ) {
    super(message);
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest();

// What the browser is told about each step. Conditions are left out on purpose.
export type Step =
  | { kind: 'proficiency' }
  | { kind: 'instructions' }
  | { kind: 'task'; taskId: string; role: 'practice' | 'experimental' | 'transfer'; part: number | null; index: number }
  | { kind: 'post_task'; taskId: string; role: 'experimental' | 'transfer'; part: number | null }
  | { kind: 'post_condition'; part: number }
  | { kind: 'final' }
  | { kind: 'debrief' };

export type InternalStep = Step & { condition: Condition | null; block: number | null; indexInBlock: number };

interface CurrentTask {
  taskId: string;
  startedAt: string;
  diagnosisAt: string | null;
  diagnosisText: string;
  suspectedLine: number | null;
  signals: AdaptiveSignals | null;
  support: SupportPlan | null;
  verificationAnswer: string | null;
  verificationCorrect: boolean | null;
  verificationDoneAt: string | null;
}

interface Session {
  id: string;
  participant: Participant;
  steps: InternalStep[];
  stepIndex: number;
  current: CurrentTask | null;
}

export function buildSteps(plan: StudyPlan): InternalStep[] {
  const none = { condition: null, block: null, indexInBlock: 0 };
  const steps: InternalStep[] = [
    { kind: 'proficiency', ...none },
    { kind: 'instructions', ...none },
    { kind: 'task', taskId: plan.practice.taskId, role: 'practice', part: null, index: 0, ...none },
  ];
  plan.blocks.forEach((b, bi) => {
    const part = bi + 1;
    b.tasks.forEach((t, ti) => {
      const at = { condition: b.condition, block: bi, indexInBlock: ti };
      steps.push({ kind: 'task', taskId: t.taskId, role: 'experimental', part, index: ti + 1, ...at });
      steps.push({ kind: 'post_task', taskId: t.taskId, role: 'experimental', part, ...at });
    });
    steps.push({ kind: 'post_condition', part, condition: b.condition, block: bi, indexInBlock: 0 });
  });
  steps.push({ kind: 'task', taskId: plan.transfer.taskId, role: 'transfer', part: null, index: 0, ...none });
  steps.push({ kind: 'post_task', taskId: plan.transfer.taskId, role: 'transfer', part: null, ...none });
  steps.push({ kind: 'final', ...none }, { kind: 'debrief', ...none });
  return steps;
}

const publicStep = ({ condition, block, indexInBlock, ...s }: InternalStep): Step => s as Step;

// Same option order for everyone, but not the order the answer key was written in.
function stableShuffle(options: string[], seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const out = [...options];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const EVIDENCE_OPTIONS = [
  'The evidence supports the suggestion',
  'The evidence contradicts the suggestion',
  "The evidence is mixed or I can't tell",
];

interface CheckDef {
  activity: VerificationActivity;
  question: string;
  options: string[];
  answer: string | null; // null means there is no right answer to give feedback on
  feedback: string | null;
  lineNumber?: number;
  call?: string;
}

function checkFor(activity: VerificationActivity, task: TaskDef): CheckDef | null {
  const ev = task.evidence;
  if (activity === 'evidence_check') {
    return {
      activity,
      question: 'Look at the evidence next to the suggestion. What does it tell you about the AI suggestion?',
      options: EVIDENCE_OPTIONS,
      answer: null,
      feedback: null,
    };
  }
  if (activity === 'failing_test' && ev.failingTestCheck) {
    const c = ev.failingTestCheck;
    return { activity, question: c.question, options: c.options, answer: c.answer, feedback: `The failing test shows: ${c.answer}.` };
  }
  if (activity === 'suspicious_line' && ev.suspiciousLineCheck) {
    const c = ev.suspiciousLineCheck;
    return { activity, question: c.question, options: c.options, answer: c.answer, feedback: `What can go wrong on line ${c.line}: ${c.answer}.`, lineNumber: c.line };
  }
  if (activity !== 'none' && ev.prediction) {
    const c = ev.prediction;
    return {
      activity: 'predict_output',
      question: c.question,
      options: c.options,
      answer: c.answer,
      feedback: `With the suggested patch, ${c.call} returns ${c.answer}.`,
      call: c.call,
    };
  }
  return null;
}

// The browser already asks for every required answer. This stops a stale tab
// or a hand-made request from storing a half-filled questionnaire.
function surveyProblem(kind: 'post_task' | 'post_condition' | 'final', st: InternalStep, r: Record<string, unknown>) {
  const items: { id: string; min: number; max: number }[] = [];
  if (kind === 'post_task') {
    const transfer = 'role' in st && st.role === 'transfer';
    for (const i of POST_TASK_ITEMS) if (!(transfer && i.ai)) items.push({ id: i.id, min: 1, max: 7 });
  }
  if (kind === 'post_condition') {
    for (const i of TLX_ITEMS) items.push({ id: i.id, min: 0, max: 100 });
    for (const i of SUS_ITEMS) items.push({ id: i.id, min: 1, max: 5 });
    for (const i of AGENCY_ITEMS) items.push({ id: i.id, min: 1, max: 7 });
  }
  const choices = kind === 'final' ? ['prefer_overall', 'prefer_trust', 'prefer_least_effort'] : [];
  const missing = [...items.map((i) => i.id), ...choices].filter((k) => r[k] == null || r[k] === '').length;
  if (missing) return `Please answer every question (${missing} left).`;
  const outside = items.some((i) => {
    const v = Number(r[i.id]);
    return !Number.isFinite(v) || v < i.min || v > i.max;
  });
  if (outside || choices.some((k) => !/^Part [1-3]$/.test(String(r[k])))) return 'Some answers are outside the scale. Please check them and try again.';
  return null;
}

export class Study {
  private sessions = new Map<string, Session>();
  private patchResults = new Map<string, TestResult[]>();
  private tokens = new Map<string, Buffer>();
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private store: Store,
    private grader: Grader,
  ) {}

  proficiencyQuestions() {
    return PROFICIENCY_QUESTIONS.map(({ answer, ...q }) => q);
  }

  // ---- sessions ----

  register(input: Partial<Participant> & { orderOverride?: number }) {
    const id = String(input.id ?? '').trim();
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(id)) throw new StudyError(400, 'Use 3 to 32 letters, numbers, dashes or underscores for the participant ID.');
    if (!input.consent) throw new StudyError(400, 'Consent is required to take part.');
    const isDemo = Boolean(input.isDemo);
    const existing = this.store.read('participants').find((r) => r.id === id);
    if (existing && !(existing.isDemo && isDemo)) throw new StudyError(409, 'This participant ID is already in use. Please use a different one.');

    let orderIndex = Number.isInteger(input.orderOverride) ? ((input.orderOverride! % 6) + 6) % 6 : undefined;
    if (orderIndex == null) {
      // Least used order so far, so dropouts don't unbalance the design. Demo sessions don't count.
      const counts = ORDERS.map(() => 0);
      for (const r of this.store.read('participants')) if (!r.isDemo && typeof r.orderIndex === 'number') counts[r.orderIndex]++;
      orderIndex = counts.indexOf(Math.min(...counts));
    }
    const plan = buildPlan(orderIndex, TASKS);
    const participant: Participant = {
      id,
      createdAt: new Date().toISOString(),
      isDemo,
      yearOfStudy: String(input.yearOfStudy ?? ''),
      experience: String(input.experience ?? ''),
      pythonConfidence: Number(input.pythonConfidence ?? 0),
      aiToolUse: String(input.aiToolUse ?? ''),
      consent: true,
      orderIndex: plan.orderIndex,
      conditionOrder: plan.conditionOrder,
      ...versions(),
    };
    const session: Session = { id, participant, steps: buildSteps(plan), stepIndex: 0, current: null };
    this.sessions.set(id, session);
    this.store.append('participants', [{ ...participant, pairByCondition: plan.pairByCondition }]);
    this.persist(session);
    // Only a hash is stored, in a collection that is never exported.
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    this.store.append('credentials', [{ id, tokenHash: tokenHash.toString('hex'), createdAt: participant.createdAt }]);
    this.tokens.set(id, tokenHash);
    return { ...this.view(session), token };
  }

  // Every participant endpoint needs the token handed out at registration,
  // so knowing (or guessing) a participant ID isn't enough to act as them.
  authorize(id: string, token: string | undefined) {
    this.get(id);
    let expected = this.tokens.get(id);
    if (!expected) {
      const row = this.store.read('credentials').find((r) => r.id === id);
      if (row) this.tokens.set(id, (expected = Buffer.from(String(row.tokenHash), 'hex')));
    }
    // A damaged credentials row has the wrong length, and timingSafeEqual would throw on it.
    if (!token || expected?.length !== 32 || !timingSafeEqual(hashToken(token), expected)) {
      throw new StudyError(401, 'This browser is not signed in to that study session. Please ask the researcher for help.');
    }
  }

  // Requests for one session run one at a time. Without this, a double click or
  // a retried request can pass the step check twice while the grader is busy.
  exclusive<T>(id: string, fn: () => T | Promise<T>): Promise<T> {
    const run = (this.locks.get(id) ?? Promise.resolve()).catch(() => {}).then(fn);
    this.locks.set(id, run);
    run.finally(() => this.locks.get(id) === run && this.locks.delete(id)).catch(() => {});
    return run;
  }

  // For the researcher dashboard and technical-issue records.
  progress(id: string) {
    const s = this.get(id);
    return { participant: s.participant, steps: s.steps, stepIndex: s.stepIndex };
  }

  private persist(s: Session) {
    this.store.append('sessions', [{ id: s.id, participantId: s.id, isDemo: s.participant.isDemo, stepIndex: s.stepIndex, current: s.current, ...versions() }]);
  }

  // After a server restart, rebuild the session from what was saved.
  private get(id: string): Session {
    const cached = this.sessions.get(id);
    if (cached) return cached;
    const p = this.store.read('participants').find((r) => r.id === id) as unknown as Participant | undefined;
    if (!p || typeof p.orderIndex !== 'number') throw new StudyError(404, 'No study session with this ID.');
    const saved = this.store.read('sessions').find((r) => r.id === id) as { stepIndex?: number; current?: CurrentTask | null } | undefined;
    const session: Session = {
      id,
      participant: p,
      steps: buildSteps(buildPlan(p.orderIndex, TASKS)),
      stepIndex: saved?.stepIndex ?? 0,
      current: saved?.current ?? null,
    };
    this.sessions.set(id, session);
    return session;
  }

  private step(s: Session) {
    return s.steps[s.stepIndex];
  }

  private expect(s: Session, kind: Step['kind'], taskId?: string) {
    const st = this.step(s);
    if (st.kind !== kind || (taskId && 'taskId' in st && st.taskId !== taskId)) {
      throw new StudyError(409, 'This step is no longer active. Reload the page to continue where you left off.', 'stale_step');
    }
    return st;
  }

  private advance(s: Session) {
    s.stepIndex = Math.min(s.stepIndex + 1, s.steps.length - 1);
    s.current = null;
    if (this.step(s).kind === 'debrief' && !s.participant.completedAt) {
      s.participant.completedAt = new Date().toISOString();
      this.store.append('participants', [{ id: s.id, completedAt: s.participant.completedAt }]);
    }
    this.persist(s);
  }

  view(s: Session | string) {
    const session = typeof s === 'string' ? this.get(s) : s;
    const step = this.step(session);
    const view: Record<string, unknown> = {
      participantId: session.id,
      isDemo: session.participant.isDemo,
      steps: session.steps.map(publicStep),
      stepIndex: session.stepIndex,
      task: step.kind === 'task' ? this.taskView(session) : null,
    };
    if (session.participant.isDemo) {
      view.demo = {
        conditionOrder: session.participant.conditionOrder,
        orderIndex: session.participant.orderIndex,
        proficiency: session.participant.proficiency ?? null,
        stepCondition: step.condition,
      };
    }
    return view;
  }

  // ---- proficiency and instructions ----

  submitProficiency(id: string, answers: Record<string, string>) {
    const s = this.get(id);
    this.expect(s, 'proficiency');
    const { score, level } = scoreProficiency(answers ?? {});
    Object.assign(s.participant, { proficiencyScore: score, proficiency: level, proficiencyAnswers: answers });
    this.store.append('participants', [{ id, proficiencyScore: score, proficiency: level, proficiencyAnswers: answers }]);
    this.advance(s);
    return this.view(s);
  }

  finishInstructions(id: string) {
    const s = this.get(id);
    this.expect(s, 'instructions');
    this.advance(s);
    return this.view(s);
  }

  // ---- tasks ----

  private taskView(s: Session) {
    const st = this.step(s) as Extract<InternalStep, { kind: 'task' }>;
    const task = getTask(st.taskId);
    if (!s.current || s.current.taskId !== task.id) {
      s.current = {
        taskId: task.id,
        startedAt: new Date().toISOString(),
        diagnosisAt: null,
        diagnosisText: '',
        suspectedLine: null,
        signals: null,
        support: null,
        verificationAnswer: null,
        verificationDoneAt: null,
        verificationCorrect: null,
      };
      this.persist(s);
    }
    return {
      id: task.id,
      role: st.role,
      title: task.title,
      functionName: task.functionName,
      objective: task.objective,
      expected: task.expected,
      examples: task.examples,
      constraints: task.constraints,
      starterCode: task.starterCode,
      visibleTests: visibleTests(task).map(({ name, call, expected }) => ({ name, call, expected })),
      hiddenTestCount: task.tests.length - visibleTests(task).length,
      hasAi: st.role !== 'transfer' && Boolean(task.advice),
      // Lets a reload pick up after the diagnosis without asking for it again.
      advice: s.current.support ? this.advicePayload(s, task) : null,
    };
  }

  private async patchTests(task: TaskDef) {
    if (!task.patchCode) return [];
    let r = this.patchResults.get(task.id);
    if (!r) {
      r = await this.grader.run(task.patchCode, visibleTests(task));
      this.patchResults.set(task.id, r);
    }
    return r;
  }

  private lastAiAttempt(id: string) {
    const rows = this.store.read('attempts').filter((a) => a.participantId === id && a.decision) as unknown as TaskAttempt[];
    return rows.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).at(-1);
  }

  async diagnose(id: string, taskId: string, body: { diagnosisText?: string; suspectedLine?: number | null }) {
    const s = this.get(id);
    const st = this.expect(s, 'task', taskId) as Extract<InternalStep, { kind: 'task' }>;
    const task = getTask(taskId);
    if (st.role === 'transfer' || !task.advice) throw new StudyError(400, 'This task has no AI suggestion.');
    const cur = s.current!;
    if (!cur.support) {
      const text = String(body.diagnosisText ?? '').trim();
      if (text.length < 10) throw new StudyError(400, 'Write a short diagnosis (at least 10 characters) before asking for the AI suggestion.');
      const line = body.suspectedLine == null ? null : Number(body.suspectedLine);
      const last = this.lastAiAttempt(id);
      const patchResults = await this.patchTests(task);
      const passed = patchResults.filter((r) => r.passed).length;
      const { disagreement, uncertain } = compareDiagnosis(line, task.advice.targetLines);
      const signals: AdaptiveSignals = {
        // Prefer the configured value so the study stays deterministic, but fall back to a real run.
        patchEvidence: task.patchVisible ?? (passed === patchResults.length ? 'pass' : passed === 0 ? 'fail' : 'partial'),
        staticWarnings: task.evidence.staticWarnings.length,
        disagreement,
        uncertain,
        difficulty: task.difficulty,
        proficiency: s.participant.proficiency ?? 'intermediate',
        recentUncritical: Boolean(last && last.decision === 'accept' && last.testRunsAfterAdvice === 0 && last.evidenceViews === 0 && !last.verificationDoneAt),
      };
      Object.assign(cur, {
        diagnosisText: text,
        suspectedLine: line,
        diagnosisAt: new Date().toISOString(),
        signals,
        support: supportFor(st.role === 'practice' ? 'practice' : st.condition!, signals, task),
      });
      this.persist(s);
    }
    return { ...this.advicePayload(s, task), patchTests: await this.evidenceTests(s, task) };
  }

  private async evidenceTests(s: Session, task: TaskDef) {
    if (!s.current?.support?.showEvidence) return null;
    return (await this.patchTests(task)).map(({ name, call, expected, actual, passed }) => ({ name, call, expected, actual, passed }));
  }

  private advicePayload(s: Session, task: TaskDef) {
    const cur = s.current!;
    const support = cur.support!;
    const check = checkFor(support.activity, task);
    const checkDone = cur.verificationDoneAt != null;
    const withheld = support.patchWithheld && !checkDone;
    const payload: Record<string, unknown> = {
      diagnosis: task.advice!.diagnosis,
      rationale: task.advice!.rationale,
      targetLines: task.advice!.targetLines,
      patch: withheld ? null : task.patchCode,
      patchWithheld: withheld,
      showComparison: support.showComparison,
      showEvidence: support.showEvidence,
      // Low support keeps the evidence one click away instead of open.
      evidenceOpen: support.showEvidence && support.level !== 'low',
      staticWarnings: support.showEvidence ? task.evidence.staticWarnings : [],
      student: { diagnosisText: cur.diagnosisText, suspectedLine: cur.suspectedLine },
      check: check && {
        activity: check.activity,
        question: check.question,
        options: stableShuffle(check.options, task.id + check.question),
        lineNumber: check.lineNumber ?? null,
        lineText: check.lineNumber && task.patchCode ? task.patchCode.split('\n')[check.lineNumber - 1] ?? null : null,
        call: check.call ?? null,
      },
      checkDone,
      checkFeedback: checkDone ? this.feedback(cur, check) : null,
    };
    if (s.participant.isDemo) {
      payload.demo = { condition: support.condition, level: support.level, score: support.score, reasons: support.reasons, activity: support.activity };
    }
    return payload;
  }

  private feedback(cur: CurrentTask, check: CheckDef | null) {
    if (!check || check.answer == null) return { correct: null, text: 'Thanks, your answer is recorded.' };
    return { correct: cur.verificationCorrect, text: check.feedback };
  }

  async verify(id: string, taskId: string, answer: string) {
    const s = this.get(id);
    this.expect(s, 'task', taskId);
    const task = getTask(taskId);
    const cur = s.current!;
    if (!cur.support) throw new StudyError(409, 'Submit your diagnosis first.');
    const check = checkFor(cur.support.activity, task);
    if (!check) throw new StudyError(400, 'No check is needed for this suggestion.');
    if (!check.options.includes(answer)) throw new StudyError(400, 'Choose one of the options.');
    if (!cur.verificationDoneAt) {
      cur.verificationAnswer = answer;
      // For the evidence check, "right" means matching what the evidence actually says.
      cur.verificationCorrect =
        check.answer != null
          ? answer === check.answer
          : answer === EVIDENCE_OPTIONS[task.advice!.correctness === 'correct' ? 0 : 1];
      cur.verificationDoneAt = new Date().toISOString();
      this.persist(s);
    }
    return { ...this.advicePayload(s, task), patchTests: await this.evidenceTests(s, task) };
  }

  async submit(
    id: string,
    taskId: string,
    body: {
      finalCode?: string;
      decision?: Decision | null;
      decisionHistory?: { decision: Decision; at: string }[];
      counters?: Partial<Record<'codeRuns' | 'testRuns' | 'testRunsAfterAdvice' | 'evidenceViews' | 'edits', number>>;
      adviceShownAt?: string | null;
    },
  ) {
    const s = this.get(id);
    const st = this.expect(s, 'task', taskId) as Extract<InternalStep, { kind: 'task' }>;
    const task = getTask(taskId);
    const cur = s.current!;
    const finalCode = String(body.finalCode ?? '').replace(/\r\n/g, '\n');
    const hasAi = st.role !== 'transfer' && Boolean(task.advice);
    const decision = hasAi ? (body.decision ?? null) : null;
    if (hasAi && !cur.support) throw new StudyError(409, 'Write your diagnosis and look at the AI suggestion before submitting.');
    if (hasAi && !decision) throw new StudyError(400, 'Choose Accept, Edit or Reject before submitting.');
    if (hasAi && cur.support!.activity !== 'none' && !cur.verificationDoneAt) throw new StudyError(400, 'Complete the check next to the suggestion first.');

    const results = await this.grader.run(finalCode, task.tests);
    const vis = results.filter((r) => !r.hidden);
    const hid = results.filter((r) => r.hidden);
    const finalCorrect = results.every((r) => r.passed);
    const now = new Date().toISOString();
    const c = body.counters ?? {};
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const history = Array.isArray(body.decisionHistory) ? body.decisionHistory : [];

    const attempt: TaskAttempt = {
      id: newId('att_'),
      participantId: id,
      isDemo: s.participant.isDemo,
      role: st.role,
      taskId,
      condition: st.condition,
      block: st.block,
      indexInBlock: st.indexInBlock,
      difficulty: task.difficulty,
      bugType: task.bugType,
      aiCorrectness: hasAi ? task.advice!.correctness : null,
      startedAt: cur.startedAt,
      diagnosisAt: cur.diagnosisAt,
      adviceShownAt: hasAi ? (body.adviceShownAt ?? cur.diagnosisAt) : null,
      verificationStartedAt: cur.support && cur.support.activity !== 'none' ? cur.diagnosisAt : null,
      verificationDoneAt: cur.verificationDoneAt,
      decisionAt: history.at(-1)?.at ?? null,
      submittedAt: now,
      completionMs: Date.parse(now) - Date.parse(cur.startedAt),
      diagnosisText: cur.diagnosisText,
      suspectedLine: cur.suspectedLine,
      signals: cur.signals,
      support: cur.support,
      verificationAnswer: cur.verificationAnswer,
      verificationCorrect: cur.verificationCorrect,
      decision,
      decisionHistory: history,
      finalCode,
      finalMatchesPatch: task.patchCode ? finalCode.trim() === task.patchCode.trim() : null,
      visiblePassed: vis.filter((r) => r.passed).length,
      visibleTotal: vis.length,
      hiddenPassed: hid.filter((r) => r.passed).length,
      hiddenTotal: hid.length,
      finalCorrect,
      reliance: hasAi ? classifyReliance(task.advice!.correctness, decision, finalCorrect) : 'none',
      codeRuns: num(c.codeRuns),
      testRuns: num(c.testRuns),
      testRunsAfterAdvice: num(c.testRunsAfterAdvice),
      evidenceViews: num(c.evidenceViews),
      edits: num(c.edits),
      ...versions(),
    };
    this.store.append('attempts', [attempt]);
    this.advance(s);
    // Hidden results stay on the server; the participant only learns about visible tests.
    return { visiblePassed: attempt.visiblePassed, visibleTotal: attempt.visibleTotal, session: this.view(s) };
  }

  // ---- surveys ----

  submitSurvey(id: string, kind: 'post_task' | 'post_condition' | 'final', responses: Record<string, number | string>) {
    const s = this.get(id);
    const st = this.expect(s, kind);
    responses = responses && typeof responses === 'object' ? responses : {};
    const problem = surveyProblem(kind, st, responses);
    if (problem) throw new StudyError(400, problem);
    const scores: Record<string, number> = {};
    if (kind === 'post_condition') {
      scores.rawTlx = rawTlx(responses);
      scores.sus = susScore(responses);
      const agency = AGENCY_ITEMS.map((i) => Number(responses[i.id])).filter((v) => Number.isFinite(v));
      if (agency.length) scores.agencyMean = Math.round((agency.reduce((a, b) => a + b, 0) / agency.length) * 100) / 100;
      if (Object.values(scores).some((v) => !Number.isFinite(v))) throw new StudyError(400, 'Please answer every question.');
    }
    if (kind === 'final') {
      // Participants answer in terms of "Part 2"; store which condition that was too.
      responses = { ...responses };
      for (const [k, v] of Object.entries(responses)) {
        const m = /^Part (\d)$/.exec(String(v));
        if (k.startsWith('prefer_') && m) responses[`${k}_condition`] = s.participant.conditionOrder?.[Number(m[1]) - 1] ?? '';
      }
    }
    this.store.append('surveys', [
      {
        id: newId('srv_'),
        participantId: id,
        isDemo: s.participant.isDemo,
        kind,
        condition: st.condition,
        block: st.block,
        taskId: 'taskId' in st ? st.taskId : null,
        responses,
        scores,
        submittedAt: new Date().toISOString(),
        ...versions(),
      },
    ]);
    this.advance(s);
    return this.view(s);
  }

  // ---- events ----

  logEvents(id: string, events: { id?: string; type?: string; at?: string; taskId?: string | null; stepIndex?: number; payload?: Record<string, unknown> }[]) {
    const s = this.get(id);
    const rows = events.slice(0, 500).map((e) => {
      const { stepIndex, attribution } = this.attribute(s, e);
      const st = s.steps[stepIndex];
      return {
        id: String(e.id ?? newId('evt_')),
        participantId: id,
        isDemo: s.participant.isDemo,
        type: String(e.type ?? 'unknown'),
        at: String(e.at ?? new Date().toISOString()),
        // These describe the step the event happened on, which is earlier than the
        // current one when the event waited in the browser's queue.
        // Conditions are attached here because the browser never knows them.
        stepIndex,
        stepKind: st.kind,
        taskId: 'taskId' in st ? st.taskId : null,
        role: 'role' in st ? st.role : null,
        condition: st.condition,
        block: st.block,
        indexInBlock: st.indexInBlock,
        attribution,
        receivedAtStepIndex: s.stepIndex,
        payload: e.payload ?? {},
        ...versions(),
      };
    });
    this.store.append('events', rows);
    return rows.length;
  }

  // The browser stamps each event with the step it was created on. The stamp is
  // used if that step has been reached and matches the event's task. Events
  // queued by an older version of the app have no stamp, so fall back to the
  // task's step, and only then to the current step.
  private attribute(s: Session, e: { taskId?: string | null; stepIndex?: number }) {
    const taskId = e.taskId ?? null;
    const n = e.stepIndex;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= s.stepIndex) {
      const st = s.steps[n];
      if (taskId == null || ('taskId' in st && st.taskId === taskId)) return { stepIndex: n, attribution: 'client' as const };
    }
    const byTask = taskId == null ? -1 : s.steps.findIndex((st) => st.kind === 'task' && st.taskId === taskId);
    if (byTask >= 0) return { stepIndex: byTask, attribution: 'task' as const };
    return { stepIndex: s.stepIndex, attribution: 'current' as const };
  }

  // ---- debrief ----

  debrief(id: string) {
    const s = this.get(id);
    this.expect(s, 'debrief');
    const done = new Set(
      this.store
        .read('attempts')
        .filter((a) => a.participantId === id)
        .map((a) => a.taskId),
    );
    const tasks = s.steps
      .filter((st): st is Extract<InternalStep, { kind: 'task' }> => st.kind === 'task' && st.role === 'experimental')
      .map((st) => {
        const t = getTask(st.taskId);
        return { title: t.title, part: st.part, aiWasCorrect: t.advice!.correctness === 'correct', explanation: t.advice!.note, completed: done.has(t.id) };
      });
    return { tasks, conditionOrder: s.participant.isDemo ? s.participant.conditionOrder : undefined };
  }
}
