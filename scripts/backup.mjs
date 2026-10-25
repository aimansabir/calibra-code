// Copies the study data to a timestamped folder and writes a manifest with line
// counts and checksums, so a backup can be checked later.
//   npm run backup                      DATA_DIR (or ./data) -> ./backups/
//   npm run backup -- /path/to/backups  somewhere else, e.g. a mounted drive
// Safe while the server runs: files are only ever appended to, so a copy is at
// worst missing the line being written at that moment, which the store skips.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dataDir = process.env.DATA_DIR || 'data';
const target = resolve(process.argv[2] || 'backups', `calibra-${new Date().toISOString().replace(/[:.]/g, '-')}`);

if (!existsSync(dataDir)) {
  console.error(`No data folder at ${dataDir}. Set DATA_DIR or run this from the project folder.`);
  process.exit(1);
}
const files = readdirSync(dataDir).filter((f) => f.endsWith('.jsonl'));
if (!files.length) {
  console.error(`${dataDir} has no .jsonl files, nothing to back up.`);
  process.exit(1);
}

mkdirSync(target, { recursive: true });
const manifest = { createdAt: new Date().toISOString(), source: resolve(dataDir), files: {} };
for (const f of files) {
  copyFileSync(join(dataDir, f), join(target, f));
  const copy = readFileSync(join(target, f));
  manifest.files[f] = {
    bytes: copy.length,
    lines: copy.toString('utf8').split('\n').filter((l) => l.trim()).length,
    sha256: createHash('sha256').update(copy).digest('hex'),
  };
}
writeFileSync(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`backed up ${files.length} files to ${target}`);
for (const [f, m] of Object.entries(manifest.files)) console.log(`  ${f}: ${m.lines} lines`);
