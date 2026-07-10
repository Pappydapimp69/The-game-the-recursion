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
import { createInput } from '../src/app/input.js';
import { labelFor, hintLine } from '../src/app/device-labels.js';
import { createTitleScreen } from '../src/app/title.js';
import { describeModel, strongestReadLine, recentCallback } from '../src/sim/playermodel.js';
import { gen, DEFAULT_SPEC, requiredTypes, GEN_VERSION } from '../src/sim/procgen.js';
import { validateMap } from '../src/sim/procgen-validate.js';
import { buildFacts, eligible, selectBeat } from '../src/sim/director.js';
import { firedMarkersUpTo, markersInWindow } from '../src/sim/cutscene.js';
import { createCutscenePlayer } from '../src/app/cutscene-player.js';
import { subStream } from '../src/sim/rng.js';
import { BEATS, CHOICE_POINTS, ENDINGS, MAX_DEPTH, ABILITIES } from '../src/sim/content.js';
import { createAudio } from '../src/app/audio.js';

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

// --- input: event-time press capture, sub-frame taps not lost ----------------
{
  const target = new EventTarget();
  const input = createInput(target);
  // No browser KeyboardEvent global under plain Node — a plain Event carrying
  // the same {key, repeat, preventDefault} shape the handler actually reads.
  const keydown = (key, repeat = false) => {
    const e = new Event('keydown');
    e.key = key; e.repeat = repeat;
    target.dispatchEvent(e);
  };
  // A tap shorter than one frame: two keydowns with no sample() in between must
  // both be queued (the-game-prologue#E2 — pure per-frame sampling would lose one).
  keydown('Enter');
  keydown('ArrowDown');
  const presses = input.takePresses();
  check('two sub-frame keydowns both queued', presses.includes('confirm') && presses.includes('down'));
  check('takePresses drains the queue', input.takePresses().length === 0);
  // OS auto-repeat (event.repeat=true) must NOT flood the queue.
  keydown('z', true);
  check('repeated keydown (OS auto-repeat) ignored', input.takePresses().length === 0);
}

// --- input: gamepad absent (no navigator.getGamepads in this Node runtime) ---
// still yields a safe, empty sample rather than throwing — a real browser
// exercises the actual polling path (browser parity check, run separately).
{
  const input2 = createInput(new EventTarget());
  const s = input2.sample(0);
  check('sample() never throws when no gamepad API is present', Array.isArray(s.move));
}

// --- device-labels: words, not glyphs; recomputed per device -----------------
{
  check('gamepad confirm label is a word (A), not a glyph', labelFor('gamepad', 'confirm') === 'A');
  check('keyboard confirm label differs from gamepad', labelFor('keyboard', 'confirm') !== labelFor('gamepad', 'confirm'));
  const line = hintLine('gamepad', [['confirm', 'select']]);
  check('hintLine composes device + verb', line.includes('A') && line.includes('select'));
}

// --- title screen: EVERY field reachable and changeable (the regression the ---
// --- old char-creation bug was: only row 0 selectable, A just started it). ---
{
  let began = null;
  const title = createTitleScreen({ onBegin: (opts) => { began = opts; }, promptForCode: () => 'SAGA4.bad.bad' });

  // Cursor must reach all 4 rows (archetype, difficulty, sagaCode, begin) via 'down'.
  const seen = new Set([title.view('gamepad').rows.find((r) => r.selected).id]);
  for (let i = 0; i < 5; i++) { title.handlePresses(['down']); seen.add(title.view('gamepad').rows.find((r) => r.selected).id); }
  check('down-nav visits all 4 rows (not stuck on row 0)', seen.size === 4);

  // Hardship (difficulty) must actually be changeable — the literal reported bug.
  title.handlePresses(['up', 'up', 'up']); // wrap back toward archetype/difficulty
  const before = title.view('gamepad').rows.find((r) => r.id === 'difficulty').value;
  // Navigate cursor onto the difficulty row explicitly, then cycle it.
  while (title.view('gamepad').rows.find((r) => r.selected).id !== 'difficulty') title.handlePresses(['down']);
  title.handlePresses(['right']);
  const after = title.view('gamepad').rows.find((r) => r.id === 'difficulty').value;
  check('hardship/difficulty is selectable AND changeable', before !== after);

  // An invalid saga code must not crash and must report an error, not silently import.
  while (title.view('gamepad').rows.find((r) => r.selected).id !== 'sagaCode') title.handlePresses(['down']);
  title.handlePresses(['confirm']);
  check('invalid saga code reports an error, not a crash', title.view('gamepad').rows.find((r) => r.id === 'sagaCode').value.startsWith('invalid'));

  // Confirming 'begin' is the ONLY thing that starts the game, and it carries
  // the chosen difficulty (not always the default) — the other half of the bug.
  check('game has not started yet', began === null);
  while (title.view('gamepad').rows.find((r) => r.selected).id !== 'begin') title.handlePresses(['down']);
  title.handlePresses(['confirm']);
  check('confirming Begin starts the game', began !== null);
  check('started game carries the CHOSEN difficulty, not just the default', began.difficulty === after);
}

// --- title screen: valid saga import seeds the model/choices -----------------
{
  const v4 = makeV4Code({ archetype: 'wanderer', difficulty: 'measured', skills: { melee: 1 },
    choices: { ravagerFate: 'spare', riftChoice: 'seal', wardenFate: 'free', answererFate: 'answer' },
    model: { mercy: 0.6 } });
  let began = null;
  const title = createTitleScreen({ onBegin: (opts) => { began = opts; }, promptForCode: () => v4 });
  while (title.view('keyboard').rows.find((r) => r.selected).id !== 'sagaCode') title.handlePresses(['down']);
  title.handlePresses(['confirm']);
  check('valid saga code imports without error', title.view('keyboard').rows.find((r) => r.id === 'sagaCode').value.includes('imported'));
  while (title.view('keyboard').rows.find((r) => r.selected).id !== 'begin') title.handlePresses(['down']);
  title.handlePresses(['confirm']);
  check('begin carries imported=true and the saga choices', began.imported === true && began.choices.ravagerFate === 'spare');
  check('begin carries the imported player-model lean', began.model.mercy === 0.6);
}

// --- player-model: confidence-gated, one describeModel, attributed callback --
{
  const w = makeWorld('model-test');
  // Two strong signals — below the confidence floor (3) — must still read '—'.
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'resolve', weight: 1 });
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'resolve', weight: 1 });
  let reads = describeModel(w.playerModel);
  check('a strong lean below the confidence floor still reads unknown', reads.resolve.word === '—');
  check("with nothing confident yet, the voice admits it hasn't decided", strongestReadLine(w.playerModel).includes("hasn't decided"));

  // A third signal clears the floor — now it should speak.
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'resolve', weight: 1 });
  reads = describeModel(w.playerModel);
  check('three consistent signals clears the confidence floor', reads.resolve.word === 'bold');
  check('strongestReadLine now names the confident axis', strongestReadLine(w.playerModel).includes('bold'));

  // A borderline mean (near zero) stays undecided even once confident.
  const w2 = makeWorld('model-borderline');
  reduce(w2, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 0.05 });
  reduce(w2, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: -0.05 });
  reduce(w2, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 0.02 });
  check('a near-zero mean reads undecided even with enough samples', describeModel(w2.playerModel).mercy.word === '—');

  // Attributed callback quotes the MOST RECENT signal, not just any signal.
  check('no callback before any signal', recentCallback(makeWorld('fresh').playerModel) === null);
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: -1 });
  check('recentCallback names the last-recorded axis/pole', recentCallback(w.playerModel).includes('ruthless'));
}

// --- procgen: pure fn, seed-reproducible, validated by construction ----------
{
  // Two calls with identical args must be byte-identical (canonical-equal).
  const m1 = gen(7, 1, DEFAULT_SPEC);
  const m2 = gen(7, 1, DEFAULT_SPEC);
  check('gen is a pure function (same args -> identical map)', stableStringify(m1) === stableStringify(m2));

  // Different seeds must not accidentally collapse to one constant map.
  const mOther = gen(8, 1, DEFAULT_SPEC);
  check('different seeds produce different maps', stableStringify(m1) !== stableStringify(mOther));

  // The seed-stable retry index is itself derived from the seed — so a fixed
  // seed always lands on the same attempt, never a wall-clock reroll.
  check('gen output is byte-identical over a fresh third call', stableStringify(gen(7, 1, DEFAULT_SPEC)) === stableStringify(m1));

  // The validator passes on generator output across the full seed suite. A
  // failing seed is a real generator bug, not a reason to weaken the validator.
  let suiteFails = [];
  for (let s = 0; s < 20; s++) {
    const map = gen(s, 1, DEFAULT_SPEC);
    const probs = validateMap(map, DEFAULT_SPEC);
    if (probs.length) suiteFails.push(`seed ${s}: ${probs.join('; ')}`);
  }
  check('validator passes across seed suite 0..19', suiteFails.length === 0);
  if (suiteFails.length) for (const f of suiteFails) console.error('    ' + f);

  // Every required node type reserved a placed slot (referential integrity).
  const need = requiredTypes(DEFAULT_SPEC);
  const roles = new Set(m1.slots.map((s) => s.role));
  check('every required slot type is placed', need.every((t) => roles.has(t)));

  // The validator must FLAG unreachability — prove it catches a broken map, not
  // just that it passes good ones. Wall off the exit's neighborhood by hand.
  {
    const bad = JSON.parse(JSON.stringify(m1));
    const { w, h } = bad.grid;
    const { x: ex, y: ey } = bad.exit;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = ex + dx, y = ey + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) bad.grid.tiles[y * w + x] = 0;
      }
    }
    const probs = validateMap(bad, DEFAULT_SPEC);
    check('validator FLAGS a hand-broken map (exit walled off)', probs.some((p) => p.includes('unreachable')));
  }

  // And a disconnected required slot (not just the exit) is caught too.
  {
    const bad = JSON.parse(JSON.stringify(m1));
    const { w, h } = bad.grid;
    const key = bad.slots.find((s) => s.role === 'key');
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = key.x + dx, y = key.y + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) bad.grid.tiles[y * w + x] = 0;
      }
    }
    const probs = validateMap(bad, DEFAULT_SPEC);
    check('validator FLAGS a disconnected required slot', probs.some((p) => p.includes("slot 'key'") && p.includes('unreachable')));
  }
}

// --- director: salience beat selection, staged not blended -------------------
{
  // buildFacts flattens the model into dotted keys criteria can match.
  const w = makeWorld('director-test');
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 1 });
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 1 });
  reduce(w, { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 1 });
  const facts = buildFacts(w);
  check('buildFacts exposes axis word/lean/n/confident', facts['mercy.word'] === 'merciful' && facts['mercy.n'] === 3);

  // An unrecognized/missing operator fails CLOSED, not open.
  check('an unknown criterion operator fails closed', eligible(facts, { criteria: [{ key: 'mercy.word', nope: 'x' }] }) === false);
  check('a beat with no criteria is always eligible (the fallback shape)', eligible(facts, {}) === true);

  // Most-specific-rule-wins: a generic 0-criteria beat loses to a matching
  // 1-criterion beat, which loses to a matching 2-criterion beat.
  const beats = [
    { id: 'generic', spineNode: 'intro', criteria: [] },
    { id: 'specific-1', spineNode: 'intro', criteria: [{ key: 'mercy.word', eq: 'merciful' }] },
    { id: 'specific-2', spineNode: 'intro', criteria: [{ key: 'mercy.word', eq: 'merciful' }, { key: 'mercy.n', gte: 2 }] },
    { id: 'wrong', spineNode: 'intro', criteria: [{ key: 'mercy.word', eq: 'ruthless' }] },
  ];
  check('most-specific eligible beat wins over a generic/less-specific one', selectBeat(facts, beats, { spineNode: 'intro' }) === 'specific-2');

  // Tension tie-break among equally-specific beats.
  const tensionBeats = [
    { id: 'calm', spineNode: 'x', criteria: [{ key: 'mercy.word', eq: 'merciful' }], tension: 0.1 },
    { id: 'peak', spineNode: 'x', criteria: [{ key: 'mercy.word', eq: 'merciful' }], tension: 0.9 },
  ];
  check('tension tie-break picks the beat closest to targetTension', selectBeat(facts, tensionBeats, { spineNode: 'x', targetTension: 0.85 }) === 'peak');

  // LRU: among equally-specific, equal-tension beats, an unseen one is preferred.
  const lruBeats = [
    { id: 'aaa', spineNode: 'y', criteria: [] },
    { id: 'bbb', spineNode: 'y', criteria: [] },
  ];
  check('with none seen, deterministic id tie-break picks the lexically-first', selectBeat(facts, lruBeats, { spineNode: 'y' }) === 'aaa');
  check('once the lexically-first has been seen, the unseen one is preferred', selectBeat(facts, lruBeats, { spineNode: 'y', lastPlayed: { aaa: 3 } }) === 'bbb');

  // No eligible beat -> null, never a crash or a silent wrong pick.
  check('selectBeat returns null when nothing is eligible', selectBeat(facts, [{ id: 'never', criteria: [{ key: 'mercy.word', eq: 'ruthless' }] }]) === null);

  // BEAT_PLAYED records into world.director.lastPlayed for the next selection.
  reduce(w, { type: 'BEAT_PLAYED', beatId: 'specific-2' });
  check('BEAT_PLAYED records the tick a beat was shown', w.director.lastPlayed['specific-2'] === w.tick);
}

// --- cutscene: watch-vs-skip hash equality + seek-sweep + one-flag mode -------
{
  // A synthetic scene: 3 markers that MUTATE authoritative state (model, facet),
  // deliberately authored OUT of atMs order to prove firing is ordered by atMs.
  const scene = {
    id: 'test',
    totalMs: 1000,
    cmdMarkers: [
      { atMs: 800, cmd: { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 1 } },
      { atMs: 100, cmd: { type: 'RECORD_TRAIT_SIGNAL', axis: 'resolve', weight: 1 } },
      { atMs: 500, cmd: { type: 'RESTORE_FACET', facet: 'light' } },
    ],
    cosmeticTracks: {},
  };

  // WATCH: advance a player frame-by-frame (7ms/frame — irregular vs the sweep
  // step, so nothing lines up on marker boundaries) through the real reducer.
  const wWatch = makeWorld('cutscene');
  const pWatch = createCutscenePlayer(scene, { dispatch: (c) => reduce(wWatch, c) });
  let guard = 0;
  while (!pWatch.isEnded() && guard++ < 10000) pWatch.advance(7);
  check('watched cutscene reaches its end', pWatch.isEnded());

  // SKIP: a fresh IDENTICAL world, skipped immediately (all remaining markers
  // fired in order, cosmetics dropped).
  const wSkip = makeWorld('cutscene');
  const pSkip = createCutscenePlayer(scene, { dispatch: (c) => reduce(wSkip, c) });
  pSkip.skip();

  check('watch and skip produce BYTE-IDENTICAL authoritative state',
    fingerprint(fingerprintOf(wWatch)) === fingerprint(fingerprintOf(wSkip)));
  check('all 3 markers fired on both the watched and skipped paths',
    pWatch.firedCount() === 3 && pSkip.firedCount() === 3);

  // SEEK-SWEEP (memory-mandated: verify a time-based renderer with a full sweep,
  // not sampled frames). Step ms 0..totalMs in fine contiguous windows and assert
  // every marker fires EXACTLY once total — none twice, none skipped.
  const fireCount = new Map(scene.cmdMarkers.map((m) => [m.atMs, 0]));
  let prev = -1;
  for (let cur = 0; cur <= scene.totalMs; cur += 10) {
    for (const m of markersInWindow(scene, prev, cur)) fireCount.set(m.atMs, fireCount.get(m.atMs) + 1);
    prev = cur;
  }
  check('seek-sweep: every marker fires exactly once (none twice, none skipped)',
    fireCount.size === 3 && [...fireCount.values()].every((n) => n === 1));

  // firedMarkersUpTo is atMs-ordered regardless of authoring order.
  check('firedMarkersUpTo returns markers in atMs order, not authoring order',
    firedMarkersUpTo(scene, 600).map((m) => m.atMs).join(',') === '100,500');
  check('no marker fires before its atMs', firedMarkersUpTo(scene, 0).length === 0);
}

// --- cutscene mode is ONE flag with ONE exit path (mirrors title.js modal) ----
{
  const w = makeWorld('mode-test');
  const before = JSON.stringify(w.cutscene);
  reduce(w, { type: 'MARK_CUTSCENE', active: true, id: 'intro' });
  check('entering cutscene mode sets the single activeId flag', w.cutscene.activeId === 'intro');
  reduce(w, { type: 'MARK_CUTSCENE', active: false });
  check('exiting cutscene mode clears activeId (one restore-all exit)', w.cutscene.activeId === null);
  check('enter->exit leaves cutscene state exactly as it began (no stray flags)',
    JSON.stringify(w.cutscene) === before);
}

// --- cutscene cosmetic RNG stays OUT of the authoritative stream --------------
{
  const w = makeWorld('rng-test');
  const rngBefore = w.rng.slice();
  // The cosmetic RNG is a sub-stream keyed (saveSeed, sceneId); rolling it (and
  // the player's particle seeding) must never perturb world.rng.
  const cosmetic = subStream(w.rng, 'cutscene:intro');
  createCutscenePlayer({ id: 'intro', totalMs: 100, cmdMarkers: [], cosmeticTracks: {} },
    { dispatch: (c) => reduce(w, c), rng: cosmetic });
  for (let i = 0; i < 50; i++) cosmetic.u32();
  check('cosmetic cutscene RNG never perturbs the authoritative world.rng',
    w.rng.join(',') === rngBefore.join(','));
  // And entering/exiting cinematic mode itself advances no authoritative roll.
  reduce(w, { type: 'MARK_CUTSCENE', active: true, id: 'intro' });
  reduce(w, { type: 'MARK_CUTSCENE', active: false });
  check('MARK_CUTSCENE does not advance the authoritative rng stream',
    w.rng.join(',') === rngBefore.join(','));
}

// --- P6: the full fixed spine, scripted end to end (mirrors main.js's own ----
// orchestration exactly: dispatch ADVANCE_SPINE/CHOOSE_OPTION/END in the same
// order the UI would, no shortcuts) --------------------------------------------
function runSpine(seed, choiceIdxs, endingIdx) {
  const w = makeWorld(seed, { totalChoicePoints: CHOICE_POINTS.length });
  reduce(w, { type: 'ADVANCE_SPINE' }); // intro(0) -> learning(1)
  for (let i = 0; i < CHOICE_POINTS.length; i++) {
    const cp = CHOICE_POINTS[i];
    const opt = cp.options[choiceIdxs[i] ?? 0]; // short arrays default to option 0
    reduce(w, { type: 'CHOOSE_OPTION', pointId: cp.id, axis: opt.axis, weight: opt.weight });
  }
  reduce(w, { type: 'ADVANCE_SPINE' }); // learning(1) -> reveal(2): gated on spine.totalChoicePoints
  reduce(w, { type: 'ADVANCE_SPINE' }); // reveal(2) -> hollow(3)
  reduce(w, { type: 'END', choice: ENDINGS[endingIdx].id });
  reduce(w, { type: 'ADVANCE_SPINE' }); // hollow(3) -> finale(4), gated on flags.ended
  reduce(w, { type: 'ADVANCE_SPINE' }); // finale(4) -> done(5)
  return w;
}

{
  const w = runSpine('spine-a', [0, 0, 0], 0);
  check('spine reaches the terminal stage (done = 5)', w.spine.stage === 5);
  check('all learning choices were recorded', w.spine.learningIdx === CHOICE_POINTS.length);
  check('the ending choice set arc.choice and flags.ended', w.flags.ended === true && w.arc.choice === ENDINGS[0].id);
  check('choosing all-bold/candid/merciful options actually moved those axes', w.playerModel.axes.resolve.sum > 0 && w.playerModel.axes.mercy.sum > 0);

  // A beat was recorded for every spine node that has one (intro/reveal/finale
  // are cutscenes in main.js; here we drive selectBeat directly to prove the
  // SAME facts+BEATS the game uses actually resolve to a real id, never null).
  for (const node of ['intro', 'reveal', 'finale']) {
    const facts = buildFacts(w);
    const beatId = selectBeat(facts, BEATS, { spineNode: node });
    check(`selectBeat resolves a real beat for '${node}' (never null)`, typeof beatId === 'string' && beatId.length > 0);
  }

  // Gating: attempting to leave 'learning' before all choices are made must be
  // a no-op — and, critically, the threshold lives in STATE (set once at
  // construction), not in the command payload, so a caller can't bypass the
  // gate by simply omitting a parameter (the bug this test caught: an earlier
  // version read cmd.requiredChoices, defaulting to 0 when omitted).
  const early = makeWorld('gate-test', { totalChoicePoints: CHOICE_POINTS.length });
  reduce(early, { type: 'ADVANCE_SPINE' }); // intro -> learning
  reduce(early, { type: 'ADVANCE_SPINE' }); // attempted early, zero choices made
  check('ADVANCE_SPINE refuses to leave learning before all choices are made', early.spine.stage === 1);
  reduce(early, { type: 'ADVANCE_SPINE' }); // a second bare attempt — no hidden bypass via an omitted param
  check('a bare ADVANCE_SPINE with no payload cannot bypass the gate', early.spine.stage === 1);
  check('a world with no totalChoicePoints specified (e.g. the demo) never gates learning shut', makeWorld('no-gate').spine.totalChoicePoints === 0);

  // Determinism: the exact same scripted spine, run twice from the same seed,
  // must reach byte-identical state (canonical-equal) AND export the identical
  // saga code -- this is new content, so it gets its own equality check rather
  // than relying on the demo's golden.
  const w2 = runSpine('spine-a', [0, 0, 0], 0);
  check('the full spine is deterministic across two runs from the same seed', stableStringify(fingerprintOf(w)) === stableStringify(fingerprintOf(w2)));
  const code1 = exportSaga(w), code2 = exportSaga(w2);
  check('exportSaga is byte-identical for two identical spine runs', code1 === code2);
  check('exported code has the SAGA5 shape', code1.startsWith('SAGA5.') && code1.split('.').length === 3);

  // Different choices/ending produce a different exported code (sanity: the
  // model/choice actually reach the export, it isn't a constant string).
  const w3 = runSpine('spine-a', [1, 1, 1, 1], 2);
  check('different choices export a different saga code', exportSaga(w3) !== code1);

  // Content depth: five axes exercised, three endings, and the reveal beat
  // actually reflects the DOMINANT trait (all-merciful choices -> a mercy
  // reveal), proving the retelling varies by who you became, not at random.
  // Twelve choice points across four depths (six on depth 1, two per depth
  // after) — up from the original six, closing a real gap where 'attachment'
  // was declared as a fifth axis but never fed by any choice at all.
  check('there are twelve learning choice points', CHOICE_POINTS.length === 12);
  check('there are three endings', ENDINGS.length === 3);
  // CHOICE_POINTS order: shadow,name,echo,deeper,drowned,door (depth1),
  // tether,mirror (depth2), warning,keep (depth3), last-mercy,threshold (depth4).
  // Pick indices so mercy nets +3 (echo+drowned+last-mercy, all option 0) while
  // every other axis stays well below the |sum|>=2 dominance threshold.
  const merc = runSpine('dom-mercy', [0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0], 0);
  const mercFacts = buildFacts(merc);
  check('a consistently merciful player has mercy as the dominant trait', mercFacts.dominant === 'mercy' && mercFacts.dominantWord === 'merciful');
  check('a merciful player draws the merciful reveal beat', selectBeat(mercFacts, BEATS, { spineNode: 'reveal' }) === 'reveal-merciful');
  // A player whose choices cancel out axis by axis (every axis's two-or-three
  // points chosen to net below the |sum|>=2 dominance threshold) reaches no
  // named dominant, and the reveal is honestly unsure, not a random pick.
  const wishy = runSpine('wishy', [0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 0], 0);
  const wishyFacts = buildFacts(wishy);
  check('a self-cancelling player has no named dominant', wishyFacts.dominant === '');
  check('and draws the honestly-unsure reveal', selectBeat(wishyFacts, BEATS, { spineNode: 'reveal' }) === 'reveal-unsure');

  // --- multi-descent depth progression + ability unlocks -------------------
  // A world with NO maxDepth/depthQuotas opt-in behaves EXACTLY like the
  // original single-floor game — the default is a single depth whose quota is
  // whatever totalChoicePoints already was, so every test above (which never
  // passes these options) is unaffected by this feature existing at all.
  {
    const plain = makeWorld('plain-depth', { totalChoicePoints: CHOICE_POINTS.length });
    check('a world with no maxDepth opt-in defaults to a single depth', plain.maxDepth === 1 && plain.depth === 1);
    check('its depthQuotas default to [totalChoicePoints]', plain.spine.depthQuotas.length === 1 && plain.spine.depthQuotas[0] === CHOICE_POINTS.length);
  }

  // A real multi-depth world: 2 depths, quotas [1, 3] (depth 1 needs 1 choice,
  // depth 2 needs 2 more on top of that).
  {
    const d = makeWorld('depth-test', { totalChoicePoints: 3, maxDepth: 2, depthQuotas: [1, 3] });
    reduce(d, { type: 'ADVANCE_SPINE' }); // intro -> learning
    reduce(d, { type: 'ADVANCE_DEPTH' }); // attempted with zero choices made
    check('ADVANCE_DEPTH refuses to advance before its own depth quota is met', d.depth === 1);

    reduce(d, { type: 'CHOOSE_OPTION', pointId: 'x', axis: 'resolve', weight: 1 });
    reduce(d, { type: 'ADVANCE_DEPTH' });
    check('ADVANCE_DEPTH advances once THIS depth\'s quota is met', d.depth === 2);

    reduce(d, { type: 'ADVANCE_DEPTH' });
    check('ADVANCE_DEPTH refuses past maxDepth', d.depth === 2);

    reduce(d, { type: 'ADVANCE_SPINE' }); // attempted with depth 2's own quota unmet
    check('ADVANCE_SPINE still refuses to leave learning before ALL choices are made', d.spine.stage === 1);

    reduce(d, { type: 'CHOOSE_OPTION', pointId: 'y', axis: 'mercy', weight: 1 });
    reduce(d, { type: 'CHOOSE_OPTION', pointId: 'z', axis: 'candor', weight: 1 });
    reduce(d, { type: 'ADVANCE_SPINE' });
    check('ADVANCE_SPINE leaves learning once every choice AND every depth is reached', d.spine.stage === 2);
  }

  // Same shape, but proving ADVANCE_SPINE's depth half of the gate independently:
  // all choices made, but depth never advanced (a caller that skipped
  // ADVANCE_DEPTH entirely) must still be refused.
  {
    const skipDepth = makeWorld('skip-depth-test', { totalChoicePoints: 2, maxDepth: 2, depthQuotas: [1, 2] });
    reduce(skipDepth, { type: 'ADVANCE_SPINE' }); // intro -> learning
    reduce(skipDepth, { type: 'CHOOSE_OPTION', pointId: 'a', axis: 'resolve', weight: 1 });
    reduce(skipDepth, { type: 'CHOOSE_OPTION', pointId: 'b', axis: 'mercy', weight: 1 });
    check('all choices made but depth never advanced', skipDepth.spine.learningIdx === 2 && skipDepth.depth === 1);
    reduce(skipDepth, { type: 'ADVANCE_SPINE' });
    check('ADVANCE_SPINE refuses to leave learning if depth < maxDepth, even with every choice made', skipDepth.spine.stage === 1);
  }

  // UNLOCK_ABILITY: existence-gated (prologue#E9) — only a KNOWN key can be
  // granted, and granting is idempotent (a repeat unlock is a harmless no-op
  // event, not a double-grant of something that's already a boolean).
  {
    const ab = makeWorld('ability-test');
    check('abilities start locked', ab.abilities.pulse === false && ab.abilities.dash === false && ab.abilities.ward === false);
    reduce(ab, { type: 'UNLOCK_ABILITY', id: 'pulse' });
    check('UNLOCK_ABILITY grants a known ability', ab.abilities.pulse === true);
    reduce(ab, { type: 'UNLOCK_ABILITY', id: 'not-a-real-ability' });
    check('UNLOCK_ABILITY ignores an unknown id (existence-gated, not invented)', Object.keys(ab.abilities).length === 3);
    check('the other two abilities are untouched', ab.abilities.dash === false && ab.abilities.ward === false);
  }

  // Every ability declared in content.js unlocks at a depth within MAX_DEPTH,
  // and MAX_DEPTH matches the depth actually reachable (referential integrity
  // between the two content tables, same spirit as validate.js's ladder).
  check('every ability unlocks at a real depth <= MAX_DEPTH', ABILITIES.every((a) => a.unlockDepth >= 1 && a.unlockDepth <= MAX_DEPTH));
  check('MAX_DEPTH matches the highest depth any choice point is placed on', Math.max(...CHOICE_POINTS.map((cp) => cp.depth || 1)) === MAX_DEPTH);

  // The lost-voices quest: DELIVER_ECHOES banks toward the total, clamps there,
  // and a save-all run selects the deepened finale variant.
  const q = makeWorld('quest', { totalChoicePoints: CHOICE_POINTS.length, echoTotal: 4 });
  reduce(q, { type: 'DELIVER_ECHOES', n: 2 });
  check('DELIVER_ECHOES banks delivered toward total', q.quest.delivered === 2 && q.quest.total === 4);
  reduce(q, { type: 'DELIVER_ECHOES', n: 10 });
  check('delivered clamps at total (no overcount)', q.quest.delivered === 4);
  reduce(q, { type: 'END', choice: 'listen' });
  const savedFacts = buildFacts(q);
  check('quest.savedAll fact is true once all voices are delivered', savedFacts['quest.savedAll'] === true);
  check('a save-all listen ending selects the deepened finale beat', selectBeat(savedFacts, BEATS, { spineNode: 'finale' }) === 'finale-listen-saved');
  const none = makeWorld('quest-none', { echoTotal: 4 });
  reduce(none, { type: 'END', choice: 'listen' });
  check('a save-none run selects the base listen finale', selectBeat(buildFacts(none), BEATS, { spineNode: 'finale' }) === 'finale-listen');
  check('saved echoes ride out in the saga export', exportSaga(q).length > 0 && JSON.parse(atob(exportSaga(q).split('.')[1])).savedEchoes === 4);

  // The learning-stage map is generated from world.seed via the SAME procgen
  // path main.js uses, and it's the pure/reproducible function P3 verified.
  const map = gen(w.seed, GEN_VERSION, DEFAULT_SPEC);
  check("world.seed flows into procgen exactly as main.js's beginLearning does", map.entry != null && map.exit != null);
}

// --- audio: graceful degradation (no AudioContext in Node) -------------------
// The engine must construct and expose a full no-throw API even where Web Audio
// doesn't exist, so the game runs fully with audio silently dead (dog#E1).
{
  let threw = false, a = null;
  try { a = createAudio(); } catch { threw = true; }
  check('createAudio() never throws, even with no AudioContext', !threw && a);
  if (a) {
    let anyThrew = false;
    try {
      a.resume(); a.startDrone(); a.setMood(0.2); a.setMood(0.9);
      a.setChord('hollow'); a.setChord('intro');
      a.confirm(); a.step(); a.chime();
      if (a.cancel) a.cancel();
      a.setEnabled(false); a.setEnabled(true);
      if (a.setVolume) a.setVolume(0.5);
      a.stopDrone();
    } catch { anyThrew = true; }
    check('every audio method is a safe no-op when audio is unavailable', !anyThrew);
  }
}

// --- content table validation (real content, when it exists) -----------------
// content.js holds the retelling's spine data (CHOICE_POINTS/ENDINGS/BEATS,
// exercised above); no generic quest catalog exists in this vertical slice.

console.log(`\n${passed} checks passed, ${failures.length} failed.`);
if (failures.length) process.exit(1);
