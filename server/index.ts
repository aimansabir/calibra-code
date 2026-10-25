import { createApp } from './app';
import { ConfigError, loadConfig } from './config';
import { Grader } from './grader';
import { STUDY_VERSION, PROTOCOL_VERSION } from './version';

let loaded;
try {
  loaded = loadConfig();
} catch (e) {
  console.error(e instanceof ConfigError ? e.message : e);
  process.exit(1);
}
const { config, warnings } = loaded;
for (const w of warnings) console.warn(`warning: ${w}`);

const grader = new Grader();
const app = createApp({
  dataDir: config.dataDir,
  researchKey: config.researchKey,
  // After `npm run build` the same process serves the study app.
  staticDir: config.staticDir,
  grader,
});

const server = app.listen(config.port, () =>
  console.log(`CALIBRA CODE ${STUDY_VERSION} (protocol ${PROTOCOL_VERSION}) on http://localhost:${config.port}, data in ${config.dataDir}`),
);

// Docker sends SIGTERM on stop. Every write is a synchronous append, so
// finishing the open requests and stopping the grader is all that's needed.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    grader.stop();
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
