import { useState } from 'react';
import { api, type SessionView } from '../lib/api';
import { AGENCY_ITEMS, POST_TASK_ITEMS, SUS_ITEMS, TLX_ITEMS } from '../study/surveyItems';
import { ChoiceGroup, ErrorNote, Likert, TlxSlider, useSubmit } from '../components/Form';

type Answers = Record<string, string | number>;

function useAnswers() {
  const [answers, setAnswers] = useState<Answers>({});
  const set = (k: string) => (v: string | number) => setAnswers((a) => ({ ...a, [k]: v }));
  const str = (k: string) => (answers[k] == null ? undefined : String(answers[k]));
  return { answers, set, str };
}

function SurveyForm(props: { title: string; intro?: string; required: string[]; answers: Answers; kind: string; pid: string; onDone: (s: SessionView) => void; children: React.ReactNode }) {
  const { busy, error, run, setError } = useSubmit(async () => {
    const numeric = Object.fromEntries(Object.entries(props.answers).map(([k, v]) => [k, typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v]));
    props.onDone(await api.survey(props.pid, props.kind, numeric));
  });
  const missing = props.required.filter((k) => props.answers[k] == null || props.answers[k] === '').length;
  return (
    <div className="page narrow">
      <h1>{props.title}</h1>
      {props.intro && <p className="lead">{props.intro}</p>}
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          if (missing) return setError(`Please answer every question (${missing} left).`);
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

export function PostTask({ pid, withAi, onDone }: { pid: string; withAi: boolean; onDone: (s: SessionView) => void }) {
  const { answers, set, str } = useAnswers();
  const items = POST_TASK_ITEMS.filter((i) => withAi || !i.ai);
  return (
    <SurveyForm title="About that task" intro="Four quick ratings about the task you just finished." kind="post_task" pid={pid} answers={answers} required={items.map((i) => i.id)} onDone={onDone}>
      {items.map((i) => (
        <Likert key={i.id} name={i.id} text={i.text} low={i.low} high={i.high} value={str(i.id)} onChange={set(i.id)} />
      ))}
    </SurveyForm>
  );
}

export function PostCondition({ pid, part, onDone }: { pid: string; part: number; onDone: (s: SessionView) => void }) {
  const { answers, set, str } = useAnswers();
  const required = [...TLX_ITEMS.map((i) => i.id), ...SUS_ITEMS.map((i) => i.id), ...AGENCY_ITEMS.map((i) => i.id)];
  return (
    <SurveyForm
      title={`Questions about Part ${part}`}
      intro={`Think about the two tasks you just did in Part ${part} and the way the AI suggestions were shown.`}
      kind="post_condition"
      pid={pid}
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

export function FinalSurvey({ pid, parts, onDone }: { pid: string; parts: number; onDone: (s: SessionView) => void }) {
  const { answers, set, str } = useAnswers();
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
