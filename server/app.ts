import express, { type NextFunction, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Grader } from './grader';
import { Researcher } from './researcher';
import { COLLECTIONS, Store, toCsv, type ExportCollection } from './store';
import { Study, StudyError } from './study';
import { versions } from './version';

// Spread the nested objects into their own columns so the CSVs open cleanly in R, SPSS or Excel.
function flatten(rows: Record<string, unknown>[]) {
  return rows.map((r) => {
    const { responses, scores, signals, support, ...rest } = r as Record<string, any>;
    const prefix = (p: string, o: Record<string, unknown> | undefined) =>
      o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [`${p}${k}`, v])) : {};
    return {
      ...rest,
      ...prefix('signal_', signals),
      ...(support
        ? {
            support_level: support.level,
            support_activity: support.activity,
            support_score: support.score,
            support_patchWithheld: support.patchWithheld,
            support_reasons: (support.reasons ?? []).join('; '),
          }
        : {}),
      ...prefix('r_', responses),
      ...prefix('score_', scores),
    };
  });
}

// "Authorization: Bearer <secret>". Secrets never go in URLs, where they end up
// in browser history, server logs and proxies.
function bearer(req: Request) {
  const m = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '');
  return m?.[1].trim();
}

const sameSecret = (a: string, b: string) => {
  const h = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(h(a), h(b));
};

export function createApp(opts: { dataDir: string; researchKey?: string; staticDir?: string; grader?: Grader }) {
  const store = new Store(opts.dataDir);
  const grader = opts.grader ?? new Grader();
  grader.start().catch((e) => console.error('grader failed to start:', e.message));
  const study = new Study(store, grader);
  const researcher = new Researcher(store, study);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const fail = (res: Response, e: unknown, next: NextFunction) => {
    if (e instanceof StudyError) res.status(e.status).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
    else next(e);
  };

  const handle =
    (fn: (req: Request) => unknown) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await fn(req));
      } catch (e) {
        fail(res, e, next);
      }
    };

  // Participant routes: the session token is checked first, then the work runs
  // in that session's queue so two requests can't both act on the same step.
  const session =
    (fn: (req: Request, id: string) => unknown, opts: { serial?: boolean } = { serial: true }) =>
    async (req: Request, res: Response, next: NextFunction) => {
      const id = String(req.params.id);
      try {
        study.authorize(id, bearer(req));
        res.json(await (opts.serial ? study.exclusive(id, () => fn(req, id)) : fn(req, id)));
      } catch (e) {
        fail(res, e, next);
      }
    };

  // The dashboard and exports hold all study data, so lock them when a key is configured.
  const requireKey = (req: Request, res: Response, next: NextFunction) => {
    if (!opts.researchKey) return next();
    const given = bearer(req);
    if (given && sameSecret(given, opts.researchKey)) return next();
    res.status(401).json({ error: 'Research key required.' });
  };

  const startedAt = Date.now();
  app.get('/api/health', (_req, res) => {
    const storage = store.writable() ? 'ok' : 'not writable';
    if (grader.state === 'unavailable') grader.start().catch(() => {});
    const ok = storage === 'ok' && grader.state !== 'unavailable';
    res.status(ok ? 200 : 503).json({ ok, storage, grader: grader.state, uptimeSec: Math.round((Date.now() - startedAt) / 1000), ...versions() });
  });
  app.get('/api/proficiency', handle(() => study.proficiencyQuestions()));

  app.post('/api/sessions', handle((req) => study.register(req.body ?? {})));
  app.get('/api/sessions/:id', session((_req, id) => study.view(id)));
  app.post('/api/sessions/:id/proficiency', session((req, id) => study.submitProficiency(id, req.body?.answers)));
  app.post('/api/sessions/:id/instructions', session((_req, id) => study.finishInstructions(id)));
  app.post('/api/sessions/:id/tasks/:taskId/diagnosis', session((req, id) => study.diagnose(id, String(req.params.taskId), req.body ?? {})));
  app.post('/api/sessions/:id/tasks/:taskId/verify', session((req, id) => study.verify(id, String(req.params.taskId), String(req.body?.answer ?? ''))));
  app.post('/api/sessions/:id/tasks/:taskId/submit', session((req, id) => study.submit(id, String(req.params.taskId), req.body ?? {})));
  app.post('/api/sessions/:id/surveys/:kind', session((req, id) => {
    const kind = String(req.params.kind);
    if (kind !== 'post_task' && kind !== 'post_condition' && kind !== 'final') throw new StudyError(404, 'Unknown survey.');
    return study.submitSurvey(id, kind, req.body?.responses ?? {});
  }));
  // Events carry their own step, so they don't need to wait behind a submission.
  app.post('/api/sessions/:id/events', session((req, id) => ({ saved: study.logEvents(id, Array.isArray(req.body) ? req.body : []) }), { serial: false }));
  app.get('/api/sessions/:id/debrief', session((_req, id) => study.debrief(id)));

  const exportRows = (c: ExportCollection, demo: boolean) => {
    const rows = store.read(c);
    return demo ? rows : rows.filter((r) => !r.isDemo);
  };

  app.get('/api/export/all.json', requireKey, (req, res) => {
    const demo = req.query.demo === '1';
    res.attachment('calibra-export.json').json({ exportedAt: new Date().toISOString(), ...versions(), ...Object.fromEntries(COLLECTIONS.map((c) => [c, exportRows(c, demo)])) });
  });

  app.get('/api/export/:name', requireKey, (req, res) => {
    const m = /^(\w+)\.(csv|json)$/.exec(String(req.params.name));
    const c = m?.[1] as ExportCollection | undefined;
    if (!m || !c || !COLLECTIONS.includes(c)) return void res.status(404).json({ error: 'Unknown export.' });
    const rows = exportRows(c, req.query.demo === '1');
    if (m[2] === 'json') return void res.json(rows);
    res.type('text/csv').attachment(`${c}.csv`).send(toCsv(flatten(rows)));
  });

  // Progress, balance, warnings and technical issues. Analysis happens offline on the exports.
  app.get('/api/overview', requireKey, handle((req) => researcher.overview(req.query.demo === '1')));
  app.post('/api/technical-issues', requireKey, handle((req) => researcher.recordIssue(req.body ?? {})));
  app.delete('/api/technical-issues/:participantId/:taskId', requireKey, handle((req) => researcher.removeIssue(String(req.params.participantId), String(req.params.taskId))));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = resolve(opts.staticDir);
    app.use(express.static(dir));
    app.get('/{*path}', (_req, res) => res.sendFile(join(dir, 'index.html')));
  }

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on the server. Your progress up to the last step is saved.' });
  });

  return app;
}
