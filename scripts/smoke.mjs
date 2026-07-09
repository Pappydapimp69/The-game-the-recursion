// Headless smoke test — the bottom rung of the validation ladder and the
// determinism/regression guard. Runs under Node (ESM). Exits non-zero on any
// failure so CI and `npm test` catch breakage loudly.
//
//   node scripts/smoke.mjs
//
// ESM has no implicit main check; this file is a script, not an importable
// module, so top-level execution is intended here.

import { makeWorld, fingerprintOf } from '../src/sim/world.js';
import { reduce } from '../src/sim/reduce.js';
import { runDemo, demoScript } from '../src/sim/demo.js';
import { fingerprint } from '../src/sim/fingerprint.js';
import { stableStringify } from '../src/sim/canonical.js';
import { makeRng, seedState } from '../src/sim/rng.js';
import { exportSaga, importSaga } from '../src/sim/saga.js';
import { validateContent, assertValid } from '../src/sim/validate.js';

// The golden end-state fingerprint. null until first run prints it; then baked.
const GOLDEN = '3434e401';

let passed = 0;
const failures = [];
function check(name, cond) {
  if (cond) { passed++; }
  else { failures.push(name); console.error('  FAIL: ' + name); }
}

// --- determinism: two runs from one seed must hash identically ---------------
const a = fingerprint(fingerprintOf(runDemo()));
const b = fingerprint(fingerprintOf(runDemo()));
check('demo is deterministic across two runs', a === b);
console.log('demo fingerprint:', a);
if (GOLDEN === null) {
  console.log('  (golden not yet baked — set GOLDEN =', JSON.stringify(a), ')');
} else {
  check('demo matches golden fingerprint', a === GOLDEN);
}

// --- rng: save/restore round-trips exactly, next roll identical --------------
{
  const r1 = makeRng('x'); for (let i = 0; i < 20; i++) r1.u32();
  const words = r1.save();
  const r2 = makeRng(words);
  check('rng restore -> next roll identical', r1.u32() === r2.u32());
  const s = seedState('recursion');
  check('seedState yields 4 nonzero-ish words', s.length === 4 && (s[0] | s[1] | s[2] | s[3]) !== 0);
}

// --- canonical: sorted keys stable, NaN/Infinity/undefined loud --------------
{
  const k1 = stableStringify({ b: 1, a: 2 });
  const k2 = stableStringify({ a: 2, b: 1 });
  check('stableStringify sorts keys (insertion-order independent)', k1 === k2);
  let threw = false; try { stableStringify({ x: NaN }); } catch { threw = true; }
  check('stableStringify throws on NaN', threw);
  threw = false; try { stableStringify({ x: Infinity }); } catch { threw = true; }
  check('stableStringify throws on Infinity', threw);
}

// --- trait fold: signed lean accumulates deterministically -------------------
{
  const w = makeWorld('trait');
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 1 });
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 1 });
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: -1 });
  const ax = w.playerModel.axes.mercy;
  check('trait fold accumulates sum/n', ax.sum === 1 && ax.n === 3);
  check('malformed trait weight ignored', (() => {
    const before = { ...w.playerModel.axes.resolve };
    reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'resolve', weight: NaN });
    return w.playerModel.axes.resolve.n === before.n;
  })());
}

// --- saga.v5 export/import round-trip; bad input never throws -----------------
{
  const w = makeWorld('saga', { choices: { ravagerFate: 'spare', wardenFate: 'free' } });
  for (const c of demoScript()) reduce(w, c); // reach an ended state
  const code = exportSaga(w);
  check('saga export has SAGA5 prefix + 3 parts', code.startsWith('SAGA5.') && code.split('.').length === 3);
  // A v5 code is NOT a valid v4 import (this game imports v4) — must reject gracefully.
  check('importing our own v5 code is rejected, not crashed', importSaga(code).ok === false);
  check('garbage import returns ok:false, never throws', importSaga('not a code').ok === false);
  check('non-string import returns ok:false', importSaga(null).ok === false);
  // Construct a minimal valid v4 code and confirm import accepts it.
  const v4 = makeV4Code({ archetype: 'wanderer', difficulty: 'measured', skills: { melee: 1 },
    choices: { ravagerFate: 'spare', riftChoice: 'seal', wardenFate: 'free', answererFate: 'answer' },
    model: { resolve: 0.5, mercy: -0.3 } });
  const imp = importSaga(v4);
  check('valid v4 code imports ok', imp.ok === true);
  if (imp.ok) {
    const w2 = makeWorld('imported', { imported: true, choices: imp.data.choices, model: imp.data.model });
    check('imported model seeds a lean', w2.playerModel.axes.resolve.n > 0 && w2.playerModel.axes.resolve.sum > 0);
    check('imported run starts with color facet', w2.facets.color === 1);
  }
}

// --- validation ladder: catches a typo'd objective type ----------------------
{
  const good = { quests: { intro: { objectives: [{ type: 'reach', to: 'hub' }] } } };
  check('valid content passes', validateContent(good).length === 0);
  const bad = { quests: { intro: { objectives: [{ type: 'reeach' }], requires: ['ghost'] } } };
  const probs = validateContent(bad);
  check('typo objective type flagged', probs.some((p) => p.includes('unknown type')));
  check('dangling prereq flagged', probs.some((p) => p.includes('unknown quest ghost')));
}

// Helper: build a saga.v4 code the way the Answering Deep would, so import can be
// tested here without that repo present. Mirrors saga.js's format exactly.
function makeV4Code(data) {
  const payload = btoa(stableStringify({ v: 'saga.v4', game: 'answering-deep', ...data }));
  return `SAGA4.${payload}.${fnv1a32Local(payload)}`;
}
function fnv1a32Local(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// --- content table validation (real content, when it exists) -----------------
// P3+ will import ../src/sim/content.js and assertValid here.

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
