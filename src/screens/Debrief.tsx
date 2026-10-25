import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ErrorNote } from '../components/Form';

type DebriefData = Awaited<ReturnType<typeof api.debrief>>;

export function Debrief({ pid, onLeave }: { pid: string; onLeave: () => void }) {
  const [data, setData] = useState<DebriefData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.debrief(pid).then(setData, (e) => setError(e.message));
  }, [pid]);

  return (
    <div className="page narrow">
      <h1>Thank you, you're done</h1>
      <div className="card">
        <p className="lead">All your answers are saved. Thank you for taking part.</p>
        <h2>What this study was about</h2>
        <p>
          We are studying how a coding interface can help students decide when to trust AI suggestions and when to question them. In the
          three parts, the AI suggestions were shown in different ways: sometimes straight away, sometimes with a check before you could
          decide, and sometimes with more or less support depending on the situation.
        </p>
        <p>
          <strong>Some AI suggestions were wrong on purpose.</strong> They were written in advance so that every participant saw the same
          suggestions. Accepting a wrong suggestion is very common and doesn't say anything bad about your programming.
        </p>
        <ErrorNote error={error} />
        {data && (
          <>
            <h2>The suggestions you saw</h2>
            <table className="debrief">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col">Task</th>
                  <th scope="col">AI suggestion</th>
                  <th scope="col">What was going on</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => (
                  <tr key={t.title}>
                    <td>{t.part}</td>
                    <td>{t.title}</td>
                    <td>{t.aiWasCorrect ? <span className="badge pass">✓ correct</span> : <span className="badge fail">✗ wrong or incomplete</span>}</td>
                    <td>{t.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.conditionOrder && <p className="demo-strip small">Demo: order was {data.conditionOrder.join(' → ')}</p>}
          </>
        )}
        <p>Please don't tell other students which suggestions were wrong until the study is over. If you have questions, ask the researcher now.</p>
        <button onClick={onLeave}>Finish and close the session</button>
      </div>
    </div>
  );
}
