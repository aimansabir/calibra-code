import type { Proficiency } from './types';
import { SUS_ITEMS, TLX_ITEMS } from './surveyItems';

export { AGENCY_ITEMS, POST_TASK_ITEMS, SUS_ITEMS, TLX_ITEMS } from './surveyItems';

export interface ProficiencyQuestion {
  id: string;
  prompt: string;
  code: string;
  options: string[];
  answer: string;
}

export const PROFICIENCY_QUESTIONS: ProficiencyQuestion[] = [
  {
    id: 'q1',
    prompt: 'What does this print?',
    code: 'print(len([1, [2, 3], 4]))',
    options: ['3', '4', '2', 'Error'],
    answer: '3',
  },
  {
    id: 'q2',
    prompt: 'What does this print?',
    code: 'x = [1, 2, 3]\ny = x\ny.append(4)\nprint(x)',
    options: ['[1, 2, 3]', '[1, 2, 3, 4]', '[4, 1, 2, 3]', 'Error'],
    answer: '[1, 2, 3, 4]',
  },
  {
    id: 'q3',
    prompt: 'What does this print?',
    code: 'print(list(range(2, 8, 2)))',
    options: ['[2, 4, 6, 8]', '[2, 4, 6]', '[2, 3, 4, 5, 6, 7]', '[4, 6, 8]'],
    answer: '[2, 4, 6]',
  },
  {
    id: 'q4',
    prompt: 'What does this print?',
    code: 'd = {"a": 1}\nprint(d.get("b", 0) + d["a"])',
    options: ['1', '0', 'None', 'KeyError'],
    answer: '1',
  },
  {
    id: 'q5',
    prompt: 'What does this print?',
    code: 'def f(n):\n    for i in range(n):\n        if i == 2:\n            return i\n    return -1\n\nprint(f(2))',
    options: ['2', '-1', '1', 'None'],
    answer: '-1',
  },
  {
    id: 'q6',
    prompt: 'What does this print?',
    code: 'print([x * x for x in range(4) if x % 2])',
    options: ['[0, 4]', '[1, 9]', '[0, 1, 4, 9]', '[1, 3]'],
    answer: '[1, 9]',
  },
];

export function scoreProficiency(answers: Record<string, string>) {
  const score = PROFICIENCY_QUESTIONS.filter((q) => answers[q.id] === q.answer).length;
  return { score, level: proficiencyFromScore(score) };
}

export function proficiencyFromScore(score: number): Proficiency {
  if (score <= 2) return 'beginner';
  if (score <= 4) return 'intermediate';
  return 'experienced';
}

export function rawTlx(responses: Record<string, number | string>) {
  const values = TLX_ITEMS.map((i) => Number(responses[i.id]));
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function susScore(responses: Record<string, number | string>) {
  let total = 0;
  SUS_ITEMS.forEach((item, i) => {
    const v = Number(responses[item.id]);
    total += i % 2 === 0 ? v - 1 : 5 - v;
  });
  return total * 2.5;
}
