import { describe, expect, it } from 'vitest';
import { buildPlan, CONDITIONS, ORDERS, fallbackOrderIndex } from '../src/study/plan';
import { TASKS, getTask } from '../src/study/tasks';

const plans = ORDERS.map((_, k) => buildPlan(k, TASKS));

describe('counterbalancing', () => {
  it('uses all six distinct orders', () => {
    const keys = new Set(ORDERS.map((o) => o.join(',')));
    expect(keys.size).toBe(6);
    for (const o of ORDERS) expect([...o].sort()).toEqual([...CONDITIONS].sort());
  });

  it('puts each condition in each position twice over six participants', () => {
    for (const c of CONDITIONS) {
      for (let pos = 0; pos < 3; pos++) {
        expect(ORDERS.filter((o) => o[pos] === c)).toHaveLength(2);
      }
    }
  });

  it('balances which condition comes right after which', () => {
    const counts = new Map<string, number>();
    for (const o of ORDERS) {
      for (let i = 0; i < 2; i++) {
        const key = `${o[i]}>${o[i + 1]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    expect(counts.size).toBe(6);
    for (const v of counts.values()) expect(v).toBe(2);
  });

  it('gives every task pair to every condition equally often', () => {
    for (const c of CONDITIONS) {
      for (const pair of ['A', 'B', 'C']) {
        expect(plans.filter((p) => p.pairByCondition[c] === pair)).toHaveLength(2);
      }
    }
  });

  it('gives each condition one correct and one incorrect suggestion', () => {
    for (const p of plans) {
      for (const b of p.blocks) {
        const kinds = b.tasks.map((t) => getTask(t.taskId).advice!.correctness === 'correct').sort();
        expect(kinds).toEqual([false, true]);
      }
    }
  });

  it('balances whether the correct suggestion comes first', () => {
    for (const c of CONDITIONS) {
      const firsts = plans.map((p) => {
        const block = p.blocks.find((b) => b.condition === c)!;
        return getTask(block.tasks[0].taskId).advice!.correctness === 'correct';
      });
      expect(firsts.filter(Boolean)).toHaveLength(3);
    }
  });

  it('never repeats an experimental task within a participant', () => {
    for (const p of plans) {
      const ids = p.blocks.flatMap((b) => b.tasks.map((t) => t.taskId));
      expect(new Set(ids).size).toBe(6);
    }
  });

  it('is deterministic and wraps out-of-range indexes', () => {
    expect(buildPlan(7, TASKS)).toEqual(buildPlan(1, TASKS));
    expect(buildPlan(3, TASKS)).toEqual(buildPlan(3, TASKS));
    expect(fallbackOrderIndex('P-ABCDE')).toBe(fallbackOrderIndex('P-ABCDE'));
    expect(fallbackOrderIndex('P-ABCDE')).toBeLessThan(6);
  });
});
