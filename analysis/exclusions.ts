import type { TaskAttempt, TechnicalIssue } from '../src/study/types';

export interface Exclusion {
  participantId: string;
  taskId: string;
  role: string;
  condition: string;
  reason: string;
  recordedAt: string;
  // What happened to the data: dropped from the analysis, or nothing to drop.
  status: 'excluded' | 'no attempt saved' | 'participant not completed';
}

// Researchers mark attempts that were disrupted by a technical problem. Only
// active records with exclude=true remove data; every one of them is reported.
export function applyExclusions(attempts: TaskAttempt[], issueRows: Record<string, unknown>[], completed: Set<string>) {
  const issues = (issueRows as unknown as TechnicalIssue[]).filter((i) => !i.removed);
  const excludedKeys = new Set(issues.filter((i) => i.exclude).map((i) => `${i.participantId}::${i.taskId}`));
  const kept = attempts.filter((a) => !excludedKeys.has(`${a.participantId}::${a.taskId}`));

  const exclusions: Exclusion[] = issues
    .filter((i) => i.exclude)
    .map((i) => ({
      participantId: i.participantId,
      taskId: i.taskId,
      role: i.role,
      condition: i.condition ?? '',
      reason: i.reason,
      recordedAt: i.recordedAt,
      status: !completed.has(i.participantId)
        ? 'participant not completed'
        : attempts.some((a) => a.participantId === i.participantId && a.taskId === i.taskId)
          ? 'excluded'
          : 'no attempt saved',
    }));
  const flaggedKept = issues.filter((i) => !i.exclude);
  return { kept, exclusions, flaggedKept };
}
