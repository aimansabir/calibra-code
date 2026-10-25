import { describe, expect, it } from 'vitest';
import { chiSquareSf, friedman, holm, median, rank, wilcoxon } from '../analysis/stats';

describe('analysis statistics', () => {
  it('ranks with ties', () => {
    expect(rank([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it('Friedman on a perfectly consistent ordering', () => {
    const r = friedman([
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
      [1, 2, 3],
    ]);
    expect(r.chi2).toBeCloseTo(8, 10);
    expect(r.p).toBeCloseTo(Math.exp(-4), 10);
    expect(r.kendallW).toBeCloseTo(1, 10);
  });

  it('Friedman ignores incomplete rows and handles all-tied data', () => {
    expect(friedman([[1, 2, NaN], [1, 1, 1], [2, 2, 2]]).p).toBe(1);
  });

  it('chi-square tail matches known values', () => {
    expect(chiSquareSf(5.991, 2)).toBeCloseTo(0.05, 3);
    expect(chiSquareSf(9.488, 4)).toBeCloseTo(0.05, 3);
  });

  it('exact Wilcoxon signed-rank', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const r = wilcoxon(a, a.map(() => 0));
    expect(r.w).toBe(36);
    expect(r.p).toBeCloseTo(2 / 256, 10);
    expect(wilcoxon([1, 2], [1, 2]).p).toBe(1);
  });

  it('Holm correction keeps order and caps at 1', () => {
    expect(holm([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06]);
    expect(holm([0.6, 0.9])).toEqual([1, 1]);
  });

  it('median', () => {
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});
