import { describe, expect, it } from 'vitest';
import { adaptiveSupport, compareDiagnosis, patchEvidenceFrom, supportFor } from '../src/study/adaptive';
import { getTask } from '../src/study/tasks';
import type { AdaptiveSignals, Proficiency } from '../src/study/types';

function signalsFor(taskId: string, proficiency: Proficiency, extra: Partial<AdaptiveSignals> = {}): AdaptiveSignals {
  const task = getTask(taskId);
  return {
    patchEvidence: task.patchVisible!,
    staticWarnings: task.evidence.staticWarnings.length,
    disagreement: false,
    uncertain: false,
    difficulty: task.difficulty,
    proficiency,
    recentUncritical: false,
    ...extra,
  };
}

const level = (taskId: string, p: Proficiency, extra: Partial<AdaptiveSignals> = {}) =>
  adaptiveSupport(signalsFor(taskId, p, extra), getTask(taskId)).level;

describe('adaptive support levels', () => {
  // Expected levels when the student agrees with the AI and has been checking advice.
  const table: [string, Proficiency, string][] = [
    ['sum-to-n', 'beginner', 'low'],
    ['sum-to-n', 'experienced', 'low'],
    ['letter-grade', 'experienced', 'strong'],
    ['average-positive', 'beginner', 'medium'],
    ['average-positive', 'intermediate', 'low'],
    ['second-largest', 'beginner', 'strong'],
    ['second-largest', 'intermediate', 'medium'],
    ['second-largest', 'experienced', 'medium'],
    ['course-averages', 'intermediate', 'medium'],
    ['course-averages', 'experienced', 'low'],
    ['count-peaks', 'intermediate', 'strong'],
    ['count-peaks', 'experienced', 'medium'],
  ];

  it.each(table)('%s for a %s participant is %s', (taskId, p, expected) => {
    expect(level(taskId, p)).toBe(expected);
  });

  it('always uses strong support when the patch fails a visible test', () => {
    const plan = adaptiveSupport(signalsFor('letter-grade', 'experienced'), getTask('letter-grade'));
    expect(plan.level).toBe('strong');
    expect(plan.activity).toBe('failing_test');
    expect(plan.patchWithheld).toBe(true);
    expect(plan.reasons[0]).toMatch(/fails a visible test/);
  });

  it('uses the suspicious line check when a static warning drives strong support', () => {
    const plan = adaptiveSupport(signalsFor('count-peaks', 'beginner'), getTask('count-peaks'));
    expect(plan.activity).toBe('suspicious_line');
  });

  it('falls back to output prediction when only behaviour drives strong support', () => {
    const plan = adaptiveSupport(
      signalsFor('sum-to-n', 'beginner', { recentUncritical: true, disagreement: true }),
      getTask('sum-to-n'),
    );
    expect(plan.level).toBe('strong');
    expect(plan.activity).toBe('predict_output');
  });

  it('raises support after uncritical acceptance or disagreement', () => {
    expect(level('sum-to-n', 'intermediate')).toBe('low');
    expect(level('sum-to-n', 'intermediate', { recentUncritical: true })).toBe('medium');
    expect(level('sum-to-n', 'intermediate', { disagreement: true })).toBe('low');
    expect(level('average-positive', 'intermediate', { disagreement: true })).toBe('medium');
  });

  it('gives beginners at least as much support as experienced students', () => {
    const rank = { low: 0, medium: 1, strong: 2 } as const;
    for (const id of ['sum-to-n', 'letter-grade', 'average-positive', 'second-largest', 'course-averages', 'count-peaks']) {
      expect(rank[level(id, 'beginner') as keyof typeof rank]).toBeGreaterThanOrEqual(
        rank[level(id, 'experienced') as keyof typeof rank],
      );
    }
  });

  it('medium support asks for one evidence check and keeps the patch visible', () => {
    const plan = adaptiveSupport(signalsFor('course-averages', 'intermediate'), getTask('course-averages'));
    expect(plan).toMatchObject({ level: 'medium', activity: 'evidence_check', patchWithheld: false, showComparison: true });
  });

  it('low support has no required activity', () => {
    const plan = adaptiveSupport(signalsFor('sum-to-n', 'experienced'), getTask('sum-to-n'));
    expect(plan).toMatchObject({ level: 'low', activity: 'none', patchWithheld: false, showComparison: false });
  });

  it('is deterministic', () => {
    const s = signalsFor('second-largest', 'intermediate', { uncertain: true });
    expect(adaptiveSupport(s, getTask('second-largest'))).toEqual(adaptiveSupport(s, getTask('second-largest')));
  });
});

describe('other conditions', () => {
  const s = signalsFor('count-peaks', 'beginner');
  it('direct AI never asks for verification', () => {
    expect(supportFor('direct', s, getTask('count-peaks'))).toMatchObject({ activity: 'none', showEvidence: false });
  });
  it('always verify uses the same prediction check every time', () => {
    for (const id of ['sum-to-n', 'letter-grade', 'count-peaks']) {
      expect(supportFor('always', signalsFor(id, 'experienced'), getTask(id))).toMatchObject({
        level: 'fixed',
        activity: 'predict_output',
        patchWithheld: false,
      });
    }
  });
});

describe('signal helpers', () => {
  it('summarises patch test results', () => {
    expect(patchEvidenceFrom(3, 3)).toBe('pass');
    expect(patchEvidenceFrom(2, 3)).toBe('partial');
    expect(patchEvidenceFrom(0, 3)).toBe('fail');
  });

  it('detects disagreement by suspected line', () => {
    expect(compareDiagnosis(4, [4])).toEqual({ disagreement: false, uncertain: false });
    expect(compareDiagnosis(5, [4])).toEqual({ disagreement: false, uncertain: false });
    expect(compareDiagnosis(8, [4])).toEqual({ disagreement: true, uncertain: false });
    expect(compareDiagnosis(null, [4])).toEqual({ disagreement: false, uncertain: true });
  });
});
