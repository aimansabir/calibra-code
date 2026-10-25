import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan } from '../src/study/plan';
import { TASKS } from '../src/study/tasks';

export interface Config {
  port: number;
  dataDir: string;
  researchKey?: string;
  staticDir: string;
  production: boolean;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
  }
}

const MIN_KEY_LENGTH = 16;
const pyodideEntry = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'pyodide', 'pyodide.mjs');

// Checks everything the server needs before it accepts a participant, so a
// misconfigured lab machine fails at startup instead of halfway through a session.
export function loadConfig(env: Record<string, string | undefined> = process.env): { config: Config; warnings: string[] } {
  const problems: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === 'production';

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push(`PORT must be a number between 1 and 65535 (got "${env.PORT}").`);

  const researchKey = env.RESEARCH_KEY || undefined;
  if (!researchKey) {
    if (production) problems.push('RESEARCH_KEY is required in production. It protects the dashboard and the exports.');
    else warnings.push('RESEARCH_KEY is not set, so the researcher dashboard and exports are open to anyone who can reach this server.');
  } else if (researchKey.length < MIN_KEY_LENGTH) {
    const msg = `RESEARCH_KEY should be at least ${MIN_KEY_LENGTH} characters.`;
    if (production) problems.push(msg);
    else warnings.push(msg);
  }

  const dataDir = env.DATA_DIR || 'data';
  try {
    mkdirSync(dataDir, { recursive: true });
    accessSync(dataDir, constants.W_OK);
    const probe = join(dataDir, `.write-check-${process.pid}`);
    writeFileSync(probe, '');
    rmSync(probe);
  } catch (e) {
    problems.push(`DATA_DIR "${dataDir}" is not writable: ${(e as Error).message}`);
  }

  const staticDir = env.STATIC_DIR || 'dist';
  if (!existsSync(join(staticDir, 'index.html'))) {
    const msg = `STATIC_DIR "${staticDir}" has no index.html. Run npm run build first.`;
    if (production) problems.push(msg);
    else warnings.push(`${msg} Only the API is served.`);
  }

  if (!existsSync(pyodideEntry)) problems.push('The pyodide package is missing, so submissions cannot be graded. Run npm install.');

  try {
    buildPlan(0, TASKS);
  } catch (e) {
    problems.push(`The task set in tasks/ is incomplete: ${(e as Error).message}`);
  }

  if (problems.length) throw new ConfigError(problems);
  return { config: { port, dataDir, researchKey, staticDir, production }, warnings };
}
