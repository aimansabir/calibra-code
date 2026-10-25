# CALIBRA CODE

A Python debugging workspace for studying how students decide when to trust, question or reject AI coding advice. It compares three interfaces in a within-subjects study: Direct AI, Always Verify, and CALIBRA CODE adaptive verification (low, medium or strong support depending on the risk of the suggestion).

The experimental plan is in [docs/experimental-plan.md](docs/experimental-plan.md). Deploying for a study (Docker, storage, health checks, backups) is in [docs/operations.md](docs/operations.md).

## Running it

Requires Node 22.13 or newer (the grader uses Node's permission model).

```bash
npm install
cp .env.example .env   # then set RESEARCH_KEY, or remove NODE_ENV=production for local testing
npm run build          # copies Pyodide, typechecks, builds, checks the bundle for leaks
npm start              # http://localhost:3000
```

Or with Docker: `docker compose up -d --build` (see [docs/operations.md](docs/operations.md)).

For development, `npm run dev` runs the API on port 3000 and Vite on 5173.

| URL | What it is |
|---|---|
| `/` | Participant flow, real study data |
| `/?demo=1` | Demo session: marked as demo, left out of exports, and shows the condition, support level and adaptive reasons |
| `/?order=1` to `/?order=6` | Pin a counterbalancing order (otherwise the least-used order is assigned) |
| `/researcher` | Participant progress, data warnings, technical issues, order and task-pair balance, versions, exports |

Environment variables: `PORT` (3000), `DATA_DIR` (`data`), `RESEARCH_KEY` (protects the dashboard and exports, sent as an `Authorization: Bearer` header; required in production), `STATIC_DIR` (`dist`). The server validates them at startup; `.env.example` lists them all.

## Tests

```bash
npm run typecheck
npm test           # unit + API tests: tasks, plan, adaptive rules, scoring, stats, server flow,
                   # tokens, delayed events, duplicate submits, restarts, surveys, exclusions, config
npm run test:e2e   # builds, then Playwright runs the participant flow, reload and offline recovery,
                   # Python retry, keyboard use and the researcher dashboard in Chromium
```

The first e2e run needs `npx playwright install chromium`. GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all of these on every push and pull request.

## Analysis

```bash
npm run analyze                # reads ./data, writes analysis/out/
npm run analyze -- e2e/.data --demo
```

It produces `summary.md` (exclusions, descriptives, Friedman tests, Holm-corrected Wilcoxon tests, H4 and H5 tables, preferences), `participant_condition.csv`, `tests.csv`, `comments.csv` for qualitative coding and `exclusions.csv`. Attempts a researcher marked as technically affected and excluded on the dashboard are dropped, and every exclusion is listed. Add `--out=folder` to write elsewhere.

## How it fits together

```
src/            React app (participant screens and /researcher)
  study/        shared study logic: types, counterbalancing, adaptive rules, scoring, survey items
  lib/          API client with an offline event queue, Pyodide runner, diff
server/         Express API, study session logic, JSONL storage, sandboxed grader
tasks/          one folder per task: task.json, starter.py, patch.py, solution.py
public/         Pyodide worker and the Python test harness
analysis/       analysis script and statistics
tests/, e2e/    Vitest and Playwright tests
docs/           experimental plan
```

**What the browser gets.** The server runs the study. The browser only receives what the current screen needs: the task text, starter code and visible tests, and the AI advice after the diagnosis is in. The patch arrives only once the support level allows it. Solutions, hidden tests, answer keys, AI correctness labels and researcher notes stay on the server, and `scripts/check-bundle.ts` fails the build if any of them appear in `dist/`.

**Sessions and events.** Registration returns an opaque session token that the browser sends as `Authorization: Bearer` with every session request; only its hash is stored, in a file that is never exported. Requests for one session run one at a time, so a double click or a retried submit can't save an attempt twice. Interaction events wait in the browser until the server has them, and each one carries the step it was created on, so an event that arrives after the participant has moved on still gets its task, block, position and condition from that step.

**Running code.** Participants' Run code and Run tests use Pyodide in a Web Worker. A timer outside the worker kills it after 5 seconds and starts a fresh one, so a loop that never ends can't freeze the page. Final grading (visible + hidden tests) happens on the server in a separate Node process started with `--permission`: it can only read the Pyodide files and the harness, can't spawn processes or workers, gets an empty `jsglobals`, and is killed and restarted after 8 seconds.

**Adding a task.** Add a folder to `tasks/` with the same files as the others. `npm test` checks that the solution passes every test, the patch behaves as its `patchVisible` and `correctness` say, and the prediction answers are right.
