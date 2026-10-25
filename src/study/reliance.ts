import type { Correctness, Decision, Reliance } from './types';

// Accepting a correct suggestion or rejecting a wrong one is appropriate.
// "Edit" counts as appropriate only if the participant ended with working code.
export function classifyReliance(
  aiCorrectness: Correctness | null,
  decision: Decision | null,
  finalCorrect: boolean,
): Reliance {
  if (!aiCorrectness || !decision) return 'none';
  const aiRight = aiCorrectness === 'correct';

  if (decision === 'accept') return aiRight ? 'appropriate' : 'over';
  if (decision === 'reject') return aiRight ? 'under' : 'appropriate';
  if (aiRight) return finalCorrect ? 'appropriate' : 'mixed';
  return finalCorrect ? 'appropriate' : 'over';
}
