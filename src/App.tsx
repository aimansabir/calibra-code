import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, ApiError, flushEvents, logEvent, onSaveState, onStale, storedSession, storeSession, type SaveState, type SessionView, type Step } from './lib/api';
import { python, useRunnerStatus } from './lib/python';
import { Setup } from './screens/Setup';
import { Proficiency } from './screens/Proficiency';
import { Instructions } from './screens/Instructions';
import { Workspace } from './screens/Workspace';
import { PostTask, PostCondition, FinalSurvey } from './screens/Surveys';
import { Debrief } from './screens/Debrief';

function stepLabel(step: Step, steps: Step[]) {
  const parts = new Set(steps.flatMap((s) => ('part' in s && s.part ? [s.part] : []))).size;
  switch (step.kind) {
    case 'proficiency':
      return 'Python questions';
    case 'instructions':
      return 'How it works';
    case 'task':
      if (step.role === 'practice') return 'Practice task';
      if (step.role === 'transfer') return 'Final task';
      return `Part ${step.part} of ${parts} · Task ${step.index} of 2`;
    case 'post_task':
      return step.role === 'transfer' ? 'Final task · Questions' : `Part ${step.part} of ${parts} · Questions`;
    case 'post_condition':
      return `Part ${step.part} of ${parts} · Questions about this part`;
    case 'final':
      return 'Final questions';
    case 'debrief':
      return 'Finished';
  }
}

function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(Boolean(storedSession()));
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ state: 'saved', pending: 0 });
  const runner = useRunnerStatus();
  const online = useOnline();
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => onSaveState(setSave), []);

  const load = useCallback(async (message?: string) => {
    const stored = storedSession();
    if (!stored) return setLoading(false);
    setLoading(true);
    setError(null);
    try {
      setSession(await api.session(stored.participantId));
      setFlash(message ?? null);
      void flushEvents();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 401)) {
        storeSession(null);
        setSession(null);
      } else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);
  // A step that was already completed (e.g. a submit whose response was lost):
  // pick up wherever the server says the participant is.
  useEffect(() => onStale(() => void load('That step was already saved, so you have been taken to where you are now.')), [load]);

  const update = useCallback((s: SessionView, message?: string) => {
    setSession(s);
    setFlash(message ?? null);
    window.scrollTo(0, 0);
  }, []);

  const stepIndex = session?.stepIndex;
  const step = session ? session.steps[session.stepIndex] : null;

  useEffect(() => {
    if (!session || !step) return;
    logEvent({ participantId: session.participantId, stepIndex: session.stepIndex, taskId: 'taskId' in step ? step.taskId : null }, 'step_open', { kind: step.kind });
  }, [session?.participantId, stepIndex]);

  // Move focus to the new screen's heading so keyboard and screen reader users
  // start at the top of it instead of on a button that no longer exists.
  useLayoutEffect(() => {
    if (stepIndex == null) return;
    document.title = `${step ? stepLabel(step, session!.steps) : 'Study'} · CALIBRA CODE`;
    const target = mainRef.current?.querySelector('h1') ?? mainRef.current;
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }, [session?.participantId, stepIndex]);

  if (loading) return <Centered>Loading your session…</Centered>;
  if (error)
    return (
      <Centered>
        <p role="alert">{error}</p>
        <button className="primary" onClick={() => void load()}>
          Try again
        </button>
      </Centered>
    );

  if (!session || !step) {
    return (
      <Setup
        onStarted={(s) => {
          if (s.token) storeSession({ participantId: s.participantId, token: s.token });
          update(s);
        }}
      />
    );
  }

  const pid = session.participantId;
  const done = session.steps.filter((s) => s.kind === 'task').length;
  const taskPos = session.steps.slice(0, session.stepIndex + 1).filter((s) => s.kind === 'task').length;
  const offline = !online || save.state === 'offline';

  let screen;
  switch (step.kind) {
    case 'proficiency':
      screen = <Proficiency pid={pid} onDone={update} />;
      break;
    case 'instructions':
      screen = <Instructions pid={pid} onDone={update} />;
      break;
    case 'task':
      screen = session.task ? <Workspace key={session.task.id} pid={pid} stepIndex={session.stepIndex} step={step} task={session.task} onDone={update} /> : null;
      break;
    case 'post_task':
      screen = <PostTask key={step.taskId} pid={pid} stepIndex={session.stepIndex} withAi={step.role !== 'transfer'} onDone={update} />;
      break;
    case 'post_condition':
      screen = <PostCondition key={step.part} pid={pid} stepIndex={session.stepIndex} part={step.part} onDone={update} />;
      break;
    case 'final':
      screen = <FinalSurvey pid={pid} stepIndex={session.stepIndex} parts={session.steps.filter((s) => s.kind === 'post_condition').length} onDone={update} />;
      break;
    case 'debrief':
      screen = (
        <Debrief
          pid={pid}
          onLeave={() => {
            void flushEvents();
            storeSession(null);
            setSession(null);
          }}
        />
      );
      break;
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="topbar">
        <span className="brand">CALIBRA CODE</span>
        <span className="step-label">{stepLabel(step, session.steps)}</span>
        {step.kind !== 'debrief' && (
          <progress
            aria-label="Study progress"
            aria-valuetext={`Step ${session.stepIndex + 1} of ${session.steps.length}`}
            max={session.steps.length - 1}
            value={session.stepIndex}
          />
        )}
        <span className="status-group">
          <span className={`status runner-${runner}`} title="Python runtime in your browser" role="status">
            {runner === 'ready' ? 'Python ready' : runner === 'loading' ? 'Python loading…' : 'Python unavailable'}
          </span>
          {runner === 'error' && (
            <button className="topbar-button" onClick={() => python().retry()}>
              Retry Python
            </button>
          )}
          <span className={`status save-${offline ? 'offline' : save.state}`} aria-live="polite">
            {offline ? 'Offline, will retry' : save.state === 'saved' ? 'All progress saved' : 'Saving…'}
          </span>
          <span className="pid">ID {pid}</span>
        </span>
      </header>
      {offline && (
        <div className="offline-banner" role="status">
          <span>
            <strong>{online ? "Can't reach the study server." : 'This computer is offline.'}</strong> You can keep working: your code and answers on this screen
            stay in this browser{save.pending > 0 ? `, and ${save.pending} activity ${save.pending === 1 ? 'record is' : 'records are'} waiting to be sent` : ''}.
            Submitting and moving on need the connection, so tell the researcher if this doesn't clear up.
          </span>
          <button onClick={() => void flushEvents()}>Try again now</button>
        </div>
      )}
      {session.isDemo && session.demo && (
        <div className="demo-strip" role="note">
          Demo mode, not study data · order {session.demo.orderIndex + 1}: {session.demo.conditionOrder.join(' → ')}
          {session.demo.proficiency && ` · proficiency: ${session.demo.proficiency}`}
          {session.demo.stepCondition && ` · this step: ${session.demo.stepCondition}`}
          {step.kind === 'task' && ` · task ${taskPos} of ${done}`}
        </div>
      )}
      {flash && (
        <div className="flash" role="status">
          {flash}
          <button className="link" onClick={() => setFlash(null)} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}
      <main id="main" ref={mainRef} tabIndex={-1}>
        {screen}
      </main>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="centered">
      <div className="card">{children}</div>
    </div>
  );
}
