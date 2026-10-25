import { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python as pythonLang } from '@codemirror/lang-python';
import { api, logEvent, type Advice, type PublicTask, type SessionView, type Step } from '../lib/api';
import { nowIso } from '../lib/id';
import { python } from '../lib/python';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorNote } from '../components/Form';
import { PatchDiff } from '../components/PatchDiff';
import { TestTable, type Row } from '../components/TestTable';

type Decision = 'accept' | 'edit' | 'reject';
type Counters = { codeRuns: number; testRuns: number; testRunsAfterAdvice: number; evidenceViews: number; edits: number };

interface Draft {
  code: string;
  ownCode: string | null;
  applied: string | null;
  decision: Decision | null;
  history: { decision: Decision; at: string }[];
  counters: Counters;
  adviceShownAt: string | null;
  diagnosisText: string;
  suspectedLine: string;
}

const DECISIONS: { value: Decision; label: string; hint: string }[] = [
  { value: 'accept', label: 'Accept', hint: 'Use the AI patch as it is' },
  { value: 'edit', label: 'Edit', hint: 'Start from the AI patch and change it' },
  { value: 'reject', label: 'Reject', hint: 'Keep my own code instead' },
];

const draftKey = (pid: string, taskId: string) => `calibra.draft.${pid}.${taskId}`;

function loadDraft(pid: string, task: PublicTask): Draft {
  try {
    const raw = localStorage.getItem(draftKey(pid, task.id));
    if (raw) return JSON.parse(raw);
  } catch {
    // fall through to a fresh draft
  }
  return {
    code: task.starterCode,
    ownCode: null,
    applied: null,
    decision: null,
    history: [],
    counters: { codeRuns: 0, testRuns: 0, testRunsAfterAdvice: 0, evidenceViews: 0, edits: 0 },
    adviceShownAt: null,
    diagnosisText: '',
    suspectedLine: '',
  };
}

export function Workspace({ pid, step, task, onDone }: { pid: string; step: Extract<Step, { kind: 'task' }>; task: PublicTask; onDone: (s: SessionView, msg?: string) => void }) {
  const [draft, setDraft] = useState<Draft>(() => loadDraft(pid, task));
  const [advice, setAdvice] = useState<Advice | null>(task.advice);
  const [consoleOut, setConsoleOut] = useState<{ stdout: string; error: string | null } | null>(null);
  const [testRows, setTestRows] = useState<Row[]>(task.visibleTests);
  const [running, setRunning] = useState<'code' | 'tests' | null>(null);
  const [outputTab, setOutputTab] = useState<'console' | 'tests'>('tests');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkAnswer, setCheckAnswer] = useState('');
  const [evidenceOpen, setEvidenceOpen] = useState(Boolean(task.advice?.evidenceOpen));
  const [confirm, setConfirm] = useState<null | { kind: 'decision'; decision: Decision } | { kind: 'reset' } | { kind: 'submit' }>(null);
  const lastEdit = useRef(0);

  const log = (type: string, payload: Record<string, unknown> = {}) => logEvent(pid, type, task.id, payload);

  useEffect(() => {
    log('task_view', { role: task.role, resumed: Boolean(task.advice) });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey(pid, task.id), JSON.stringify(draft));
    } catch {
      // drafts are a convenience, the server has everything that matters
    }
  }, [draft]);

  // Patch test results come with the advice response but not with a resumed session view.
  useEffect(() => {
    if (advice && advice.patchTests === undefined && advice.showEvidence) {
      api.diagnose(pid, task.id, { diagnosisText: draft.diagnosisText || advice.student.diagnosisText, suspectedLine: advice.student.suspectedLine }).then(setAdvice, () => {});
    }
  }, []);

  const patch = advice?.patch ?? null;
  const checkPending = Boolean(advice?.check && !advice.checkDone);
  const canDecide = Boolean(advice && patch && !checkPending);
  const lines = useMemo(() => draft.code.split('\n'), [draft.code]);
  const isPractice = task.role === 'practice';

  const bump = (k: keyof Counters, by = 1) => setDraft((d) => ({ ...d, counters: { ...d.counters, [k]: d.counters[k] + by } }));

  function onCodeChange(code: string) {
    const now = Date.now();
    const newBurst = now - lastEdit.current > 2000;
    lastEdit.current = now;
    setDraft((d) => {
      const next = { ...d, code, counters: newBurst ? { ...d.counters, edits: d.counters.edits + 1 } : d.counters };
      // Changing an accepted patch makes it an edit.
      if (d.decision === 'accept' && patch && code !== patch) {
        next.decision = 'edit';
        next.history = [...d.history, { decision: 'edit', at: nowIso() }];
        log('decision', { decision: 'edit', automatic: true });
      }
      return next;
    });
    if (newBurst) log('code_edit', { length: code.length });
  }

  async function runCode() {
    setRunning('code');
    setOutputTab('console');
    bump('codeRuns');
    const out = await python().run(draft.code);
    setConsoleOut(out);
    setRunning(null);
    log('code_run', { error: out.error ? out.error.split('\n').at(-1) : null });
  }

  async function runTests() {
    setRunning('tests');
    setOutputTab('tests');
    bump('testRuns');
    if (advice) bump('testRunsAfterAdvice');
    const results = await python().tests(draft.code, task.visibleTests);
    setTestRows(results);
    setRunning(null);
    log('tests_run', { passed: results.filter((r) => r.passed).length, total: results.length, afterAdvice: Boolean(advice) });
  }

  async function askAi() {
    setBusy('advice');
    setError(null);
    try {
      const line = draft.suspectedLine === '' ? null : Number(draft.suspectedLine);
      const a = await api.diagnose(pid, task.id, { diagnosisText: draft.diagnosisText, suspectedLine: line });
      setAdvice(a);
      setEvidenceOpen(a.evidenceOpen);
      setDraft((d) => ({ ...d, ownCode: d.code, adviceShownAt: nowIso() }));
      log('diagnosis_submit', { length: draft.diagnosisText.length, suspectedLine: line });
      log('advice_shown', { patchWithheld: a.patchWithheld, check: a.check?.activity ?? null, evidenceOpen: a.evidenceOpen });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function sendCheck() {
    if (!advice?.check || !checkAnswer) return;
    setBusy('check');
    setError(null);
    try {
      const a = await api.verify(pid, task.id, checkAnswer);
      setAdvice(a);
      log('verification_answer', { activity: advice.check.activity, answer: checkAnswer });
      if (advice.patchWithheld && a.patch) log('patch_revealed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function chooseDecision(d: Decision, confirmed = false) {
    if (!patch) return;
    const target = d === 'reject' ? (draft.ownCode ?? task.starterCode) : patch;
    // Only ask when switching would throw away typing the participant has done.
    const wouldLoseWork = draft.code !== target && draft.code !== (draft.applied ?? draft.ownCode ?? task.starterCode);
    if (wouldLoseWork && !confirmed) return setConfirm({ kind: 'decision', decision: d });
    setDraft((x) => ({ ...x, code: target, applied: target, decision: d, history: [...x.history, { decision: d, at: nowIso() }] }));
    log('decision', { decision: d });
  }

  function resetCode() {
    const target = draft.applied ?? draft.ownCode ?? task.starterCode;
    setDraft((d) => ({ ...d, code: target }));
    log('code_reset');
  }

  function toggleEvidence(open: boolean) {
    setEvidenceOpen(open);
    if (open) bump('evidenceViews');
    log(open ? 'evidence_open' : 'evidence_close');
  }

  async function submit() {
    setBusy('submit');
    setError(null);
    log('submit_click', { decision: draft.decision });
    try {
      const r = await api.submit(pid, task.id, {
        finalCode: draft.code,
        decision: draft.decision,
        decisionHistory: draft.history,
        counters: draft.counters,
        adviceShownAt: draft.adviceShownAt,
      });
      try {
        localStorage.removeItem(draftKey(pid, task.id));
      } catch {
        // ignore
      }
      const msg = isPractice
        ? `Practice done. Your code passed ${r.visiblePassed} of ${r.visibleTotal} visible tests. The real tasks start now.`
        : `Saved. Your code passed ${r.visiblePassed} of ${r.visibleTotal} visible tests.`;
      onDone(r.session, msg);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const submitBlocker = !task.hasAi
    ? null
    : !advice
      ? 'Write your diagnosis and get the AI suggestion first.'
      : checkPending
        ? 'Answer the question next to the AI suggestion first.'
        : !draft.decision
          ? 'Choose Accept, Edit or Reject first.'
          : null;

  return (
    <div className="workspace">
      {/* Task area */}
      <aside className="panel task-panel" aria-label="Task">
        <h1>{task.title}</h1>
        {isPractice && (
          <div className="coach" role="note">
            <strong>Practice task.</strong> Try each control once: run the code, run the tests, write a diagnosis, look at the AI
            suggestion, choose a decision and submit. This task isn't counted.
          </div>
        )}
        <h2>Objective</h2>
        <p>{task.objective}</p>
        <h2>Expected behaviour</h2>
        <p>{task.expected}</p>
        <h2>Examples</h2>
        <ul className="examples">
          {task.examples.map((e) => (
            <li key={e}>
              <code>{e}</code>
            </li>
          ))}
        </ul>
        {task.constraints.length > 0 && (
          <>
            <h2>Constraints</h2>
            <ul>
              {task.constraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        )}
      </aside>

      {/* Code and execution area */}
      <section className="panel code-panel" aria-label="Code">
        <div className="toolbar">
          <span className="file">main.py</span>
          <button onClick={runCode} disabled={running != null}>
            {running === 'code' ? 'Running…' : '▶ Run code'}
          </button>
          <button onClick={runTests} disabled={running != null}>
            {running === 'tests' ? 'Testing…' : '✓ Run tests'}
          </button>
          <button className="quiet" onClick={() => setConfirm({ kind: 'reset' })}>
            Reset code
          </button>
        </div>
        <div className="editor">
          <CodeMirror
            value={draft.code}
            onChange={onCodeChange}
            extensions={[pythonLang()]}
            basicSetup={{ lineNumbers: true, foldGutter: false, autocompletion: false, highlightActiveLine: true }}
            aria-label="Python code editor"
          />
        </div>
        <div className="output">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={outputTab === 'tests'} onClick={() => setOutputTab('tests')}>
              Visible tests
            </button>
            <button role="tab" aria-selected={outputTab === 'console'} onClick={() => setOutputTab('console')}>
              Console
            </button>
          </div>
          <div className="tab-body" role="tabpanel" aria-live="polite">
            {outputTab === 'tests' ? (
              <>
                <TestTable rows={testRows} />
                {task.hiddenTestCount > 0 && <p className="muted small">{task.hiddenTestCount} more hidden tests are checked when you submit.</p>}
              </>
            ) : (
              <pre className="console">
                {running === 'code'
                  ? 'Running…'
                  : consoleOut
                    ? (consoleOut.stdout || '') + (consoleOut.error ? `\n${consoleOut.error}` : '') || '(no output)'
                    : 'Press Run code to see the output here.'}
              </pre>
            )}
          </div>
        </div>
      </section>

      {/* Diagnosis, AI, evidence and decision */}
      <section className="panel side-panel" aria-label="Diagnosis and AI suggestion">
        {task.hasAi ? (
          <>
            <div className="block">
              <h2>1. Your diagnosis</h2>
              {advice ? (
                <blockquote className="own-diagnosis">
                  {advice.student.diagnosisText}
                  <span className="muted small"> {advice.student.suspectedLine ? `(line ${advice.student.suspectedLine})` : '(line not sure)'}</span>
                </blockquote>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void askAi();
                  }}
                >
                  <label className="field">
                    <span>What do you think is wrong?</span>
                    <textarea
                      rows={3}
                      value={draft.diagnosisText}
                      onChange={(e) => setDraft((d) => ({ ...d, diagnosisText: e.target.value }))}
                      placeholder="e.g. the loop stops one item too early"
                    />
                  </label>
                  <label className="field">
                    <span>Which line is most likely wrong?</span>
                    <select value={draft.suspectedLine} onChange={(e) => setDraft((d) => ({ ...d, suspectedLine: e.target.value }))}>
                      <option value="">Not sure</option>
                      {lines.map((l, i) =>
                        l.trim() ? (
                          <option key={i} value={i + 1}>
                            {`Line ${i + 1}: ${l.trim().slice(0, 50)}`}
                          </option>
                        ) : null,
                      )}
                    </select>
                  </label>
                  <button className="primary" disabled={draft.diagnosisText.trim().length < 10 || busy === 'advice'}>
                    {busy === 'advice' ? 'Getting suggestion…' : 'Get AI suggestion'}
                  </button>
                  {draft.diagnosisText.trim().length < 10 && <p className="muted small">Write at least a short sentence to unlock the AI suggestion.</p>}
                </form>
              )}
            </div>

            {advice && (
              <div className="block ai">
                <h2>2. AI suggestion</h2>
                {advice.demo && (
                  <div className="demo-strip small">
                    {advice.demo.condition} · support {advice.demo.level}
                    {advice.demo.score != null && ` · score ${advice.demo.score}`} · {advice.demo.activity}
                    {advice.demo.reasons.length > 0 && <div>{advice.demo.reasons.join('; ')}</div>}
                  </div>
                )}
                {advice.showComparison ? (
                  <div className="compare">
                    <div>
                      <h3>Your diagnosis</h3>
                      <p>{advice.student.diagnosisText}</p>
                      <p className="muted small">{advice.student.suspectedLine ? `Line ${advice.student.suspectedLine}` : 'Line: not sure'}</p>
                    </div>
                    <div>
                      <h3>AI diagnosis</h3>
                      <p>{advice.diagnosis}</p>
                      <p className="muted small">Lines {advice.targetLines.join(', ')}</p>
                    </div>
                  </div>
                ) : (
                  <p>
                    <strong>Diagnosis:</strong> {advice.diagnosis}
                  </p>
                )}
                <p>
                  <strong>Why this fix:</strong> {advice.rationale}
                </p>

                <h3>Suggested patch</h3>
                {patch ? (
                  <PatchDiff before={task.starterCode} after={patch} />
                ) : (
                  <p className="withheld">The full patch is shown after you answer the question below.</p>
                )}

                {advice.check && (
                  <div className={`check-card ${advice.checkDone ? 'done' : ''}`}>
                    <h3>{advice.checkDone ? 'Your check' : 'Quick check before you decide'}</h3>
                    {advice.check.lineText && (
                      <pre className="code-sample">
                        {advice.check.lineNumber}: {advice.check.lineText}
                      </pre>
                    )}
                    <fieldset disabled={advice.checkDone || busy === 'check'}>
                      <legend>{advice.check.question}</legend>
                      {advice.check.options.map((o) => (
                        <label key={o} className="option">
                          <input type="radio" name="check" value={o} checked={checkAnswer === o} onChange={() => setCheckAnswer(o)} />
                          <span>{o}</span>
                        </label>
                      ))}
                    </fieldset>
                    {!advice.checkDone && (
                      <button className="primary" onClick={sendCheck} disabled={!checkAnswer || busy === 'check'}>
                        {busy === 'check' ? 'Checking…' : 'Submit answer'}
                      </button>
                    )}
                    {advice.checkFeedback && (
                      <p className={`feedback ${advice.checkFeedback.correct === false ? 'wrong' : advice.checkFeedback.correct ? 'right' : ''}`} role="status">
                        {advice.checkFeedback.correct === true && <strong>Correct. </strong>}
                        {advice.checkFeedback.correct === false && <strong>Not quite. </strong>}
                        {advice.checkFeedback.text}
                      </p>
                    )}
                  </div>
                )}

                {advice.showEvidence && (
                  <details className="evidence" open={evidenceOpen} onToggle={(e) => {
                    const open = (e.target as HTMLDetailsElement).open;
                    if (open !== evidenceOpen) toggleEvidence(open);
                  }}>
                    <summary>Evidence about this suggestion</summary>
                    {advice.patchTests ? (
                      <TestTable rows={advice.patchTests} caption="The suggested patch on the visible tests" />
                    ) : (
                      <p className="muted small">Loading test evidence…</p>
                    )}
                    <h4>Code checker</h4>
                    {advice.staticWarnings.length ? (
                      <ul className="warnings">
                        {advice.staticWarnings.map((w) => (
                          <li key={w.line + w.message}>
                            <span className="badge warn">⚠ line {w.line}</span> {w.message}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="muted small">No warnings for the patch.</p>
                    )}
                  </details>
                )}
              </div>
            )}

            {advice && (
              <div className="block">
                <h2>3. Your decision</h2>
                <div className="decisions" role="group" aria-label="Decision about the AI suggestion">
                  {DECISIONS.map((d) => (
                    <button key={d.value} className={`decision ${draft.decision === d.value ? 'chosen' : ''}`} aria-pressed={draft.decision === d.value} disabled={!canDecide} onClick={() => chooseDecision(d.value)}>
                      <strong>{d.label}</strong>
                      <span>{d.hint}</span>
                    </button>
                  ))}
                </div>
                {!canDecide && <p className="muted small">The decision buttons unlock after the check above.</p>}
                {draft.decision && (
                  <p className="muted small">
                    {draft.decision === 'accept' && 'The patch is in the editor. You can run the tests before submitting.'}
                    {draft.decision === 'edit' && 'The patch is in the editor. Change it as you like, then run the tests.'}
                    {draft.decision === 'reject' && 'Your own code is back in the editor. Fix it yourself, then run the tests.'}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="block">
            <h2>No AI for this task</h2>
            <p>Fix this one on your own. Use Run code and Run tests as before, then submit when you're happy with your code.</p>
          </div>
        )}

        <div className="block submit-block">
          <ErrorNote error={error} />
          <button className="primary big" disabled={Boolean(submitBlocker) || busy === 'submit'} onClick={() => setConfirm({ kind: 'submit' })}>
            {busy === 'submit' ? 'Checking and saving…' : 'Submit final code'}
          </button>
          {submitBlocker && <p className="muted small">{submitBlocker}</p>}
        </div>
      </section>

      <ConfirmDialog
        open={confirm != null}
        title={confirm?.kind === 'submit' ? 'Submit your final code?' : confirm?.kind === 'reset' ? 'Reset the code?' : 'Replace the code in the editor?'}
        confirmLabel={confirm?.kind === 'submit' ? 'Submit' : confirm?.kind === 'reset' ? 'Reset' : 'Replace'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c?.kind === 'submit') void submit();
          if (c?.kind === 'reset') resetCode();
          if (c?.kind === 'decision') chooseDecision(c.decision, true);
        }}
      >
        {confirm?.kind === 'submit' && (
          <p>
            {draft.decision ? `Your decision: ${draft.decision}. ` : ''}You can't change this task after submitting. The code will be checked against
            all tests.
          </p>
        )}
        {confirm?.kind === 'reset' && <p>This undoes your changes since the last time the code was replaced. It can't be undone.</p>}
        {confirm?.kind === 'decision' && <p>You have changed the code in the editor. Choosing this option replaces those changes.</p>}
      </ConfirmDialog>
    </div>
  );
}
