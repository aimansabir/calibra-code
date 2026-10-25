// Turns the study data into the comparisons in the experimental plan.
//   npm run analyze                  reads ./data
//   npm run analyze -- path/to/data  reads another export folder
//   add --demo to include demo sessions (useful for checking the pipeline)
//   add --out=folder to write somewhere other than analysis/out
// Attempts a researcher marked as technically affected (and excluded) are
// dropped, and every exclusion is listed in the summary and in exclusions.csv.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Store, toCsv } from '../server/store';
import type { Condition, SurveyResponse, TaskAttempt } from '../src/study/types';
import { applyExclusions } from './exclusions';
import { friedman, holm, mean, median, quantile, sd, wilcoxon } from './stats';

const args = process.argv.slice(2);
const includeDemo = args.includes('--demo');
const dataDir = args.find((a) => !a.startsWith('--')) ?? process.env.DATA_DIR ?? 'data';
const outDir = args.find((a) => a.startsWith('--out='))?.slice('--out='.length) || join('analysis', 'out');

const store = new Store(dataDir);
const keep = (r: { isDemo?: unknown }) => includeDemo || !r.isDemo;
const participants = store.read('participants').filter(keep) as Record<string, any>[];
const done = new Set(participants.filter((p) => p.completedAt).map((p) => p.id));
const incomplete = participants.filter((p) => !p.completedAt).map((p) => String(p.id));
const allAttempts = (store.read('attempts') as unknown as TaskAttempt[]).filter((a) => keep(a) && done.has(a.participantId));
const { kept: attempts, exclusions, flaggedKept } = applyExclusions(allAttempts, store.read('technical_issues').filter(keep), done);
const surveys = (store.read('surveys') as unknown as SurveyResponse[]).filter((s) => keep(s) && done.has(s.participantId));

const CONDITIONS: Condition[] = ['direct', 'always', 'adaptive'];
const NAMES: Record<Condition, string> = { direct: 'Direct AI', always: 'Always Verify', adaptive: 'CALIBRA CODE' };

// One row per participant and condition. Rates are per task in that condition.
const rows: Record<string, string | number>[] = [];
for (const pid of done) {
  for (const c of CONDITIONS) {
    const a = attempts.filter((x) => x.participantId === pid && x.condition === c && x.role === 'experimental');
    if (!a.length) continue;
    const wrongAi = a.filter((x) => x.aiCorrectness !== 'correct');
    const rightAi = a.filter((x) => x.aiCorrectness === 'correct');
    const post = surveys.find((s) => s.participantId === pid && s.kind === 'post_condition' && s.condition === c);
    const postTask = surveys.filter((s) => s.participantId === pid && s.kind === 'post_task' && s.condition === c);
    const p = participants.find((x) => x.id === pid);
    rows.push({
      participant: pid,
      proficiency: p?.proficiency ?? '',
      orderIndex: p?.orderIndex ?? '',
      position: (p?.conditionOrder ?? []).indexOf(c) + 1,
      condition: c,
      tasks: a.length,
      appropriate: mean(a.map((x) => (x.reliance === 'appropriate' ? 1 : 0))),
      over: wrongAi.length ? mean(wrongAi.map((x) => (x.reliance === 'over' ? 1 : 0))) : NaN,
      under: rightAi.length ? mean(rightAi.map((x) => (x.reliance === 'under' ? 1 : 0))) : NaN,
      correct: mean(a.map((x) => (x.finalCorrect ? 1 : 0))),
      hiddenPassRate: mean(a.map((x) => (x.hiddenTotal ? x.hiddenPassed / x.hiddenTotal : 1))),
      timeSec: mean(a.map((x) => x.completionMs / 1000)),
      testRunsAfterAdvice: mean(a.map((x) => x.testRunsAfterAdvice)),
      evidenceViews: mean(a.map((x) => x.evidenceViews)),
      verificationCorrect: mean(a.filter((x) => x.verificationCorrect != null).map((x) => (x.verificationCorrect ? 1 : 0))),
      rawTlx: post?.scores.rawTlx ?? NaN,
      sus: post?.scores.sus ?? NaN,
      agency: post?.scores.agencyMean ?? NaN,
      confidence: mean(postTask.map((s) => Number(s.responses.confidence))),
    });
  }
}

const MEASURES: { key: string; label: string; better: 'higher' | 'lower' }[] = [
  { key: 'appropriate', label: 'Appropriate reliance (share of tasks)', better: 'higher' },
  { key: 'over', label: 'Overreliance (share of wrong suggestions accepted)', better: 'lower' },
  { key: 'under', label: 'Underreliance (share of correct suggestions rejected)', better: 'lower' },
  { key: 'correct', label: 'Final code fully correct', better: 'higher' },
  { key: 'timeSec', label: 'Completion time per task (s)', better: 'lower' },
  { key: 'testRunsAfterAdvice', label: 'Test runs after advice', better: 'higher' },
  { key: 'evidenceViews', label: 'Evidence opened', better: 'higher' },
  { key: 'rawTlx', label: 'Raw TLX workload (0-100)', better: 'lower' },
  { key: 'sus', label: 'SUS usability (0-100)', better: 'higher' },
  { key: 'agency', label: 'Agency and trust (1-7)', better: 'higher' },
  { key: 'confidence', label: 'Post-task confidence (1-7)', better: 'higher' },
];

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const fmtP = (p: number) => (!Number.isFinite(p) ? '–' : p < 0.001 ? '<.001' : p.toFixed(3));

const ids = [...done];
const table = (key: string) =>
  ids.map((pid) => CONDITIONS.map((c) => Number(rows.find((r) => r.participant === pid && r.condition === c)?.[key] ?? NaN)));

const md: string[] = [];
md.push('# CALIBRA CODE results', '');
md.push(`Data: \`${dataDir}\`${includeDemo ? ' (demo sessions included)' : ''}. Completed participants: **${done.size}**. Experimental attempts: ${attempts.filter((a) => a.role === 'experimental').length}.`, '');
md.push('Values are per-participant means within each condition, summarised as mean (SD) and median [IQR].', 'Friedman tests treat the three conditions as repeated measures; pairwise Wilcoxon signed-rank tests are Holm-corrected within each measure.', '');

md.push('## Exclusions', '');
md.push(`Participants who did not finish are left out: ${incomplete.length}${incomplete.length ? ` (${incomplete.join(', ')})` : ''}.`, '');
const dropped = exclusions.filter((e) => e.status === 'excluded');
md.push(`Attempts excluded for technical issues: **${dropped.length}**. A condition whose attempts are all excluded has no value for that participant, so they drop out of the complete-case tests for it. Post-task survey answers for excluded attempts are kept.`, '');
if (exclusions.length) {
  md.push('| Participant | Task | Role | Condition | Reason | Recorded | Status |', '|---|---|---|---|---|---|---|');
  for (const e of exclusions) md.push(`| ${e.participantId} | ${e.taskId} | ${e.role} | ${e.condition ? NAMES[e.condition as Condition] : '–'} | ${e.reason.replace(/\|/g, '\\|').replace(/\n/g, ' ')} | ${e.recordedAt} | ${e.status} |`);
  md.push('');
}
if (flaggedKept.length) {
  md.push(`Technical issues recorded but kept in the analysis: ${flaggedKept.length} (${flaggedKept.map((i) => `${i.participantId}/${i.taskId}`).join(', ')}).`, '');
}

const tests: Record<string, string | number>[] = [];
for (const m of MEASURES) {
  const t = table(m.key);
  md.push(`## ${m.label}`, '', '| Condition | n | Mean (SD) | Median [IQR] |', '|---|---|---|---|');
  CONDITIONS.forEach((c, j) => {
    const xs = t.map((r) => r[j]).filter(Number.isFinite);
    md.push(`| ${NAMES[c]} | ${xs.length} | ${fmt(mean(xs))} (${fmt(sd(xs))}) | ${fmt(median(xs))} [${fmt(quantile(xs, 0.25))}, ${fmt(quantile(xs, 0.75))}] |`);
  });
  const f = friedman(t);
  md.push('', `Friedman χ²(${f.df}) = ${fmt(f.chi2)}, p = ${fmtP(f.p)}, Kendall's W = ${fmt(f.kendallW)}, n = ${f.n} complete participants.`);
  const pairs: [number, number][] = [
    [2, 0],
    [2, 1],
    [1, 0],
  ];
  const complete = t.filter((r) => r.every(Number.isFinite));
  const w = pairs.map(([i, j]) => wilcoxon(complete.map((r) => r[i]), complete.map((r) => r[j])));
  const adj = holm(w.map((x) => x.p));
  md.push('', '| Comparison | Median difference | W+ | p (Holm) |', '|---|---|---|---|');
  pairs.forEach(([i, j], k) => {
    const diff = median(complete.map((r) => r[i] - r[j]));
    md.push(`| ${NAMES[CONDITIONS[i]]} vs ${NAMES[CONDITIONS[j]]} | ${fmt(diff)} | ${w[k].w} | ${fmtP(adj[k])} |`);
    tests.push({ measure: m.key, comparison: `${CONDITIONS[i]}-${CONDITIONS[j]}`, n: w[k].n, w: w[k].w, p: w[k].p, pHolm: adj[k], medianDiff: diff, friedmanChi2: f.chi2, friedmanP: f.p, kendallW: f.kendallW });
  });
  md.push('');
}

// H4: who got which support in the adaptive condition.
const adaptive = attempts.filter((a) => a.condition === 'adaptive' && a.role === 'experimental' && a.support);
md.push('## Adaptive support by proficiency (H4)', '', '| Proficiency | Tasks | Low | Medium | Strong |', '|---|---|---|---|---|');
for (const level of ['beginner', 'intermediate', 'experienced']) {
  const a = adaptive.filter((x) => x.signals?.proficiency === level);
  const count = (l: string) => a.filter((x) => x.support!.level === l).length;
  md.push(`| ${level} | ${a.length} | ${count('low')} | ${count('medium')} | ${count('strong')} |`);
}
md.push('');

// H5: the transfer task, split by which condition came just before it.
const transfer = attempts.filter((a) => a.role === 'transfer');
md.push('## Transfer task without AI (H5)', '', '| Condition just before transfer | n | Fully correct | Hidden tests passed | Median time (s) |', '|---|---|---|---|---|');
for (const c of CONDITIONS) {
  const t = transfer.filter((a) => participants.find((p) => p.id === a.participantId)?.conditionOrder?.[2] === c);
  md.push(`| ${NAMES[c]} | ${t.length} | ${fmt(mean(t.map((a) => (a.finalCorrect ? 1 : 0))))} | ${fmt(mean(t.map((a) => (a.hiddenTotal ? a.hiddenPassed / a.hiddenTotal : 1))))} | ${fmt(median(t.map((a) => a.completionMs / 1000)), 0)} |`);
}
md.push('', 'Every participant uses all three interfaces, so H5 can only be looked at through order. Treat this as exploratory.', '');

// Final preferences and open comments for the qualitative coding.
const finals = surveys.filter((s) => s.kind === 'final');
md.push('## Final preferences', '', '| Question | Direct AI | Always Verify | CALIBRA CODE |', '|---|---|---|---|');
for (const q of ['prefer_overall', 'prefer_trust', 'prefer_least_effort']) {
  const n = (c: string) => finals.filter((s) => s.responses[`${q}_condition`] === c).length;
  md.push(`| ${q} | ${n('direct')} | ${n('always')} | ${n('adaptive')} |`);
}
const comments = [
  ...finals.flatMap((s) => ['useful', 'interruptions', 'confusing'].map((k) => ({ participant: s.participantId, condition: '', source: k, text: String(s.responses[k] ?? '').trim() }))),
  ...surveys.filter((s) => s.kind === 'post_condition').map((s) => ({ participant: s.participantId, condition: s.condition ?? '', source: 'post_condition', text: String(s.responses.comment ?? '').trim() })),
].filter((c) => c.text);
md.push('', `${comments.length} open comments are in \`comments.csv\`, with an empty \`theme\` column for coding.`, '');

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'participant_condition.csv'), toCsv(rows));
writeFileSync(join(outDir, 'tests.csv'), toCsv(tests));
writeFileSync(join(outDir, 'comments.csv'), toCsv(comments.map((c) => ({ ...c, theme: '' }))));
writeFileSync(join(outDir, 'exclusions.csv'), toCsv(exclusions.map((e) => ({ ...e }))));
writeFileSync(join(outDir, 'summary.md'), md.join('\n'));
console.log(`analysed ${done.size} completed participants (${dropped.length} attempts excluded for technical issues) -> ${outDir}/summary.md`);
