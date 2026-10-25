import { describe, expect, it } from 'vitest';
import { classifyReliance } from '../src/study/reliance';
import {
  PROFICIENCY_QUESTIONS,
  SUS_ITEMS,
  TLX_ITEMS,
  rawTlx,
  scoreProficiency,
  susScore,
} from '../src/study/questionnaires';
import { hunks, lineDiff } from '../src/lib/diff';

describe('reliance classification', () => {
  it('follows the definitions in the specification', () => {
    expect(classifyReliance('correct', 'accept', true)).toBe('appropriate');
    expect(classifyReliance('correct', 'reject', true)).toBe('under');
    expect(classifyReliance('incorrect', 'accept', false)).toBe('over');
    expect(classifyReliance('partial', 'accept', false)).toBe('over');
    expect(classifyReliance('incorrect', 'reject', false)).toBe('appropriate');
  });

  it('judges edits by the final result', () => {
    expect(classifyReliance('incorrect', 'edit', true)).toBe('appropriate');
    expect(classifyReliance('incorrect', 'edit', false)).toBe('over');
    expect(classifyReliance('correct', 'edit', true)).toBe('appropriate');
    expect(classifyReliance('correct', 'edit', false)).toBe('mixed');
  });

  it('returns none when there was no AI suggestion', () => {
    expect(classifyReliance(null, null, true)).toBe('none');
  });
});

describe('questionnaires', () => {
  it('classifies proficiency from the quiz score', () => {
    const all = Object.fromEntries(PROFICIENCY_QUESTIONS.map((q) => [q.id, q.answer]));
    expect(scoreProficiency(all)).toEqual({ score: 6, level: 'experienced' });
    expect(scoreProficiency({}).level).toBe('beginner');
    const four = Object.fromEntries(PROFICIENCY_QUESTIONS.slice(0, 4).map((q) => [q.id, q.answer]));
    expect(scoreProficiency(four)).toEqual({ score: 4, level: 'intermediate' });
  });

  it('every proficiency answer is one of its options', () => {
    for (const q of PROFICIENCY_QUESTIONS) expect(q.options).toContain(q.answer);
  });

  it('scores SUS the standard way', () => {
    const best = Object.fromEntries(SUS_ITEMS.map((it, i) => [it.id, i % 2 === 0 ? 5 : 1]));
    const worst = Object.fromEntries(SUS_ITEMS.map((it, i) => [it.id, i % 2 === 0 ? 1 : 5]));
    const neutral = Object.fromEntries(SUS_ITEMS.map((it) => [it.id, 3]));
    expect(susScore(best)).toBe(100);
    expect(susScore(worst)).toBe(0);
    expect(susScore(neutral)).toBe(50);
  });

  it('averages the six raw TLX items', () => {
    const r = Object.fromEntries(TLX_ITEMS.map((it, i) => [it.id, i * 20]));
    expect(rawTlx(r)).toBe(50);
  });
});

describe('line diff', () => {
  it('finds a single changed line', () => {
    const d = lineDiff('a\nb\nc', 'a\nB\nc');
    expect(d.filter((l) => l.kind === 'remove').map((l) => l.text)).toEqual(['b']);
    expect(d.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['B']);
    expect(hunks(d, 0)).toHaveLength(1);
  });

  it('handles inserted lines', () => {
    const d = lineDiff('a\nc', 'a\nb\nc');
    expect(d.map((l) => l.kind)).toEqual(['same', 'add', 'same']);
    expect(d[1].newNo).toBe(2);
  });
});
