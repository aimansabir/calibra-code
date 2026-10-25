export interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

// Plain LCS line diff. Task files are short so the O(n*m) table is fine.
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i], oldNo: i + 1, newNo: j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'remove', text: a[i], oldNo: i + 1, newNo: null });
      i++;
    } else {
      out.push({ kind: 'add', text: b[j], oldNo: null, newNo: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ kind: 'remove', text: a[i], oldNo: i + 1, newNo: null }), i++;
  while (j < m) out.push({ kind: 'add', text: b[j], oldNo: null, newNo: j + 1 }), j++;
  return out;
}

// Only the changed lines plus a little context, for the compact patch view.
export function hunks(diff: DiffLine[], context = 1): DiffLine[][] {
  const keep = diff.map(() => false);
  diff.forEach((d, idx) => {
    if (d.kind === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(diff.length - 1, idx + context); k++) keep[k] = true;
  });
  const groups: DiffLine[][] = [];
  let current: DiffLine[] = [];
  diff.forEach((d, idx) => {
    if (keep[idx]) current.push(d);
    else if (current.length) {
      groups.push(current);
      current = [];
    }
  });
  if (current.length) groups.push(current);
  return groups;
}
