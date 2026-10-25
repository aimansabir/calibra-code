import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TaskDef } from './types';

// Every folder in /tasks is one task: task.json plus starter.py, patch.py and solution.py.
// Adding a folder is enough to add a task.
// This reads from disk on purpose: only the server and the tests load tasks, so
// solutions, hidden tests and answer keys never end up in the browser bundle.
const TASK_DIR = process.env.TASK_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tasks');

function loadTasks(): TaskDef[] {
  const tasks: TaskDef[] = [];
  for (const folder of readdirSync(TASK_DIR, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const dir = join(TASK_DIR, folder.name);
    const read = (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
    const meta = read('task.json');
    const starter = read('starter.py');
    if (!meta || !starter) {
      console.warn(`task folder ${folder.name} is missing task.json or starter.py`);
      continue;
    }
    const patch = read('patch.py');
    tasks.push({
      ...JSON.parse(meta),
      starterCode: normalise(starter),
      solutionCode: normalise(read('solution.py') ?? ''),
      patchCode: patch ? normalise(patch) : null,
    });
  }
  return tasks.sort((a, b) => a.id.localeCompare(b.id));
}

function normalise(code: string) {
  return code.replace(/\r\n/g, '\n');
}

export const TASKS: TaskDef[] = loadTasks();

export function getTask(id: string): TaskDef {
  const task = TASKS.find((t) => t.id === id);
  if (!task) throw new Error(`Unknown task ${id}`);
  return task;
}

export function visibleTests(task: TaskDef) {
  return task.tests.filter((t) => !t.hidden);
}
