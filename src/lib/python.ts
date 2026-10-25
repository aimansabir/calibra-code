import { useEffect, useState } from 'react';
import type { TestCase, TestResult } from '../study/types';

export type RunnerStatus = 'loading' | 'ready' | 'error';

export interface RunOutput {
  stdout: string;
  error: string | null;
}

// A student's while loop can easily never end, and Pyodide can't be
// interrupted from outside, so a run that takes too long kills the worker.
const TIMEOUT_MS = 5000;
// Pyodide is about 10 MB. A lab network can be slow, but not this slow.
const LOAD_TIMEOUT_MS = 120000;
export const UNAVAILABLE = "Python isn't available in this browser right now. Press Retry Python at the top of the page.";

type PendingJob = { resolve: (v: any) => void; reject: (e: Error) => void; timer: number };

class PythonRunner {
  private worker: Worker | undefined;
  private jobs = new Map<number, PendingJob>();
  private nextId = 1;
  private listeners = new Set<(s: RunnerStatus) => void>();
  status: RunnerStatus = 'loading';
  loadError = '';
  private loadTimer: number | undefined;

  constructor() {
    this.start();
  }

  private start() {
    this.setStatus('loading');
    this.loadError = '';
    clearTimeout(this.loadTimer);
    this.loadTimer = window.setTimeout(() => this.fail('Python took too long to load.'), LOAD_TIMEOUT_MS);
    try {
      this.worker = new Worker('/py-worker.mjs', { type: 'module' });
    } catch {
      return this.fail('The Python runtime could not start.');
    }
    this.worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'ready') {
        clearTimeout(this.loadTimer);
        this.setStatus('ready');
      } else if (msg.type === 'load-error') this.fail(msg.error);
      else if (msg.type === 'result') {
        const job = this.jobs.get(msg.id);
        if (!job) return;
        clearTimeout(job.timer);
        this.jobs.delete(msg.id);
        if (msg.ok) job.resolve(msg.result);
        else job.reject(new Error(msg.error));
      }
    };
    this.worker.onerror = () => this.fail('The Python runtime could not start.');
  }

  private fail(reason: string) {
    clearTimeout(this.loadTimer);
    this.loadError = reason;
    for (const job of this.jobs.values()) {
      clearTimeout(job.timer);
      job.reject(new Error(UNAVAILABLE));
    }
    this.jobs.clear();
    this.setStatus('error');
  }

  // The participant's way out when loading failed (e.g. a dropped connection
  // while Pyodide was downloading). Starts a fresh worker.
  retry() {
    this.restart(UNAVAILABLE);
  }

  private restart(reason: string) {
    this.worker?.terminate();
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
    if (this.status === 'error') return Promise.reject(new Error(UNAVAILABLE));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(
        () => this.restart('Your code ran for more than 5 seconds and was stopped. Check for a loop that never ends.'),
        TIMEOUT_MS + (this.status === 'loading' ? LOAD_TIMEOUT_MS : 0),
      );
      this.jobs.set(id, { resolve, reject, timer });
      this.worker!.postMessage({ id, kind, code, tests });
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

export function useRunnerStatus() {
  const [status, setStatus] = useState<RunnerStatus>(() => python().status);
  useEffect(() => {
    setStatus(python().status);
    return python().onStatus(setStatus);
  }, []);
  return status;
}
