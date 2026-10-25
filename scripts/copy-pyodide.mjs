// Copies the Pyodide runtime into public/ so the app works without a CDN.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = join('node_modules', 'pyodide');
const dest = join('public', 'pyodide');
const wanted = /\.(mjs|js|wasm|zip|json)$/;

if (!existsSync(src)) {
  console.error('pyodide package not found, run npm install first');
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  if (!wanted.test(file) || file === 'package.json') continue;
  cpSync(join(src, file), join(dest, file));
}
console.log('pyodide copied to public/pyodide');
