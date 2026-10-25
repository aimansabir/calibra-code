import { useState } from 'react';
import { api, type SessionView } from '../lib/api';
import { suggestParticipantId } from '../lib/id';
import { ChoiceGroup, ErrorNote, Likert, useSubmit } from '../components/Form';

const params = new URLSearchParams(location.search);
const isDemo = params.get('demo') === '1';
// Researchers can pin a counterbalancing order with ?order=1..6; otherwise the server balances.
const orderParam = params.get('order');
const orderOverride = orderParam && /^[1-6]$/.test(orderParam) ? Number(orderParam) - 1 : undefined;

export function Setup({ onStarted }: { onStarted: (s: SessionView) => void }) {
  const [id, setId] = useState(() => suggestParticipantId());
  const [year, setYear] = useState('');
  const [experience, setExperience] = useState('');
  const [confidence, setConfidence] = useState<string>();
  const [aiUse, setAiUse] = useState('');
  const [consent, setConsent] = useState(false);

  const missing = [
    !id.trim() && 'participant ID',
    !year && 'year of study',
    !experience && 'programming experience',
    !confidence && 'Python confidence',
    !aiUse && 'AI tool use',
    !consent && 'consent',
  ].filter(Boolean) as string[];

  const { busy, error, run, setError } = useSubmit(async () => {
    const s = await api.register({
      id: id.trim(),
      isDemo,
      orderOverride,
      yearOfStudy: year,
      experience,
      pythonConfidence: Number(confidence),
      aiToolUse: aiUse,
      consent,
    });
    onStarted(s);
  });

  return (
    <div className="page narrow">
      <h1>CALIBRA CODE study</h1>
      {isDemo && <p className="demo-strip">Demo mode: this session is marked as demo data and left out of the study exports.</p>}

      <section className="card">
        <h2>About this study</h2>
        <p>
          You will fix small bugs in Python programs. For most tasks an AI assistant will suggest a diagnosis and a fix, and you decide
          whether to accept, edit or reject it. The session takes about 40 to 50 minutes.
        </p>
        <ul>
          <li>Taking part is voluntary. You can stop at any time without giving a reason and without any penalty.</li>
          <li>Your results are not connected to any course grade.</li>
          <li>We do not ask for your name or student number. Data is stored under the anonymous ID below and only the project team and supervisor can access it.</li>
          <li>Code runs only inside this browser tab and on the study server.</li>
        </ul>
      </section>

      <form
        className="card form"
        onSubmit={(e) => {
          e.preventDefault();
          if (missing.length) return setError(`Please complete: ${missing.join(', ')}.`);
          void run();
        }}
      >
        <h2>Your background</h2>
        <label className="field">
          <span>Anonymous participant ID</span>
          <span className="row">
            <input value={id} onChange={(e) => setId(e.target.value)} maxLength={32} autoComplete="off" spellCheck={false} />
            <button type="button" onClick={() => setId(suggestParticipantId())}>
              New ID
            </button>
          </span>
          <small>Keep this ID if the researcher gave you one. Please don't use your name.</small>
        </label>

        <label className="field">
          <span>Year of study</span>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Choose…</option>
            {['1st year', '2nd year', '3rd year', '4th year', 'Postgraduate', 'Other'].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Programming experience</span>
          <select value={experience} onChange={(e) => setExperience(e.target.value)}>
            <option value="">Choose…</option>
            {['Less than 1 year', '1 to 2 years', '2 to 4 years', 'More than 4 years'].map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </label>

        <Likert name="confidence" text="How confident are you writing Python?" points={5} low="Not at all" high="Very" value={confidence} onChange={setConfidence} />

        <ChoiceGroup
          name="ai"
          legend="How often do you use AI tools (e.g. ChatGPT, Copilot) for coding?"
          inline
          value={aiUse}
          onChange={setAiUse}
          options={['Never', 'Rarely', 'Monthly', 'Weekly', 'Daily'].map((v) => ({ value: v }))}
        />

        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I have read the information above, I am taking part voluntarily, and I agree that my anonymous responses can be used for this research.</span>
        </label>

        <ErrorNote error={error} />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Starting…' : 'Start'}
        </button>
      </form>
    </div>
  );
}
