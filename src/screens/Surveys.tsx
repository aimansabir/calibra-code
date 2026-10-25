import { useEffect, useState } from 'react';
import { api, type SessionView } from '../lib/api';
import { AGENCY_ITEMS, POST_TASK_ITEMS, SUS_ITEMS, TLX_ITEMS } from '../study/surveyItems';
import { ChoiceGroup, ErrorNote, Likert, TlxSlider, useSubmit } from '../components/Form';

type Answers = Record<string, string | number>;

// Answers are kept in this browser until the survey is submitted, so a reload
// or a dropped connection doesn't make the participant start the page again.
const answersKey = (pid: string, stepIndex: number) => `calibra.survey.${pid}.${stepIndex}`;

function useAnswers(pid: string, stepIndex: number) {
  const [answers, setAnswers] = useState<Answers>(() => {
    try {
      return JSON.parse(localStorage.getItem(answersKey(pid, stepIndex)) ?? '{}');
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(answersKey(pid, stepIndex), JSON.stringify(answers));
    } catch {
      // private window: answers only live as long as the page
    }
  }, [answers]);
  const set = (k: string) => (v: string | number) => setAnswers((a) => ({ ...a, [k]: v }));
  const str = (k: string) => (answers[k] == null ? undefined : String(answers[k]));
  return { answers, set, str };
}

function SurveyForm(props: {
  title: string;
  intro?: string;
  required: string[];
  answers: Answers;
  kind: string;
  pid: string;
  stepIndex: number;
  onDone: (s: SessionView) => void;
  children: React.ReactNode;
}) {
  const { busy, error, run, setError } = useSubmit(async () => {
    const numeric = Object.fromEntries(Object.entries(props.answers).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v]));
    const next = await api.survey(props.pid, props.kind, numeric);
    try {
      localStorage.removeItem(answersKey(props.pid, props.stepIndex));
    } catch {
      // ignore
    }
    props.onDone(next);
  });
  const unanswered = props.required.filter((k) => props.answers[k] == null || props.answers[k] === '');
  const missing = unanswered.length;
  return (
    <div className="page narrow">
      <h1>{props.title}</h1>
      {props.intro && <p className="lead">{props.intro}</p>}
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          if (missing) {
            setError(`Please answer every question (${missing} left). The first one left is now selected.`);
            // Radio groups are found by name, the workload sliders by id.
            const first = document.querySelector<HTMLInputElement>(`[name="${unanswered[0]}"], #${unanswered[0]}`);
            first?.focus();
            first?.scrollIntoView({ block: 'center' });
            return;
          }
          void run();
        }}
      >
        {props.children}
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}

export function PostTask({ pid, stepIndex, withAi, onDone }: { pid: string; stepIndex: number; withAi: boolean; onDone: (s: SessionView) => void }) {
  const { answers, set, str } = useAnswers(pid, stepIndex);
  const items = POST_TASK_ITEMS.filter((i) => withAi || !i.ai);
  return (
    <SurveyForm title="About that task" intro="Four quick ratings about the task you just finished." kind="post_task" pid={pid} stepIndex={stepIndex} answers={answers} required={items.map((i) => i.id)} onDone={onDone}>
      {items.map((i) => (
        <Likert key={i.id} name={i.id} text={i.text} low={i.low} high={i.high} value={str(i.id)} onChange={set(i.id)} />
      ))}
    </SurveyForm>
  );
}

export function PostCondition({ pid, stepIndex, part, onDone }: { pid: string; stepIndex: number; part: number; onDone: (s: SessionView) => void }) {
  const { answers, set, str } = useAnswers(pid, stepIndex);
  const required = [...TLX_ITEMS.map((i) => i.id), ...SUS_ITEMS.map((i) => i.id), ...AGENCY_ITEMS.map((i) => i.id)];
  return (
    <SurveyForm
      title={`Questions about Part ${part}`}
      intro={`Think about the two tasks you just did in Part ${part} and the way the AI suggestions were shown.`}
      kind="post_condition"
      pid={pid}
      stepIndex={stepIndex}
      answers={answers}
      required={required}
      onDone={onDone}
    >
      <h2>Workload</h2>
      <p className="muted small">Move each slider to the point that matches your experience.</p>
      {TLX_ITEMS.map((i) => (
        <TlxSlider key={i.id} {...i} value={answers[i.id] as number | undefined} onChange={set(i.id)} />
      ))}

      <h2>The interface in this part</h2>
      {SUS_ITEMS.map((i, n) => (
        <Likert key={i.id} name={i.id} text={`${n + 1}. ${i.text}`} points={5} low="Strongly disagree" high="Strongly agree" value={str(i.id)} onChange={set(i.id)} />
      ))}

      <h2>Control and confidence</h2>
      {AGENCY_ITEMS.map((i) => (
        <Likert key={i.id} name={i.id} text={i.text} low="Strongly disagree" high="Strongly agree" value={str(i.id)} onChange={set(i.id)} />
      ))}

      <label className="field">
        <span>Anything that helped or got in the way in this part? (optional)</span>
        <textarea rows={3} value={str('comment') ?? ''} onChange={(e) => set('comment')(e.target.value)} />
      </label>
    </SurveyForm>
  );
}

export function FinalSurvey({ pid, stepIndex, parts, onDone }: { pid: string; stepIndex: number; parts: number; onDone: (s: SessionView) => void }) {
  const { answers, set, str } = useAnswers(pid, stepIndex);
  const partOptions = Array.from({ length: parts }, (_, i) => ({ value: `Part ${i + 1}` }));
  const choices = [
    { id: 'prefer_overall', text: 'Which part would you most like to use for your own coding?' },
    { id: 'prefer_trust', text: 'In which part was it easiest to decide whether to trust the AI?' },
    { id: 'prefer_least_effort', text: 'Which part felt the least demanding?' },
  ];
  return (
    <SurveyForm
      title="Last few questions"
      intro="You've finished all the tasks. Looking back over Parts 1 to 3:"
      kind="final"
      pid={pid}
      stepIndex={stepIndex}
      answers={answers}
      required={choices.map((c) => c.id)}
      onDone={onDone}
    >
      {choices.map((c) => (
        <ChoiceGroup key={c.id} name={c.id} legend={c.text} inline value={str(c.id)} onChange={set(c.id)} options={partOptions} />
      ))}
      <label className="field">
        <span>What support or evidence was most useful? (optional)</span>
        <textarea rows={3} value={str('useful') ?? ''} onChange={(e) => set('useful')(e.target.value)} />
      </label>
      <label className="field">
        <span>Was anything an unnecessary interruption? (optional)</span>
        <textarea rows={3} value={str('interruptions') ?? ''} onChange={(e) => set('interruptions')(e.target.value)} />
      </label>
      <label className="field">
        <span>Was anything confusing? (optional)</span>
        <textarea rows={3} value={str('confusing') ?? ''} onChange={(e) => set('confusing')(e.target.value)} />
      </label>
    </SurveyForm>
  );
}
