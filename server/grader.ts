import { fork, type ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { TestCase, TestResult } from '../src/study/types';

const here = dirname(fileURLToPath(import.meta.url));
const childScript = join(here, 'grader-child.mjs');
const pyodideDir = resolve(here, '..', 'node_modules', 'pyodide');
const harness = resolve(here, '..', 'public', 'harness.py');

const TIMEOUT_MS = 8000;

type Job = { code: string; tests: TestCase[]; resolve: (r: TestResult[]) => void };

// One warm child at a time, jobs run in order. A job that runs too long
// (usually a loop that never ends) kills the child and a fresh one starts.
export class Grader {
  private child: ChildProcess | null = null;
  private ready: Promise<void> | null = null;
  private queue: Job[] = [];
  private busy = false;
  private nextId = 1;

  private spawn() {
    const child = fork(childScript, [pathToFileURL(join(pyodideDir, 'pyodide.mjs')).href, harness], {
      execArgv: ['--permission', `--allow-fs-read=${pyodideDir}`, `--allow-fs-read=${harness}`, `--allow-fs-read=${childScript}`, '--max-old-space-size=256'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    let stderr = '';
    child.stderr?.on('data', (d) => (stderr += d));
    this.child = child;
    this.ready = new Promise((ok, fail) => {
      const onMsg = (m: any) => {
        if (m?.ready) {
          child.off('message', onMsg);
          ok();
        }
      };
      child.on('message', onMsg);
      child.once('exit', (code) => fail(new Error(`grader exited (${code}) ${stderr.slice(-500)}`)));
    });
    child.once('exit', () => {
      if (this.child === child) {
        this.child = null;
        this.ready = null;
      }
    });
    this.ready.catch(() => {});
  }

  start() {
    if (!this.child) this.spawn();
    return this.ready!;
  }

  run(code: string, tests: TestCase[]): Promise<TestResult[]> {
    return new Promise((resolve) => {
      this.queue.push({ code, tests, resolve });
      this.pump();
    });
  }

  private async pump() {
    if (this.busy) return;
    const job = this.queue.shift();
    if (!job) return;
    this.busy = true;
    try {
      job.resolve(await this.runOne(job));
    } finally {
      this.busy = false;
      this.pump();
    }
  }

  private async runOne(job: Job): Promise<TestResult[]> {
    const failAll = (msg: string) => job.tests.map((t) => ({ ...t, passed: false, actual: 'not run', error: msg }));
    try {
      await this.start();
    } catch (e) {
      return failAll(`grader unavailable: ${(e as Error).message}`);
    }
    const child = this.child!;
    const id = this.nextId++;
    return new Promise((resolve) => {
      const done = (r: TestResult[]) => {
        clearTimeout(timer);
        child.off('message', onMsg);
        child.off('exit', onExit);
        resolve(r);
      };
      const onMsg = (m: any) => {
        if (m?.id !== id) return;
        done(m.ok ? m.results : failAll(m.error));
      };
      const onExit = () => done(failAll('grader stopped'));
      const timer = setTimeout(() => {
        // Forget it before killing, so the next job doesn't go to a dying process.
        this.child = null;
        this.ready = null;
        child.kill();
        done(failAll('timed out'));
      }, TIMEOUT_MS);
      child.on('message', onMsg);
      child.once('exit', onExit);
      child.send({ id, code: job.code, tests: job.tests });
    });
  }

  stop() {
    this.child?.kill();
  }
}
