// One seeded RNG for the whole simulation. Its ENTIRE state lives in the saved
// world as four uint32 words, so a load restores in O(1) (no replaying `count`
// rolls) and the next roll after load is byte-identical. Never call Math.random()
// or Date.now() in the sim — route every roll through here, or determinism
// (save/replay, seed-reproducible procgen, the golden fingerprint) breaks.
//
// Algorithm: sfc32 (small-fast-counter, 32-bit) — fast, well-distributed, and its
// state is just four ints, which is exactly what we serialize.
// Precedent: ideas seeded-rng/save-replay-coop-from-one-stream; the-game-prologue#E1,
// the-game-the-answering-deep saga core.

// Hash an arbitrary seed (string or number) into four uint32 state words.
// xmur3-style string hash so different seed strings diverge well.
export function seedState(seed) {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  // Four distinct words; avoid the all-zero state (sfc32 fixed point).
  let a = next(), b = next(), c = next(), d = next();
  if ((a | b | c | d) === 0) d = 1;
  return [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
}

// An rng object carries its mutable state array `s` (the four words) and a
// step() that advances it. The state array is what you store in world.rng.
export function makeRng(seedOrState) {
  const s = Array.isArray(seedOrState) ? seedOrState.slice(0, 4).map((x) => x >>> 0) : seedState(seedOrState);
  const rng = {
    s,
    // Raw next uint32 — the primitive every other method builds on.
    u32() {
      let [a, b, c, d] = rng.s;
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      const t = (a + b) >>> 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) >>> 0;
      c = ((c << 21) | (c >>> 11)) >>> 0;
      d = (d + 1) >>> 0;
      const r = (t + d) >>> 0;
      c = (c + r) >>> 0;
      rng.s[0] = a; rng.s[1] = b; rng.s[2] = c; rng.s[3] = d;
      return r >>> 0;
    },
    // Float in [0,1).
    float() { return rng.u32() / 4294967296; },
    // Integer in [lo, hi] inclusive. Rejection-free modulo is fine here (sim
    // ranges are tiny); bias is negligible and — critically — deterministic.
    int(lo, hi) {
      if (hi < lo) { const t = lo; lo = hi; hi = t; }
      const span = (hi - lo + 1) >>> 0;
      return lo + (rng.u32() % span);
    },
    // Pick an element (returns undefined for an empty array — callers guard).
    pick(arr) { return arr.length ? arr[rng.int(0, arr.length - 1)] : undefined; },
    // In-place Fisher-Yates using this stream (deterministic shuffle).
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    // The serializable state — copy so callers can't alias our live array.
    save() { return rng.s.slice(); },
  };
  return rng;
}

// A derived sub-stream keyed by a tag, so per-stage generation (procgen for
// zone A) doesn't consume or perturb the main stream. hash(seed, tag) style.
// Used for reproducible-but-independent generation and for COSMETIC randomness
// that must stay OUT of the authoritative stream (e.g. cutscene particles).
export function subStream(stateWords, tag) {
  return makeRng([...stateWords, tag].join(':'));
}
