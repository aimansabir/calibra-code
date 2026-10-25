import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, flushEvents, logEvent, onSaveState, type SessionView, type Step } from './lib/api';
import { python, type RunnerStatus } from './lib/python';
import { Setup } from './screens/Setup';
import { Proficiency } from './screens/Proficiency';
import { Instructions } from './screens/Instructions';
import { Workspace } from './screens/Workspace';
import { PostTask, PostCondition, FinalSurvey } from './screens/Surveys';
import { Debrief } from './screens/Debrief';

const SESSION_KEY = 'calibra.session';

function storedSession() {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function storeSession(id: string | null) {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    // private window, the session just won't survive a reload
  }
}

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

export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(Boolean(storedSession()));
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [saveState, setSaveState] = useState('saved');
  const [runner, setRunner] = useState<RunnerStatus>('loading');

  useEffect(() => onSaveState(setSaveState), []);
  useEffect(() => python().onStatus(setRunner), []);
  useEffect(() => setRunner(python().status), []);

  const load = useCallback(async () => {
    const id = storedSession();
    if (!id) return setLoading(false);
    setLoading(true);
    setError(null);
    try {
      setSession(await api.session(id));
      void flushEvents();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        storeSession(null);
        setSession(null);
      } else setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const update = useCallback((s: SessionView, message?: string) => {
    setSession(s);
    setFlash(message ?? null);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!session) return;
    const step = session.steps[session.stepIndex];
    logEvent(session.participantId, 'step_open', 'taskId' in step ? step.taskId : null, { stepIndex: session.stepIndex, kind: step.kind });
  }, [session?.participantId, session?.stepIndex]);

  if (loading) return <Centered>Loading your session…</Centered>;
  if (error)
    return (
      <Centered>
        <p role="alert">{error}</p>
        <button className="primary" onClick={load}>
          Try again
        </button>
      </Centered>
    );

  if (!session) {
    return (
      <Setup
        onStarted={(s) => {
          storeSession(s.participantId);
          update(s);
        }}
      />
    );
  }

  const step = session.steps[session.stepIndex];
  const pid = session.participantId;
  const done = session.steps.filter((s) => s.kind === 'task').length;
  const taskPos = session.steps.slice(0, session.stepIndex + 1).filter((s) => s.kind === 'task').length;

  let screen;
  switch (step.kind) {
    case 'proficiency':
      screen = <Proficiency pid={pid} onDone={update} />;
      break;
    case 'instructions':
      screen = <Instructions pid={pid} onDone={update} />;
      break;
    case 'task':
      screen = session.task ? <Workspace key={session.task.id} pid={pid} step={step} task={session.task} onDone={update} /> : null;
      break;
    case 'post_task':
      screen = <PostTask key={step.taskId} pid={pid} withAi={step.role !== 'transfer'} onDone={update} />;
      break;
    case 'post_condition':
      screen = <PostCondition key={step.part} pid={pid} part={step.part} onDone={update} />;
      break;
    case 'final':
      screen = <FinalSurvey pid={pid} parts={session.steps.filter((s) => s.kind === 'post_condition').length} onDone={update} />;
      break;
    case 'debrief':
      screen = (
        <Debrief
          pid={pid}
          onLeave={() => {
            storeSession(null);
            setSession(null);
          }}
        />
      );
      break;
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">CALIBRA CODE</span>
        <span className="step-label">{stepLabel(step, session.steps)}</span>
        {step.kind !== 'debrief' && (
          <progress aria-label="Study progress" max={session.steps.length - 1} value={session.stepIndex} />
        )}
        <span className="status-group">
          <span className={`status runner-${runner}`} title="Python runtime in your browser">
            {runner === 'ready' ? 'Python ready' : runner === 'loading' ? 'Python loading…' : 'Python unavailable'}
          </span>
          <span className={`status save-${saveState}`} aria-live="polite">
            {saveState === 'saved' ? 'All progress saved' : saveState === 'saving' ? 'Saving…' : 'Offline, will retry'}
          </span>
          <span className="pid">ID {pid}</span>
        </span>
      </header>
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
      <main>{screen}</main>
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
