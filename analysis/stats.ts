// Small, dependency-free versions of the tests named in the analysis plan.

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function sd(xs: number[]) {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function quantile(xs: number[], q: number) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

export const median = (xs: number[]) => quantile(xs, 0.5);

// Average ranks, ties share the mean of their positions.
export function rank(xs: number[]) {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) ranks[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return ranks;
}

// Abramowitz and Stegun 7.1.26, accurate to about 1e-7.
function erf(x: number) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
export const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));

// Upper tail of chi-square. Exact for even df, which covers k = 3 conditions (df = 2).
export function chiSquareSf(x: number, df: number) {
  if (x <= 0) return 1;
  if (df % 2 === 0) {
    let term = 1;
    let sum = 1;
    for (let i = 1; i < df / 2; i++) {
      term *= x / 2 / i;
      sum += term;
    }
    return Math.exp(-x / 2) * sum;
  }
  // odd df: Wilson-Hilferty approximation is plenty for reporting
  const z = (Math.cbrt(x / df) - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 1 - normalCdf(z);
}

// rows = participants, columns = conditions. Rows with a missing value are dropped.
export function friedman(rows: number[][]) {
  const complete = rows.filter((r) => r.every((v) => Number.isFinite(v)));
  const n = complete.length;
  const k = complete[0]?.length ?? 0;
  if (n < 2 || k < 2) return { n, chi2: NaN, df: k - 1, p: NaN, kendallW: NaN };
  const R = new Array(k).fill(0);
  let tieSum = 0;
  for (const row of complete) {
    const r = rank(row);
    r.forEach((v, j) => (R[j] += v));
    const counts = new Map<number, number>();
    row.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
    for (const t of counts.values()) tieSum += t ** 3 - t;
  }
  const raw = (12 / (n * k * (k + 1))) * R.reduce((a, r) => a + r * r, 0) - 3 * n * (k + 1);
  const correction = 1 - tieSum / (n * (k ** 3 - k));
  // every row tied on every condition: no evidence of a difference
  const chi2 = correction > 0 ? raw / correction : 0;
  return { n, chi2, df: k - 1, p: chiSquareSf(chi2, k - 1), kendallW: chi2 / (n * (k - 1)) };
}

// Paired Wilcoxon signed-rank, zero differences dropped. Exact p for small
// samples without ties, normal approximation with continuity correction otherwise.
export function wilcoxon(a: number[], b: number[]) {
  const d = a.map((x, i) => x - b[i]).filter((x) => Number.isFinite(x) && x !== 0);
  const n = d.length;
  if (n === 0) return { n, w: 0, p: 1, exact: true };
  const r = rank(d.map(Math.abs));
  const wPlus = r.reduce((s, ri, i) => s + (d[i] > 0 ? ri : 0), 0);
  const hasTies = new Set(d.map(Math.abs)).size < n;

  if (!hasTies && n <= 30) {
    // count of subsets of 1..n with each rank sum
    const max = (n * (n + 1)) / 2;
    let dist = new Array(max + 1).fill(0);
    dist[0] = 1;
    for (let i = 1; i <= n; i++) {
      const next = [...dist];
      for (let s = i; s <= max; s++) next[s] += dist[s - i];
      dist = next;
    }
    const total = 2 ** n;
    const w = Math.min(wPlus, max - wPlus);
    let tail = 0;
    for (let s = 0; s <= w; s++) tail += dist[s];
    return { n, w: wPlus, p: Math.min(1, (2 * tail) / total), exact: true };
  }

  const counts = new Map<number, number>();
  r.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  let tie = 0;
  for (const t of counts.values()) tie += t ** 3 - t;
  const mu = (n * (n + 1)) / 4;
  const sigma = Math.sqrt((n * (n + 1) * (2 * n + 1)) / 24 - tie / 48);
  const z = sigma > 0 ? (Math.abs(wPlus - mu) - 0.5) / sigma : 0;
  return { n, w: wPlus, p: Math.min(1, 2 * (1 - normalCdf(Math.max(0, z)))), exact: false };
}

export function holm(ps: number[]) {
  const order = ps.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(ps.length);
  let running = 0;
  order.forEach(([p, i], rankIdx) => {
    running = Math.max(running, Math.min(1, p * (ps.length - rankIdx)));
    out[i] = running;
  });
  return out;
}
