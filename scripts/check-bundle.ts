// Fails the build if anything researcher-only made it into the browser bundle:
// solutions, hidden tests, answer keys, AI correctness notes or quiz answers.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TASKS } from '../src/study/tasks';
import { PROFICIENCY_QUESTIONS } from '../src/study/questionnaires';

const dir = join('dist', 'assets');
const bundle = readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(dir, f), 'utf8'))
  .join('\n');

const leaks: string[] = [];
const check = (label: string, text: string | undefined | null) => {
  if (text && text.length > 6 && bundle.includes(text)) leaks.push(`${label}: ${text.slice(0, 80)}`);
};

for (const t of TASKS) {
  // Lines that only appear in the solution, not in the starter or patch.
  const shown = new Set([...t.starterCode.split('\n'), ...(t.patchCode ?? '').split('\n')]);
  for (const line of t.solutionCode.split('\n')) if (line.trim().length > 12 && !shown.has(line)) check(`${t.id} solution`, line.trim());
  for (const test of t.tests.filter((x) => x.hidden)) check(`${t.id} hidden test`, test.call);
  check(`${t.id} advice note`, t.advice?.note);
  check(`${t.id} advice diagnosis`, t.advice?.diagnosis);
  check(`${t.id} prediction question`, t.evidence.prediction?.question);
  check(`${t.id} failing test answer`, t.evidence.failingTestCheck?.answer);
  check(`${t.id} suspicious line answer`, t.evidence.suspiciousLineCheck?.answer);
  check(`${t.id} objective`, t.objective);
}
for (const q of PROFICIENCY_QUESTIONS) check(`proficiency ${q.id}`, q.code);
for (const word of ["'incorrect'", '"incorrect"', 'correctness']) if (bundle.includes(word)) leaks.push(`label ${word}`);

if (leaks.length) {
  console.error(`Researcher-only data found in the browser bundle:\n  ${leaks.join('\n  ')}`);
  process.exit(1);
}
console.log(`bundle check passed: nothing from ${TASKS.length} tasks or the quiz key is in dist/`);
