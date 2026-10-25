# Running CALIBRA CODE for a study

This covers deploying the server for real sessions: configuration, Docker, where the data lives, health checks, backups and upgrades. For development, see the README.

## Configuration

Copy `.env.example` to `.env` and set at least `RESEARCH_KEY`:

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"   # paste the output as RESEARCH_KEY
```

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | – | `production` turns the warnings below into startup errors. |
| `PORT` | `3000` | |
| `RESEARCH_KEY` | – | Protects `/researcher` and all exports. Required in production, at least 16 characters. |
| `DATA_DIR` | `data` | Folder for the JSON lines files. Docker always uses `/data`. |
| `STATIC_DIR` | `dist` | The built participant app. Must contain `index.html` in production. |
| `TASK_DIR` | `tasks` | Optional other task folder. |

The server checks its configuration before it accepts anyone and stops with a list of problems if:

- `PORT` is not a valid port,
- `RESEARCH_KEY` is missing or shorter than 16 characters (production only; a warning otherwise),
- `DATA_DIR` can't be created or written to,
- `STATIC_DIR` has no build (production only),
- the Pyodide package is missing, so nothing could be graded,
- the task set can't build a study plan.

The research key goes in an `Authorization: Bearer <key>` header, never in a URL. The dashboard sends it for you, and the exports are downloaded through it. From a script:

```bash
curl -H "Authorization: Bearer $RESEARCH_KEY" http://localhost:3000/api/export/attempts.csv -o attempts.csv
curl -H "Authorization: Bearer $RESEARCH_KEY" http://localhost:3000/api/export/all.json -o calibra-export.json
```

## Docker

```bash
docker compose up -d --build     # build and start
docker compose ps                # STATUS shows (healthy) once /api/health passes
docker compose logs -f           # startup messages, including any configuration problems
docker compose down              # stop; the data volume is kept
```

The image builds the app (including the bundle leak check), runs as the unprivileged `node` user and serves on port 3000. Compose publishes it on `PORT` from `.env`.

## Where the data lives

Everything is append-only JSON lines in `DATA_DIR`, one file per collection:

| File | Contents | Exported |
|---|---|---|
| `participants.jsonl` | background, order, proficiency, versions, completion | yes |
| `sessions.jsonl` | current step after every change (used to resume) | yes |
| `attempts.jsonl` | one row per submitted task | yes |
| `surveys.jsonl` | post-task, post-part and final questionnaires | yes |
| `events.jsonl` | interaction log, each event tied to the step it happened on | yes |
| `technical_issues.jsonl` | researcher notes on disrupted tasks | yes |
| `credentials.jsonl` | SHA-256 hashes of the session tokens | **never** |

With Docker this folder is the `calibra-data` named volume. It survives `docker compose down`, rebuilds and image updates. Only `docker compose down -v` or `docker volume rm` deletes it. To keep the data in a folder on the host instead, replace the volume line in `docker-compose.yml` with a bind mount such as `- ./data:/data` (the folder must be writable by UID 1000).

Rows are never rewritten. A later row with the same `id` replaces an earlier one when the data is read, which is how retried requests and edited technical issues are handled.

## Health checks

`GET /api/health` answers `200` with:

```json
{ "ok": true, "storage": "ok", "grader": "ready", "uptimeSec": 812, "studyVersion": "0.2.0", "protocolVersion": "1.0" }
```

It answers `503` when the data folder is not writable or the grader process can't start (it tries to restart it each time it's asked). `grader` is `starting` for a few seconds after boot and `idle` after a run was stopped for taking too long; both are normal. Docker runs this check every 30 seconds and marks the container unhealthy after 3 failures.

## Backups

The files are only appended to, so a copy taken while the server runs is consistent up to the last complete line. Back up at least at the end of every study day, and keep copies somewhere other than the study machine. They contain all study data and the token hashes, so store them as you would the data itself.

Without Docker:

```bash
npm run backup                         # ./data -> ./backups/calibra-<timestamp>/
npm run backup -- /media/usb/calibra   # to another drive
```

Each backup has a `manifest.json` with line counts and SHA-256 checksums for every file.

With Docker:

```bash
docker compose exec calibra node scripts/backup.mjs /tmp/backup
docker compose cp calibra:/tmp/backup ./backups
docker compose exec calibra rm -rf /tmp/backup
```

or, for a plain archive of the whole volume:

```bash
docker run --rm -v calibra-code_calibra-data:/data:ro -v "$PWD/backups:/backup" alpine \
  tar czf /backup/calibra-data-$(date +%Y%m%d-%H%M).tgz -C /data .
```

(The volume name is `<project folder>_calibra-data`; `docker volume ls` shows it.)

**Restoring.** Stop the server, put the `.jsonl` files back into `DATA_DIR` (or the volume), and start it again. Sessions resume from `sessions.jsonl`, and participants keep working with the token their browser already has.

**Checking a backup.** `npm run analyze -- backups/calibra-<timestamp>` should run and report the same participant counts as the dashboard.

## Upgrades and versions

Every participant, session, attempt, survey and event row records `studyVersion` (from `package.json`) and `protocolVersion` (in `server/version.ts`). Bump the protocol version only when the procedure in `docs/experimental-plan.md` changes. The dashboard warns about participants who started on another version.

Upgrade between sessions, not during one. Browsers that started a session on 0.1.0 hold no session token and can't resume on 0.2.0 or later; their saved data is unaffected.

## Technical issues

When a task is disrupted (a crash, a lost connection, an interruption in the lab), open `/researcher`, press **Record issue** next to the participant, choose the task, describe what happened, and decide whether to exclude the attempt. Recording again for the same task replaces the earlier note, and **Remove** withdraws it. `npm run analyze` drops excluded attempts, lists every exclusion in `summary.md`, and writes them to `exclusions.csv`.
