import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Append-only JSON lines, one file per collection. Nothing is ever rewritten,
// so a crash mid-session can lose at most the line being written.
export const COLLECTIONS = ['participants', 'sessions', 'attempts', 'surveys', 'events'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export class Store {
  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(c: Collection) {
    return join(this.dir, `${c}.jsonl`);
  }

  append(c: Collection, rows: object[]) {
    if (!rows.length) return;
    const stamped = rows.map((r) => JSON.stringify({ ...r, _savedAt: new Date().toISOString() }));
    appendFileSync(this.file(c), stamped.join('\n') + '\n');
  }

  readRaw(c: Collection): Record<string, unknown>[] {
    const f = this.file(c);
    if (!existsSync(f)) return [];
    return readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  }

  // Rows can be resent by the client's retry queue, and participants are saved
  // again as they progress, so keep the latest copy of each id.
  read(c: Collection): Record<string, unknown>[] {
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of this.readRaw(c)) {
      const id = String(row.id);
      byId.set(id, c === 'participants' ? { ...byId.get(id), ...row } : row);
    }
    return [...byId.values()];
  }
}

export function toCsv(rows: Record<string, unknown>[]) {
  const columns: string[] = [];
  for (const row of rows) for (const k of Object.keys(row)) if (!columns.includes(k)) columns.push(k);
  const cell = (v: unknown) => {
    if (v == null) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}
