import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadPyodide, type PyodideInterface } from 'pyodide';
import { TASKS } from '../src/study/tasks';
import { patchEvidenceFrom } from '../src/study/adaptive';
import type { TestCase, TestResult } from '../src/study/types';

let py: PyodideInterface;

beforeAll(async () => {
  py = await loadPyodide();
  py.runPython(readFileSync('public/harness.py', 'utf8'));
}, 120000);

function runTests(code: string, tests: TestCase[]): TestResult[] {
  const raw = py.globals.get('run_tests')(code, JSON.stringify(tests));
  return JSON.parse(raw).results;
}

function evaluate(code: string, call: string): string {
  return py.globals.get('evaluate')(code, call);
}

const lineCount = (code: string) => code.split('\n').length;

describe('task set', () => {
  it('has one practice task, one transfer task and three balanced pairs', () => {
    expect(TASKS.filter((t) => t.role === 'practice')).toHaveLength(1);
    expect(TASKS.filter((t) => t.role === 'transfer')).toHaveLength(1);
    for (const pair of ['A', 'B', 'C']) {
      const tasks = TASKS.filter((t) => t.pair === pair);
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.advice!.correctness === 'correct').sort()).toEqual([false, true]);
      expect(tasks[0].difficulty).toBe(tasks[1].difficulty);
    }
  });

  it('covers all six bug types from the specification', () => {
    const types = new Set(TASKS.filter((t) => t.role === 'experimental').map((t) => t.bugType));
    for (const t of [
      'Off by one loop',
      'Incorrect condition',
      'Return placement',
      'List index handling',
      'Dictionary key handling',
      'Missing edge case',
    ]) {
      expect(types).toContain(t);
    }
  });
});

describe.each(TASKS.map((t) => [t.id, t] as const))('%s', (_id, task) => {
  it('has visible and hidden tests', () => {
    expect(task.tests.some((t) => !t.hidden)).toBe(true);
    expect(task.tests.some((t) => t.hidden)).toBe(true);
  });

  it('starter code fails at least one visible test', () => {
    const visible = task.tests.filter((t) => !t.hidden);
    const results = runTests(task.starterCode, visible);
    expect(results.some((r) => !r.passed)).toBe(true);
  });

  it('solution passes every test', () => {
    const results = runTests(task.solutionCode, task.tests);
    const failing = results.filter((r) => !r.passed).map((r) => `${r.call} -> ${r.actual}`);
    expect(failing).toEqual([]);
  });

  it('starter and solution run as a program without errors', () => {
    for (const code of [task.starterCode, task.solutionCode]) {
      const out = JSON.parse(py.globals.get('run_program')(code));
      if (code === task.solutionCode) expect(out.error).toBeNull();
      expect(out.stdout.length + (out.error?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  if (!task.advice) return;
  const advice = task.advice;

  it('AI patch behaves the way its correctness label says', () => {
    expect(task.patchCode).toBeTruthy();
    const results = runTests(task.patchCode!, task.tests);
    const allPass = results.every((r) => r.passed);
    expect(allPass).toBe(advice.correctness === 'correct');
  });

  it('declared patch evidence matches the visible test run', () => {
    const visible = task.tests.filter((t) => !t.hidden);
    const results = runTests(task.patchCode!, visible);
    const evidence = patchEvidenceFrom(results.filter((r) => r.passed).length, results.length);
    expect(evidence).toBe(task.patchVisible);
  });

  it('prediction answer is what the patch really returns', () => {
    const p = task.evidence.prediction!;
    expect(p).toBeTruthy();
    expect(p.options).toContain(p.answer);
    expect(evaluate(task.patchCode!, p.call)).toBe(p.answer);
  });

  it('has the checks needed for strong support', () => {
    if (task.patchVisible !== 'pass') {
      const c = task.evidence.failingTestCheck!;
      expect(c).toBeTruthy();
      expect(c.options).toContain(c.answer);
    }
    for (const w of task.evidence.staticWarnings) {
      expect(w.line).toBeGreaterThan(0);
      expect(w.line).toBeLessThanOrEqual(lineCount(task.patchCode!));
    }
    if (task.evidence.staticWarnings.length) {
      const c = task.evidence.suspiciousLineCheck!;
      expect(c).toBeTruthy();
      expect(c.options).toContain(c.answer);
      expect(task.evidence.staticWarnings.map((w) => w.line)).toContain(c.line);
    }
  });

  it('target lines point inside the starter code', () => {
    for (const l of advice.targetLines) {
      expect(l).toBeGreaterThan(0);
      expect(l).toBeLessThanOrEqual(lineCount(task.starterCode));
    }
  });
});
