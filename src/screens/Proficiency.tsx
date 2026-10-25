import { useEffect, useState } from 'react';
import { api, type SessionView } from '../lib/api';
import { ChoiceGroup, ErrorNote, useSubmit } from '../components/Form';

type Question = { id: string; prompt: string; code: string; options: string[] };

export function Proficiency({ pid, onDone }: { pid: string; onDone: (s: SessionView) => void }) {
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const load = () => {
    setLoadError(null);
    api.proficiencyQuestions().then(setQuestions, (e) => setLoadError(e.message));
  };
  useEffect(load, []);

  const { busy, error, run, setError } = useSubmit(async () => onDone(await api.submitProficiency(pid, answers)));

  if (loadError)
    return (
      <div className="page narrow">
        <ErrorNote error={loadError} />
        <button onClick={load}>Try again</button>
      </div>
    );
  if (!questions) return <div className="page narrow">Loading questions…</div>;

  const unanswered = questions.filter((q) => !answers[q.id]).length;

  return (
    <div className="page narrow">
      <h1>A few Python questions</h1>
      <p className="lead">
        These help us understand your background. They are not a test of you, and there's no time limit. If you don't know, pick your
        best guess.
      </p>
      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          if (unanswered) return setError(`Please answer all questions (${unanswered} left).`);
          void run();
        }}
      >
        {questions.map((q, i) => (
          <div key={q.id} className="quiz">
            <ChoiceGroup
              name={q.id}
              legend={
                <>
                  <span>
                    {i + 1}. {q.prompt}
                  </span>
                  <pre className="code-sample">{q.code}</pre>
                </>
              }
              value={answers[q.id]}
              onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
              options={q.options.map((o) => ({ value: o, label: <code>{o}</code> }))}
            />
          </div>
        ))}
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  );
}
