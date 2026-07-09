// fnv1a-32 string hash + the state fingerprint used for the determinism/regression
// guard. Run a fixed scripted playthrough twice from one seed, hash a compact
// fingerprint of the end state, assert equality — any leaked ambient randomness
// makes them diverge. Bake the value as a golden and the same test also catches
// unintended logic/content changes loudly.
// Precedent: ideas replay-fingerprint/determinism-regression-guard.

// fnv1a-32 over a string -> 8-char lowercase hex. Same function the saga
// checksum uses, so it must stay stable forever.
export function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

import { stableStringify } from './canonical.js';

// Hash a canonical view of whatever compact object the caller decides captures
// the run's outcome. Keep the input SMALL and STABLE — hashing the entire world
// couples the golden to every incidental field; hash a deliberate fingerprint
// object (positions, hp, quest flags, player-model, rng words) instead.
export function fingerprint(fpObject) {
  return fnv1a32(stableStringify(fpObject));
}
