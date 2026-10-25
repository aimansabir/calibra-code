import type { Condition, PlannedTask, StudyPlan, TaskDef } from './types';

export const CONDITIONS: Condition[] = ['direct', 'always', 'adaptive'];

// Researcher-facing names. Participants only ever see "Part 1", "Part 2"...
export const CONDITION_LABELS: Record<Condition, string> = {
  direct: 'Direct AI',
  always: 'Always Verify',
  adaptive: 'CALIBRA CODE (adaptive)',
};

// All six orders. The first three rows and the last three rows are each a
// Latin square, and together they balance which condition follows which.
export const ORDERS: Condition[][] = [
  ['direct', 'always', 'adaptive'],
  ['always', 'adaptive', 'direct'],
  ['adaptive', 'direct', 'always'],
  ['direct', 'adaptive', 'always'],
  ['adaptive', 'always', 'direct'],
  ['always', 'direct', 'adaptive'],
];

export const PAIRS = ['A', 'B', 'C'];

export function buildPlan(orderIndex: number, tasks: TaskDef[]): StudyPlan {
  const k = ((orderIndex % ORDERS.length) + ORDERS.length) % ORDERS.length;
  const conditionOrder = ORDERS[k];

  // Rotate which task pair goes with which condition so every pair meets every
  // condition equally often over each group of six participants.
  const shift = k % PAIRS.length;
  const pairByCondition = {} as Record<Condition, string>;
  CONDITIONS.forEach((c, ci) => {
    pairByCondition[c] = PAIRS[(ci + shift) % PAIRS.length];
  });

  const practiceTask = tasks.find((t) => t.role === 'practice');
  const transferTask = tasks.find((t) => t.role === 'transfer');
  if (!practiceTask || !transferTask) throw new Error('Task set needs a practice and a transfer task');

  const blocks = conditionOrder.map((condition, block) => {
    const pair = pairByCondition[condition];
    const pairTasks = tasks.filter((t) => t.role === 'experimental' && t.pair === pair);
    const correct = pairTasks.find((t) => t.advice?.correctness === 'correct');
    const wrong = pairTasks.find((t) => t.advice && t.advice.correctness !== 'correct');
    if (!correct || !wrong) throw new Error(`Pair ${pair} needs one correct and one incorrect suggestion`);

    // Alternate whether the correct suggestion comes first.
    const correctFirst = (k + CONDITIONS.indexOf(condition)) % 2 === 0;
    const ordered = correctFirst ? [correct, wrong] : [wrong, correct];
    return {
      condition,
      tasks: ordered.map<PlannedTask>((t, i) => ({
        taskId: t.id,
        condition,
        block,
        indexInBlock: i,
        role: 'experimental',
      })),
    };
  });

  return {
    orderIndex: k,
    conditionOrder,
    pairByCondition,
    practice: { taskId: practiceTask.id, condition: null, block: null, indexInBlock: 0, role: 'practice' },
    blocks,
    transfer: { taskId: transferTask.id, condition: null, block: null, indexInBlock: 0, role: 'transfer' },
  };
}

// Used when the server can't be reached: stable for the same participant id.
export function fallbackOrderIndex(participantId: string) {
  let h = 0;
  for (const ch of participantId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % ORDERS.length;
}
