// The front door, now running the whole fixed spine (PROPOSAL §4): title ->
// intro -> learning (choices feed the player-model) -> reveal -> hollow (the
// ending choice) -> finale -> the saga.v5 code. One unified input layer polled
// once per frame; `mode` is the ONE source of truth for which screen is live.
// Exposes window.__game so headless e2e can drive the same reducer/UI the
// player does.

import { makeWorld, fingerprintOf, AXES } from './sim/world.js';
import { reduce, leanLabel } from './sim/reduce.js';
import { fingerprint } from './sim/fingerprint.js';
import { demoScript } from './sim/demo.js';
import { seedState, subStream } from './sim/rng.js';
import { createInput } from './app/input.js';
import { createTitleScreen } from './app/title.js';
import { createChoiceScreen } from './app/choice-screen.js';
import { createCutscenePlayer } from './app/cutscene-player.js';
import { exportSaga } from './sim/saga.js';
import { gen, DEFAULT_SPEC, GEN_VERSION } from './sim/procgen.js';
import { buildFacts, selectBeat } from './sim/director.js';
import { BEATS, CHOICE_POINTS, ENDINGS } from './sim/content.js';

// Bump per deploy so a stale cache is observable, not guessed (the-game-prologue#E8).
const BUILD_ID = 'p6';

// Per-spine-node cutscene timing + a small ambient facet restore per node — the
// world gaining definition as the retelling proceeds (world-facets-as-reward).
// Beat TEXT is chosen live by the director (§5.3); this table only holds the
// cosmetic/mechanical shape shared by every variant of a given node.
const STAGE_TIMING = {
  intro: { totalMs: 2400, letterbox: { inMs: 400, outMs: 400, height: 0.16 },
    extraMarkers: [{ atMs: 900, cmd: { type: 'RESTORE_FACET', facet: 'light' } }] },
  reveal: { totalMs: 2200, letterbox: { inMs: 300, outMs: 300, height: 0.18 },
    extraMarkers: [{ atMs: 900, cmd: { type: 'RESTORE_FACET', facet: 'depth' } }] },
  finale: { totalMs: 2600, letterbox: { inMs: 400, outMs: 500, height: 0.2 },
    extraMarkers: [{ atMs: 1200, cmd: { type: 'RESTORE_FACET', facet: 'color' } }] },
};

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const input = createInput(window);

// mode is the ONE source of truth for which screen is live — every dismissal
// path sets it explicitly so nothing leaks between modes (test#E6).
let mode = 'title'; // 'title' | 'cutscene' | 'choice' | 'ended'
let world = null;
let cutscene = null;      // the active presentation-layer cutscene player, or null
let cutsceneOnEnd = null; // what to do next when the current cutscene ends
let choiceScreen = null;  // the active choice-screen instance, or null
let learningMap = null;   // the procgen map generated for 'the learning' backdrop
let sagaCode = '';        // set once the spine reaches 'done'
let lastFrameMs = 0;      // for the cutscene's own capped-delta clock

let title = createTitleScreen({
  onBegin: (opts) => { world = newWorld(opts); beginIntro(); },
  promptForCode: () => window.prompt('Paste a saga code (or Cancel for a fresh start):'),
});

function dispatch(cmd) { return world ? reduce(world, cmd) : []; }

// The one place a new world is constructed for real play — always with the
// content-derived spine threshold, so ADVANCE_SPINE's gate is never missing it.
function newWorld(opts) { return makeWorld('recursion', { ...opts, totalChoicePoints: CHOICE_POINTS.length }); }

// Build a cutscene for a spine node from the LIVE player-model: the director
// picks the variant, BEAT_PLAYED records it, and the beat's lines become the
// scene's caption track, evenly spaced. Same dispatch path as gameplay, so a
// cutscene here is exactly as replayable as everything else in the sim.
function makeBeatScene(spineNode) {
  const facts = buildFacts(world);
  const beatId = selectBeat(facts, BEATS, { spineNode, lastPlayed: world.director.lastPlayed });
  const beat = BEATS.find((b) => b.id === beatId) || { lines: ['...'] };
  dispatch({ type: 'BEAT_PLAYED', beatId });

  const timing = STAGE_TIMING[spineNode];
  const lines = beat.lines;
  const span = timing.totalMs - 300;
  const captions = lines.map((text, i) => ({ atMs: 150 + Math.round((span * i) / Math.max(1, lines.length)), text }));

  return {
    id: `${spineNode}:${beatId}`,
    totalMs: timing.totalMs,
    cmdMarkers: timing.extraMarkers || [],
    cosmeticTracks: { letterbox: timing.letterbox, captions },
  };
}

function startCutscene(scene, onEnd) {
  const rng = subStream(seedState(world.rng.join(':')), 'cutscene:' + scene.id);
  cutscene = createCutscenePlayer(scene, { dispatch, rng });
  lastFrameMs = 0;
  cutsceneOnEnd = onEnd;
  mode = 'cutscene';
}

// The single exit: whichever way the scene ended (finished or skipped), run
// whatever the caller wanted next — never re-enter 'play', that mode is gone.
function endCutscene() {
  cutscene = null;
  const next = cutsceneOnEnd; cutsceneOnEnd = null;
  if (next) next();
}

// --- the fixed spine, in order (PROPOSAL §4) --------------------------------
function beginIntro() {
  startCutscene(makeBeatScene('intro'), () => {
    dispatch({ type: 'ADVANCE_SPINE' }); // intro(0) -> learning(1): always allowed
    beginLearning();
  });
}

function beginLearning() {
  // Generate (never store) this run's map from its seed — proof procgen is
  // actually wired into the game the player sees, not just unit-tested.
  learningMap = gen(world.seed, GEN_VERSION, DEFAULT_SPEC);
  mode = 'choice';
  nextChoicePoint();
}

function nextChoicePoint() {
  const idx = world.spine.learningIdx;
  if (idx >= CHOICE_POINTS.length) {
    dispatch({ type: 'ADVANCE_SPINE' }); // learning(1) -> reveal(2): gated on world.spine.totalChoicePoints
    beginReveal();
    return;
  }
  const cp = CHOICE_POINTS[idx];
  choiceScreen = createChoiceScreen({
    prompt: cp.prompt,
    options: cp.options,
    onChoose: (_i, opt) => {
      dispatch({ type: 'CHOOSE_OPTION', pointId: cp.id, axis: opt.axis, weight: opt.weight });
      choiceScreen = null;
      nextChoicePoint();
    },
  });
}

function beginReveal() {
  startCutscene(makeBeatScene('reveal'), () => {
    dispatch({ type: 'ADVANCE_SPINE' }); // reveal(2) -> hollow(3): always allowed
    beginHollow();
  });
}

function beginHollow() {
  mode = 'choice';
  choiceScreen = createChoiceScreen({
    prompt: 'The hollow waits. What do you do with what it became?',
    options: ENDINGS,
    onChoose: (_i, ending) => {
      dispatch({ type: 'END', choice: ending.id });
      choiceScreen = null;
      dispatch({ type: 'ADVANCE_SPINE' }); // hollow(3) -> finale(4): gated on flags.ended
      beginFinale();
    },
  });
}

function beginFinale() {
  startCutscene(makeBeatScene('finale'), () => {
    dispatch({ type: 'ADVANCE_SPINE' }); // finale(4) -> done(5): always allowed
    beginEnded();
  });
}

function beginEnded() {
  learningMap = null;
  sagaCode = exportSaga(world);
  mode = 'ended';
}

// --- input / frame loop ------------------------------------------------------
function tickFrame(nowMs) {
  const { device } = input.sample(nowMs);
  const presses = input.takePresses();
  if (mode === 'title') {
    title.handlePresses(presses);
  } else if (mode === 'cutscene') {
    // Cinematic mode routes input to ONE control only — skip — and advances the
    // player on its own capped-delta clock. Either end path lands in endCutscene.
    if (presses.includes('skip')) cutscene.skip();
    else { const dt = lastFrameMs ? nowMs - lastFrameMs : 0; cutscene.advance(dt); }
    lastFrameMs = nowMs;
    if (cutscene.isEnded()) endCutscene();
  } else if (mode === 'choice') {
    if (choiceScreen) choiceScreen.handlePresses(presses);
  }
  return device;
}

// --- rendering ----------------------------------------------------------------
function renderTitle(device) {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = '#cdd3e0';
  ctx.fillText('THE RECURSION', 16, 24);
  const v = title.view(device);
  let ty = 60;
  for (const row of v.rows) {
    ctx.fillStyle = row.selected ? '#e6c15a' : '#5a6a8a';
    const marker = row.selected ? '> ' : '  ';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${marker}${row.label}${row.value ? ': ' + row.value : ''}`, 16, ty);
    ty += 16;
  }
  ctx.fillStyle = '#45506a';
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillText(v.hint, 16, H - 12);
}

function renderModelBackdrop() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#5a6a8a'; ctx.font = '8px ui-monospace, monospace';
  let ty = H - 54;
  ctx.fillText(`${world.settings.archetype} / ${world.settings.difficulty}`, 4, ty);
  for (const axis of Object.keys(AXES)) { ty += 9; ctx.fillText(`${axis}: ${leanLabel(axis, world.playerModel.axes[axis])}`, 4, ty); }
}

function renderMapBackdrop() {
  if (!learningMap) return;
  const { w, h, tiles } = learningMap.grid;
  const s = 3;
  ctx.fillStyle = '#141a2b';
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tiles[y * w + x]) ctx.fillRect(x * s, y * s, s, s);
}

function renderChoice(device) {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  renderMapBackdrop();
  ctx.fillStyle = 'rgba(5,6,10,0.72)'; ctx.fillRect(0, 0, W, H);
  const v = choiceScreen.view(device);
  ctx.fillStyle = '#cdd3e0'; ctx.font = '10px ui-monospace, monospace';
  ctx.fillText(v.prompt, 12, 40);
  let ty = 72;
  for (const o of v.options) {
    ctx.fillStyle = o.selected ? '#e6c15a' : '#8fa0c8';
    ctx.fillText((o.selected ? '> ' : '  ') + o.label, 16, ty);
    ty += 18;
  }
  ctx.fillStyle = '#45506a'; ctx.font = '8px ui-monospace, monospace';
  ctx.fillText(v.hint, 16, H - 12);
  renderModelBackdrop();
}

function renderEnded() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#cdd3e0'; ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(`It ends: ${world.arc.choice}`, 12, 20);
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillStyle = '#8fb6ff';
  const CHARS_PER_LINE = 46;
  let ty = 40;
  for (let i = 0; i < sagaCode.length && ty < H - 6; i += CHARS_PER_LINE, ty += 10) {
    ctx.fillText(sagaCode.slice(i, i + CHARS_PER_LINE), 12, ty);
  }
}

const buildEl = document.getElementById('build');
function render(nowMs) {
  const device = tickFrame(nowMs);
  if (mode === 'title') renderTitle(device);
  else if (mode === 'cutscene') { ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, canvas.width, canvas.height); if (world) renderModelBackdrop(); if (cutscene) cutscene.draw(ctx); }
  else if (mode === 'choice') renderChoice(device);
  else if (mode === 'ended') renderEnded();
  // Driven from the same frame, so the visible mode/build line can never lag
  // behind actual state (the-game-prologue#E8 — observable, not guessed).
  buildEl.textContent = `the recursion · build ${BUILD_ID} · mode ${mode}` + (world ? ` · fp ${fingerprint(fingerprintOf(world))}` : '');
  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// Headless hooks — e2e drives the SAME input/title/reducer the UI does.
window.__game = {
  world: () => world,
  mode: () => mode,
  dispatch,
  input,
  title,
  fingerprint: () => (world ? fingerprint(fingerprintOf(world)) : null),
  forceBegin: (opts) => { world = newWorld(opts); beginIntro(); },
  runScript: (seed = 'recursion-smoke') => { world = makeWorld(seed); for (const c of demoScript()) reduce(world, c); return fingerprint(fingerprintOf(world)); },
  // Cutscene drive/read for headless e2e (skip fires all remaining markers).
  cutscene: () => (cutscene ? { id: cutscene.sceneId, elapsedMs: cutscene.elapsedMs(), firedCount: cutscene.firedCount(), ended: cutscene.isEnded(), cosmetics: cutscene.cosmetics() } : null),
  skipCutscene: () => { if (cutscene) cutscene.skip(); },
  cutsceneActiveId: () => (world ? world.cutscene.activeId : null),
  sagaCode: () => sagaCode,
  learningMap: () => learningMap,
  BUILD_ID,
};
