import type { AdaptiveSignals, Condition, PatchEvidence, SupportPlan, TaskDef, VerificationActivity } from './types';

// Deterministic rules for the adaptive condition. The same signals always give
// the same support, and every point added to the score is listed as a reason.
export const RULES = {
  staticWarning: 2,
  disagreement: 1,
  uncertain: 1,
  difficulty: { 1: 0, 2: 1, 3: 2 } as Record<number, number>,
  proficiency: { beginner: 1, intermediate: 0, experienced: -1 } as Record<string, number>,
  recentUncritical: 2,
  mediumAt: 2,
  strongAt: 4,
};

export function scoreSignals(s: AdaptiveSignals) {
  const reasons: string[] = [];
  let score = 0;

  if (s.staticWarnings > 0) {
    score += RULES.staticWarning;
    reasons.push(`static warning on the patch (+${RULES.staticWarning})`);
  }
  if (s.disagreement) {
    score += RULES.disagreement;
    reasons.push(`student and AI point at different lines (+${RULES.disagreement})`);
  }
  if (s.uncertain) {
    score += RULES.uncertain;
    reasons.push(`student was unsure where the bug is (+${RULES.uncertain})`);
  }
  const d = RULES.difficulty[s.difficulty] ?? 0;
  if (d) {
    score += d;
    reasons.push(`task difficulty ${s.difficulty} (+${d})`);
  }
  const p = RULES.proficiency[s.proficiency] ?? 0;
  if (p) {
    score += p;
    reasons.push(`${s.proficiency} participant (${p > 0 ? '+' : ''}${p})`);
  }
  if (s.recentUncritical) {
    score += RULES.recentUncritical;
    reasons.push(`last suggestion was accepted without checking (+${RULES.recentUncritical})`);
  }
  return { score, reasons };
}

export function adaptiveSupport(s: AdaptiveSignals, task: TaskDef): SupportPlan {
  const { score, reasons } = scoreSignals(s);

  let level: 'low' | 'medium' | 'strong';
  if (s.patchEvidence !== 'pass') {
    level = 'strong';
    reasons.unshift(`patch fails a visible test (${s.patchEvidence})`);
  } else if (score >= RULES.strongAt) {
    level = 'strong';
  } else if (score >= RULES.mediumAt) {
    level = 'medium';
  } else {
    level = 'low';
  }

  let activity: VerificationActivity = 'none';
  if (level === 'medium') activity = 'evidence_check';
  if (level === 'strong') activity = strongActivity(s, task);

  return {
    condition: 'adaptive',
    level,
    activity,
    patchWithheld: level === 'strong',
    showComparison: level !== 'low',
    showEvidence: true,
    score,
    reasons,
  };
}

// Pick the check that matches the strongest piece of evidence available.
function strongActivity(s: AdaptiveSignals, task: TaskDef): VerificationActivity {
  if (s.patchEvidence !== 'pass') return 'failing_test';
  if (s.staticWarnings > 0 && task.evidence.suspiciousLineCheck) return 'suspicious_line';
  return 'predict_output';
}

export function supportFor(
  condition: Condition | 'practice',
  signals: AdaptiveSignals,
  task: TaskDef,
): SupportPlan {
  if (condition === 'adaptive') return adaptiveSupport(signals, task);
  if (condition === 'always' || condition === 'practice') {
    return {
      condition,
      level: 'fixed',
      activity: 'predict_output',
      patchWithheld: false,
      showComparison: true,
      showEvidence: true,
      score: null,
      reasons: ['same check for every suggestion'],
    };
  }
  return {
    condition,
    level: 'none',
    activity: 'none',
    patchWithheld: false,
    showComparison: false,
    showEvidence: false,
    score: null,
    reasons: ['advice shown directly'],
  };
}

export function patchEvidenceFrom(passed: number, total: number): PatchEvidence {
  if (passed === total) return 'pass';
  if (passed === 0) return 'fail';
  return 'partial';
}

export function compareDiagnosis(suspectedLine: number | null, targetLines: number[]) {
  if (suspectedLine == null) return { disagreement: false, uncertain: true };
  const near = targetLines.some((l) => Math.abs(l - suspectedLine) <= 1);
  return { disagreement: !near, uncertain: false };
}
