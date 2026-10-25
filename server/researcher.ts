import { CONDITIONS, ORDERS, PAIRS } from '../src/study/plan';
import type { TechnicalIssue } from '../src/study/types';
import type { Store } from './store';
import { StudyError, type InternalStep, type Study } from './study';
import { STUDY_VERSION, PROTOCOL_VERSION, versions } from './version';

// An unfinished session with no activity for this long gets a warning.
const INACTIVE_MS = 30 * 60 * 1000;

type Row = Record<string, any>;

const issueId = (participantId: string, taskId: string) => `${participantId}::${taskId}`;

// Latest record per participant task, without the ones a researcher removed.
export function activeIssues(rows: Row[]) {
  return rows.filter((r) => !r.removed) as unknown as TechnicalIssue[];
}

function stepSummary(st: InternalStep, index: number, total: number) {
  return {
    index,
    total,
    kind: st.kind,
    taskId: 'taskId' in st ? st.taskId : null,
    role: 'role' in st ? st.role : null,
    part: 'part' in st ? st.part : null,
    condition: st.condition,
  };
}

// Data that should exist for every step the participant has already passed.
function missingData(steps: InternalStep[], stepIndex: number, p: Row, attempts: Row[], surveys: Row[], events: Row[]) {
  const warnings: string[] = [];
  steps.slice(0, stepIndex).forEach((st, i) => {
    if (st.kind === 'proficiency' && p.proficiencyScore == null) warnings.push('Proficiency answers missing');
    if (st.kind === 'task') {
      if (!attempts.some((a) => a.taskId === st.taskId)) warnings.push(`No saved attempt for ${st.taskId}`);
      // Events are queued in the browser, so this can also mean the laptop hasn't sent them yet.
      if (!events.some((e) => e.stepIndex === i || (e.stepIndex == null && e.taskId === st.taskId))) warnings.push(`No interaction events for ${st.taskId}`);
    }
    if (st.kind === 'post_task' && !surveys.some((r) => r.kind === 'post_task' && r.taskId === st.taskId)) warnings.push(`Post-task survey missing for ${st.taskId}`);
    if (st.kind === 'post_condition' && !surveys.some((r) => r.kind === 'post_condition' && r.block === st.block)) warnings.push(`Survey missing for part ${st.part}`);
    if (st.kind === 'final' && !surveys.some((r) => r.kind === 'final')) warnings.push('Final survey missing');
  });
  return warnings;
}

export class Researcher {
  constructor(
    private store: Store,
    private study: Study,
  ) {}

  overview(includeDemo: boolean, now = Date.now()) {
    const keep = (r: Row) => includeDemo || !r.isDemo;
    const participants = this.store.read('participants').filter(keep) as Row[];
    const attempts = this.store.read('attempts').filter(keep) as Row[];
    const surveys = this.store.read('surveys').filter(keep) as Row[];
    const events = this.store.read('events').filter(keep) as Row[];
    const sessions = this.store.read('sessions') as Row[];
    const issues = activeIssues(this.store.read('technical_issues')).filter(keep);

    const by = <T extends Row>(rows: T[], key = 'participantId') => {
      const m = new Map<string, T[]>();
      for (const r of rows) m.set(String(r[key]), [...(m.get(String(r[key])) ?? []), r]);
      return m;
    };
    const attemptsBy = by(attempts);
    const surveysBy = by(surveys);
    const eventsBy = by(events);
    const sessionsBy = by(sessions, 'id');
    const issuesBy = by(issues as unknown as Row[]);

    const progress = participants.flatMap((p) => {
      let state;
      try {
        state = this.study.progress(String(p.id));
      } catch {
        return []; // a participant row without an order, e.g. from a crash during registration
      }
      const { steps, stepIndex } = state;
      const own = (m: Map<string, Row[]>) => m.get(String(p.id)) ?? [];
      const saved = [...own(attemptsBy), ...own(surveysBy), ...own(eventsBy), ...own(sessionsBy)].map((r) => String(r._savedAt ?? ''));
      const lastActivity = saved.reduce((a, b) => (b > a ? b : a), String(p._savedAt ?? p.createdAt ?? ''));
      const warnings = missingData(steps, stepIndex, p, own(attemptsBy), own(surveysBy), own(eventsBy));
      if (!p.completedAt && lastActivity && now - Date.parse(lastActivity) > INACTIVE_MS) {
        warnings.push(`No activity for ${Math.round((now - Date.parse(lastActivity)) / 60000)} minutes`);
      }
      if (p.studyVersion && p.studyVersion !== STUDY_VERSION) warnings.push(`Started on study version ${p.studyVersion}`);
      if (p.protocolVersion && p.protocolVersion !== PROTOCOL_VERSION) warnings.push(`Started on protocol version ${p.protocolVersion}`);
      if (!p.studyVersion) warnings.push('No version recorded (started before versions were tracked)');
      return [
        {
          id: p.id,
          isDemo: Boolean(p.isDemo),
          createdAt: p.createdAt,
          completedAt: p.completedAt ?? null,
          orderIndex: p.orderIndex,
          conditionOrder: p.conditionOrder,
          pairByCondition: p.pairByCondition ?? null,
          proficiency: p.proficiency ?? null,
          studyVersion: p.studyVersion ?? null,
          protocolVersion: p.protocolVersion ?? null,
          current: stepSummary(steps[stepIndex], stepIndex, steps.length),
          // So the dashboard can offer the right tasks when recording an issue.
          tasks: steps.flatMap((st, i) => (st.kind === 'task' ? [{ taskId: st.taskId, role: st.role, part: st.part, condition: st.condition, stepIndex: i, reached: i <= stepIndex }] : [])),
          lastActivity: lastActivity || null,
          attempts: own(attemptsBy).length,
          events: own(eventsBy).length,
          warnings,
          issues: own(issuesBy),
        },
      ];
    });

    const count = (rows: Row[], fn: (p: Row) => boolean) => rows.filter(fn).length;
    const versionCounts = new Map<string, number>();
    for (const p of participants) {
      const k = `${p.studyVersion ?? 'unknown'} / ${p.protocolVersion ?? 'unknown'}`;
      versionCounts.set(k, (versionCounts.get(k) ?? 0) + 1);
    }

    return {
      generatedAt: new Date(now).toISOString(),
      server: versions(),
      participants: participants.length,
      completed: count(participants, (p) => p.completedAt),
      attempts: attempts.length,
      orders: ORDERS.map((order, i) => ({
        order,
        started: count(participants, (p) => p.orderIndex === i),
        completed: count(participants, (p) => p.orderIndex === i && p.completedAt),
      })),
      // Each pair should meet each condition equally often across groups of six.
      pairs: PAIRS.map((pair) => ({
        pair,
        byCondition: Object.fromEntries(
          CONDITIONS.map((c) => [
            c,
            {
              started: count(participants, (p) => p.pairByCondition?.[c] === pair),
              completed: count(participants, (p) => p.pairByCondition?.[c] === pair && p.completedAt),
            },
          ]),
        ),
      })),
      versions: [...versionCounts].map(([version, n]) => ({ version, participants: n })),
      progress,
      issues,
    };
  }

  recordIssue(body: { participantId?: unknown; taskId?: unknown; reason?: unknown; exclude?: unknown }) {
    const participantId = String(body.participantId ?? '');
    const taskId = String(body.taskId ?? '');
    const reason = String(body.reason ?? '').trim();
    if (typeof body.exclude !== 'boolean') throw new StudyError(400, 'Say whether the attempt should be excluded from the analysis.');
    if (reason.length < 3 || reason.length > 2000) throw new StudyError(400, 'Describe the technical issue (3 to 2000 characters).');
    const { participant, steps } = this.study.progress(participantId);
    const stepIndex = steps.findIndex((st) => st.kind === 'task' && st.taskId === taskId);
    if (stepIndex < 0) throw new StudyError(400, `Task ${taskId} is not part of this participant's session.`);
    const st = steps[stepIndex] as Extract<InternalStep, { kind: 'task' }>;
    const attempt = this.store.read('attempts').find((a) => a.participantId === participantId && a.taskId === taskId);
    const issue: TechnicalIssue = {
      id: issueId(participantId, taskId),
      participantId,
      isDemo: participant.isDemo,
      taskId,
      role: st.role,
      condition: st.condition,
      block: st.block,
      indexInBlock: st.indexInBlock,
      stepIndex,
      attemptId: attempt ? String(attempt.id) : null,
      reason,
      exclude: body.exclude,
      removed: false,
      recordedAt: new Date().toISOString(),
      ...versions(),
    };
    // Append-only like everything else: a later record for the same task replaces this one.
    this.store.append('technical_issues', [issue]);
    return issue;
  }

  removeIssue(participantId: string, taskId: string) {
    const id = issueId(participantId, taskId);
    const existing = this.store.read('technical_issues').find((r) => r.id === id);
    if (!existing || existing.removed) throw new StudyError(404, 'No technical issue is recorded for that task.');
    this.store.append('technical_issues', [{ ...existing, removed: true, recordedAt: new Date().toISOString() }]);
    return { removed: id };
  }
}
