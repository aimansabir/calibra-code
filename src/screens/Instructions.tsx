import { api, type SessionView } from '../lib/api';
import { ErrorNote, useSubmit } from '../components/Form';

export function Instructions({ pid, onDone }: { pid: string; onDone: (s: SessionView) => void }) {
  const { busy, error, run } = useSubmit(async () => onDone(await api.finishInstructions(pid)));
  return (
    <div className="page narrow">
      <h1>How the tasks work</h1>
      <div className="card">
        <p className="lead">Each task is a short Python function with a bug. Your job is to end up with working code.</p>
        <ol className="steps">
          <li>
            <strong>Read and inspect.</strong> The task on the left says what the function should do. The code is in the editor in the
            middle. Use <em>Run code</em> to see the output and <em>Run tests</em> to check the visible tests.
          </li>
          <li>
            <strong>Write your own diagnosis first.</strong> In one or two sentences, say what you think is wrong and, if you can, which
            line. The AI suggestion only appears after this.
          </li>
          <li>
            <strong>Look at the AI suggestion.</strong> It gives a diagnosis, a reason and a patch. Sometimes you will be asked a short
            question about the suggestion before you decide.
          </li>
          <li>
            <strong>Decide.</strong> <em>Accept</em> uses the patch as it is. <em>Edit</em> starts from the patch so you can change it.{' '}
            <em>Reject</em> keeps your own code. You can still edit the code and run tests after deciding.
          </li>
          <li>
            <strong>Submit.</strong> Your final code is checked against the visible tests and some extra hidden tests.
          </li>
        </ol>
        <p>
          <strong>The AI is not always right.</strong> Treat it like a classmate's suggestion: often helpful, sometimes wrong. The tasks
          come in three parts with a few questions after each part, then one final task without AI.
        </p>
        <p>Next is a practice task so you can try everything out. It isn't counted.</p>
        <ErrorNote error={error} />
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? 'Loading…' : 'Start the practice task'}
        </button>
      </div>
    </div>
  );
}
