import type { TestCase, TestResult } from '../study/types';

export type RunnerStatus = 'loading' | 'ready' | 'error';

export interface RunOutput {
  stdout: string;
  error: string | null;
}

// A student's while loop can easily never end, and Pyodide can't be
// interrupted from outside, so a run that takes too long kills the worker.
const TIMEOUT_MS = 5000;

type PendingJob = { resolve: (v: any) => void; reject: (e: Error) => void; timer: number };

class PythonRunner {
  private worker!: Worker;
  private jobs = new Map<number, PendingJob>();
  private nextId = 1;
  private listeners = new Set<(s: RunnerStatus) => void>();
  status: RunnerStatus = 'loading';
  loadError = '';

  constructor() {
    this.start();
  }

  private start() {
    this.setStatus('loading');
    this.worker = new Worker('/py-worker.mjs', { type: 'module' });
    this.worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') this.setStatus('ready');
      else if (msg.type === 'load-error') {
        this.loadError = msg.error;
        this.setStatus('error');
      } else if (msg.type === 'result') {
        const job = this.jobs.get(msg.id);
        if (!job) return;
        clearTimeout(job.timer);
        this.jobs.delete(msg.id);
        if (msg.ok) job.resolve(msg.result);
        else job.reject(new Error(msg.error));
      }
    };
    this.worker.onerror = () => {
      this.loadError = 'The Python runtime could not start.';
      this.setStatus('error');
    };
  }

  private restart(reason: string) {
    this.worker.terminate();
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(reason));
    }
    this.jobs.clear();
    this.start();
  }

  private setStatus(s: RunnerStatus) {
    this.status = s;
    this.listeners.forEach((l) => l(s));
  }

  onStatus(fn: (s: RunnerStatus) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private call<T>(kind: 'run' | 'tests', code: string, tests?: TestCase[]): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(
        () => this.restart('Your code ran for more than 5 seconds and was stopped. Check for a loop that never ends.'),
        TIMEOUT_MS + (this.status === 'loading' ? 60000 : 0),
      );
      this.jobs.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, kind, code, tests });
    });
  }

  async run(code: string): Promise<RunOutput> {
    try {
      return await this.call<RunOutput>('run', code);
    } catch (e) {
      return { stdout: '', error: (e as Error).message };
    }
  }

  async tests(code: string, tests: TestCase[]): Promise<TestResult[]> {
    try {
      const out = await this.call<{ results: TestResult[] }>('tests', code, tests);
      return out.results;
    } catch (e) {
      const msg = (e as Error).message;
      return tests.map((t) => ({ ...t, passed: false, actual: 'stopped', error: msg }));
    }
  }
}

let runner: PythonRunner | null = null;
export function python() {
  runner ??= new PythonRunner();
  return runner;
}
