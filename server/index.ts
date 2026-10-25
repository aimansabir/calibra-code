import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const app = createApp({
  dataDir: process.env.DATA_DIR ?? 'data',
  researchKey: process.env.RESEARCH_KEY || undefined,
  // After `npm run build` the same process serves the study app.
  staticDir: process.env.STATIC_DIR ?? 'dist',
});

app.listen(port, () => console.log(`CALIBRA CODE api on http://localhost:${port}`));
