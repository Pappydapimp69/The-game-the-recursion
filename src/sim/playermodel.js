// The voice's read on you. ONE function turns the raw trait vector into text —
// this project (across the saga) has already drifted the same "data -> player-
// facing text" logic apart TWICE when a case was added in only one of two UI
// surfaces (the-game-prologue#E4). describeModel is the single place any
// dialog/cutscene/UI asks "what does the voice currently think of this player."
//
// Confidence gating: a lean only speaks once the sample count clears a floor —
// otherwise the voice would claim to "know" you off one data point, which reads
// as presumptuous rather than perceptive (the legibility research: confidence-
// gate any "I know you..." assertion).

import { AXES } from './world.js';

const CONFIDENT_N = 3; // fewer signals than this and the voice stays uncertain
const LEAN_THRESHOLD = 0.15; // |mean| below this reads as genuinely undecided

// Per-axis: sign, confidence, and the word (or '—' if unknown/undecided/unsure).
export function axisRead(axis, ax) {
  const def = AXES[axis];
  if (!def || !ax || ax.n === 0) return { lean: 0, n: 0, confident: false, word: '—' };
  const mean = ax.sum / ax.n;
  const confident = ax.n >= CONFIDENT_N;
  let word = '—';
  if (Math.abs(mean) >= LEAN_THRESHOLD) word = confident ? (mean > 0 ? def.pos : def.neg) : '—';
  return { lean: mean, n: ax.n, confident, word };
}

// The full read across every axis, keyed by axis name.
export function describeModel(playerModel) {
  const out = {};
  for (const axis of Object.keys(AXES)) out[axis] = axisRead(axis, playerModel.axes[axis]);
  return out;
}

// A short prose line for the ONE axis the voice is most confident about right
// now (or a stock "still learning you" line if nothing has cleared the floor
// yet) -- what a dialog/cutscene actually SAYS, not a debug dump.
export function strongestReadLine(playerModel) {
  const reads = describeModel(playerModel);
  let best = null;
  for (const [axis, r] of Object.entries(reads)) {
    if (r.word === '—') continue;
    if (!best || Math.abs(r.lean) * r.n > Math.abs(best.r.lean) * best.r.n) best = { axis, r };
  }
  if (!best) return "It hasn't decided what you are yet.";
  return `It knows you as ${best.r.word}, mostly.`;
}

// One attributed callback quoting the most recent trait-forming choice — the
// "diegetic callback" legibility pattern: name the SPECIFIC thing, don't just
// gesture at a vibe. Returns null if there's nothing recent to point to.
export function recentCallback(playerModel) {
  const signals = playerModel.recentSignals || [];
  if (signals.length === 0) return null;
  const last = signals[signals.length - 1];
  const def = AXES[last.axis];
  if (!def) return null;
  const pole = last.weight >= 0 ? def.pos : def.neg;
  return `You were ${pole}, back there. It noticed.`;
}
