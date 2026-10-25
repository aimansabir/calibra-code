// crypto.randomUUID only exists in secure contexts, and study laptops may open
// the app over plain http on the lab network, so build ids by hand.
export function newId(prefix = '') {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return prefix + hex;
}

export function suggestParticipantId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return 'P-' + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const nowIso = () => new Date().toISOString();
