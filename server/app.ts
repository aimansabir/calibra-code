import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ORDERS } from '../src/study/plan';
import { Grader } from './grader';
import { COLLECTIONS, Store, toCsv, type Collection } from './store';
import { Study, StudyError } from './study';

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

export function createApp(opts: { dataDir: string; researchKey?: string; staticDir?: string; grader?: Grader }) {
  const store = new Store(opts.dataDir);
  const grader = opts.grader ?? new Grader();
  grader.start().catch((e) => console.error('grader failed to start:', e.message));
  const study = new Study(store, grader);
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  const handle =
    (fn: (req: Request) => unknown) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await fn(req));
      } catch (e) {
        if (e instanceof StudyError) res.status(e.status).json({ error: e.message });
        else next(e);
      }
    };

  // Exports hold all study data, so lock them when a key is configured.
  const requireKey = (req: Request, res: Response, next: NextFunction) => {
    if (!opts.researchKey || req.query.key === opts.researchKey) return next();
    res.status(401).json({ error: 'Research key required.' });
  };

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/proficiency', handle(() => study.proficiencyQuestions()));

  app.post('/api/sessions', handle((req) => study.register(req.body ?? {})));
  app.get('/api/sessions/:id', handle((req) => study.view(String(req.params.id))));
  app.post('/api/sessions/:id/proficiency', handle((req) => study.submitProficiency(String(req.params.id), req.body?.answers)));
  app.post('/api/sessions/:id/instructions', handle((req) => study.finishInstructions(String(req.params.id))));
  app.post('/api/sessions/:id/tasks/:taskId/diagnosis', handle((req) => study.diagnose(String(req.params.id), String(req.params.taskId), req.body ?? {})));
  app.post('/api/sessions/:id/tasks/:taskId/verify', handle((req) => study.verify(String(req.params.id), String(req.params.taskId), String(req.body?.answer ?? ''))));
  app.post('/api/sessions/:id/tasks/:taskId/submit', handle((req) => study.submit(String(req.params.id), String(req.params.taskId), req.body ?? {})));
  app.post('/api/sessions/:id/surveys/:kind', handle((req) => {
    const kind = String(req.params.kind);
    if (kind !== 'post_task' && kind !== 'post_condition' && kind !== 'final') throw new StudyError(404, 'Unknown survey.');
    return study.submitSurvey(String(req.params.id), kind, req.body?.responses ?? {});
  }));
  app.post('/api/sessions/:id/events', handle((req) => ({ saved: study.logEvents(String(req.params.id), Array.isArray(req.body) ? req.body : []) })));
  app.get('/api/sessions/:id/debrief', handle((req) => study.debrief(String(req.params.id))));

  app.get('/api/export/:name', requireKey, (req, res) => {
    const m = /^(\w+)\.(csv|json)$/.exec(String(req.params.name));
    const c = m?.[1] as Collection | undefined;
    if (!m || !c || !COLLECTIONS.includes(c)) return void res.status(404).json({ error: 'Unknown export.' });
    let rows = store.read(c);
    if (req.query.demo !== '1') rows = rows.filter((r) => !r.isDemo);
    if (m[2] === 'json') return void res.json(rows);
    res.type('text/csv').attachment(`${c}.csv`).send(toCsv(flatten(rows)));
  });

  // Progress and order balance only. Analysis happens offline on the exports.
  app.get('/api/overview', requireKey, (req, res) => {
    const demo = req.query.demo === '1';
    const participants = store.read('participants').filter((r) => demo || !r.isDemo);
    res.json({
      participants: participants.length,
      completed: participants.filter((p) => p.completedAt).length,
      attempts: store.read('attempts').filter((r) => demo || !r.isDemo).length,
      orders: ORDERS.map((order, i) => ({
        order,
        started: participants.filter((p) => p.orderIndex === i).length,
        completed: participants.filter((p) => p.orderIndex === i && p.completedAt).length,
      })),
    });
  });

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
