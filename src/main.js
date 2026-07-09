// The front door, running the whole fixed spine (PROPOSAL §4): title -> intro
// -> learning (WALKED as a real space now; choices feed the player-model) ->
// reveal -> hollow (the ending choice) -> finale -> the saga.v5 code. One
// unified input layer polled once per frame; `mode` is the ONE source of truth
// for which screen is live. Exposes window.__game so headless e2e can drive the
// same reducer/UI the player does.

import { makeWorld, fingerprintOf, AXES } from './sim/world.js';
import { reduce, leanLabel } from './sim/reduce.js';
import { fingerprint } from './sim/fingerprint.js';
import { demoScript } from './sim/demo.js';
import { seedState, subStream } from './sim/rng.js';
import { FLOOR } from './sim/procgen.js';
import { createInput } from './app/input.js';
import { createTitleScreen } from './app/title.js';
import { createChoiceScreen } from './app/choice-screen.js';
import { createCutscenePlayer } from './app/cutscene-player.js';
import { createExplore } from './app/explore.js';
import { PALETTE, shade } from './app/palette.js';
import { exportSaga } from './sim/saga.js';
import { gen, DEFAULT_SPEC, GEN_VERSION } from './sim/procgen.js';
import { buildFacts, selectBeat } from './sim/director.js';
import { BEATS, CHOICE_POINTS, ENDINGS } from './sim/content.js';

// Bump per deploy so a stale cache is observable, not guessed (the-game-prologue#E8).
const BUILD_ID = 'p8';

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

// mode is the ONE source of truth for which screen is live (test#E6).
let mode = 'title'; // 'title' | 'cutscene' | 'explore' | 'choice' | 'ended'
let world = null;
let cutscene = null;
let cutsceneOnEnd = null;
let choiceScreen = null;
let choiceOnClose = null; // where a resolved choice returns to (explore, or the spine)
let explore = null;       // the active exploration space, or null
let learningMap = null;
let sagaCode = '';
let sprites = null;       // the procedural sprite sheet, set once a world exists (P9)
let lastFrameMs = 0;      // cutscene's own capped-delta clock
let prevMs = 0;           // general per-frame delta for exploration
let animMs = 0;           // free-running clock for idle animation

let title = createTitleScreen({
  onBegin: (opts) => { world = newWorld(opts); beginIntro(); },
  promptForCode: () => window.prompt('Paste a saga code (or Cancel for a fresh start):'),
});

function dispatch(cmd) { return world ? reduce(world, cmd) : []; }
function newWorld(opts) { return makeWorld('recursion', { ...opts, totalChoicePoints: CHOICE_POINTS.length }); }

// --- cutscene plumbing (unchanged from P6) ----------------------------------
function makeBeatScene(spineNode) {
  const facts = buildFacts(world);
  const beatId = selectBeat(facts, BEATS, { spineNode, lastPlayed: world.director.lastPlayed });
  const beat = BEATS.find((b) => b.id === beatId) || { lines: ['...'] };
  dispatch({ type: 'BEAT_PLAYED', beatId });
  const timing = STAGE_TIMING[spineNode];
  const lines = beat.lines;
  const span = timing.totalMs - 300;
  const captions = lines.map((text, i) => ({ atMs: 150 + Math.round((span * i) / Math.max(1, lines.length)), text }));
  return { id: `${spineNode}:${beatId}`, totalMs: timing.totalMs, cmdMarkers: timing.extraMarkers || [],
    cosmeticTracks: { letterbox: timing.letterbox, captions } };
}

function startCutscene(scene, onEnd) {
  const rng = subStream(seedState(world.rng.join(':')), 'cutscene:' + scene.id);
  cutscene = createCutscenePlayer(scene, { dispatch, rng });
  lastFrameMs = 0;
  cutsceneOnEnd = onEnd;
  mode = 'cutscene';
}
function endCutscene() {
  cutscene = null;
  const next = cutsceneOnEnd; cutsceneOnEnd = null;
  if (next) next();
}

// --- the fixed spine, in order (PROPOSAL §4) --------------------------------
function beginIntro() {
  startCutscene(makeBeatScene('intro'), () => {
    dispatch({ type: 'ADVANCE_SPINE' }); // intro(0) -> learning(1)
    beginLearning();
  });
}

// "The learning" is now a walked space. Generate this run's map (pure function
// of the seed), drop the player at the entry, and let them find the choices.
function beginLearning() {
  learningMap = gen(world.seed, GEN_VERSION, DEFAULT_SPEC);
  explore = createExplore(learningMap, CHOICE_POINTS, {
    onReachChoice: (assignment) => openChoice(assignment.cp, () => {
      explore.resolveChoice(assignment);
      mode = 'explore';
    }, (opt) => dispatch({ type: 'CHOOSE_OPTION', pointId: assignment.cp.id, axis: opt.axis, weight: opt.weight })),
    onReachExit: () => {
      dispatch({ type: 'ADVANCE_SPINE' }); // learning(1) -> reveal(2)
      explore = null;
      beginReveal();
    },
  });
  mode = 'explore';
}

// Open a choice screen; onCommit runs the authoritative dispatch, onClose
// returns control to wherever we came from.
function openChoice(cp, onClose, onCommit) {
  choiceOnClose = onClose;
  choiceScreen = createChoiceScreen({
    prompt: cp.prompt,
    options: cp.options,
    onChoose: (_i, opt) => {
      if (onCommit) onCommit(opt);
      choiceScreen = null;
      const close = choiceOnClose; choiceOnClose = null;
      if (close) close();
    },
  });
  mode = 'choice';
}

function beginReveal() {
  startCutscene(makeBeatScene('reveal'), () => {
    dispatch({ type: 'ADVANCE_SPINE' }); // reveal(2) -> hollow(3)
    beginHollow();
  });
}

function beginHollow() {
  openChoice(
    { id: 'hollow', prompt: 'The hollow waits, wearing your shape. What do you do with the voice it stole?', options: ENDINGS },
    () => { dispatch({ type: 'ADVANCE_SPINE' }); beginFinale(); }, // hollow(3) -> finale(4)
    (ending) => dispatch({ type: 'END', choice: ending.id }),
  );
}

function beginFinale() {
  startCutscene(makeBeatScene('finale'), () => {
    dispatch({ type: 'ADVANCE_SPINE' }); // finale(4) -> done(5)
    beginEnded();
  });
}

function beginEnded() {
  learningMap = null; explore = null;
  sagaCode = exportSaga(world);
  mode = 'ended';
}

// --- input / frame loop ------------------------------------------------------
function tickFrame(nowMs) {
  const { move, device } = input.sample(nowMs);
  const presses = input.takePresses();
  const dt = prevMs ? Math.min(nowMs - prevMs, 50) : 16;
  prevMs = nowMs;
  animMs = nowMs;

  if (mode === 'title') {
    title.handlePresses(presses);
  } else if (mode === 'cutscene') {
    if (presses.includes('skip')) cutscene.skip();
    else { const cdt = lastFrameMs ? nowMs - lastFrameMs : 0; cutscene.advance(cdt); }
    lastFrameMs = nowMs;
    if (cutscene.isEnded()) endCutscene();
  } else if (mode === 'explore') {
    if (explore) explore.update(move, dt);
  } else if (mode === 'choice') {
    if (choiceScreen) choiceScreen.handlePresses(presses);
  }
  return device;
}

// --- rendering ---------------------------------------------------------------
const TILE = 12;

function renderTitle(device) {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = PALETTE.void; ctx.fillRect(0, 0, W, H);
  ctx.font = '12px ui-monospace, monospace';
  ctx.fillStyle = PALETTE.ink[0];
  ctx.fillText('THE RECURSION', 16, 24);
  const v = title.view(device);
  let ty = 60;
  for (const row of v.rows) {
    ctx.fillStyle = row.selected ? PALETTE.voice[1] : PALETTE.ink[2];
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText(`${row.selected ? '> ' : '  '}${row.label}${row.value ? ': ' + row.value : ''}`, 16, ty);
    ty += 16;
  }
  ctx.fillStyle = PALETTE.ink[3];
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillText(v.hint, 16, H - 12);
}

function renderModelHud() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = PALETTE.ink[2]; ctx.font = '8px ui-monospace, monospace';
  let ty = H - 54;
  ctx.fillText(`${world.settings.archetype} / ${world.settings.difficulty}`, 4, ty);
  for (const axis of Object.keys(AXES)) { ty += 9; ctx.fillText(`${axis}: ${leanLabel(axis, world.playerModel.axes[axis])}`, 4, ty); }
}

// Draw one map tile at screen (sx,sy). Uses the sprite sheet when present,
// else a palette rect so P8 stands alone before sprites (P9) land.
function drawTile(kind, tx, ty, sx, sy) {
  if (sprites) { sprites.drawTile(ctx, kind, (tx * 7 + ty * 13) & 3, sx, sy, TILE); return; }
  ctx.fillStyle = kind === 'floor' ? PALETTE.stone[1] : PALETTE.stone[0];
  ctx.fillRect(sx, sy, TILE, TILE);
  if (kind === 'floor') { ctx.fillStyle = PALETTE.stone[2]; ctx.fillRect(sx, sy, 1, 1); }
}

function drawEntity(which, sx, sy, frame) {
  if (sprites) { sprites.drawSprite(ctx, which, sx, sy, TILE, frame); return; }
  const ramp = which === 'diver' ? PALETTE.diver : which === 'hollow' ? PALETTE.hollow : PALETTE.voice;
  ctx.fillStyle = ramp[1]; ctx.fillRect(sx + 2, sy + 1, TILE - 4, TILE - 2);
  ctx.fillStyle = ramp[2]; ctx.fillRect(sx + 3, sy + 2, 2, 2);
}

function renderExplore() {
  const W = canvas.width, H = canvas.height;
  const { w, h, tiles } = learningMap.grid;
  const p = explore.player();
  ctx.fillStyle = PALETTE.void; ctx.fillRect(0, 0, W, H);

  // Camera centers the player, clamped so we don't scroll far past the map edge.
  const camX = Math.round(p.x * TILE + TILE / 2 - W / 2);
  const camY = Math.round(p.y * TILE + TILE / 2 - H / 2);

  const x0 = Math.max(0, Math.floor(camX / TILE)), x1 = Math.min(w - 1, Math.ceil((camX + W) / TILE));
  const y0 = Math.max(0, Math.floor(camY / TILE)), y1 = Math.min(h - 1, Math.ceil((camY + H) / TILE));
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tiles[ty * w + tx] !== FLOOR) continue;
      drawTile('floor', tx, ty, tx * TILE - camX, ty * TILE - camY);
    }
  }

  // Choice waypoints: an unmade choice glows (voice gold, gently pulsing); a made
  // one dims. The exit brightens only once every choice is done.
  const pulse = 0.5 + 0.5 * Math.sin(animMs / 320);
  for (const a of explore.assignments) {
    const s = a.slot;
    const dx = s.x * TILE - camX, dy = s.y * TILE - camY;
    if (a.done) { ctx.fillStyle = PALETTE.voice[0]; ctx.fillRect(dx + 4, dy + 4, TILE - 8, TILE - 8); }
    else {
      ctx.globalAlpha = 0.4 + 0.5 * pulse;
      ctx.fillStyle = PALETTE.voice[1]; ctx.fillRect(dx + 2, dy + 2, TILE - 4, TILE - 4);
      ctx.globalAlpha = 1;
    }
  }
  const ex = learningMap.exit;
  { const dx = ex.x * TILE - camX, dy = ex.y * TILE - camY;
    ctx.fillStyle = explore.atExitReady() ? PALETTE.diver[2] : PALETTE.stone[2];
    ctx.globalAlpha = explore.atExitReady() ? (0.5 + 0.5 * pulse) : 0.5;
    ctx.fillRect(dx + 3, dy + 3, TILE - 6, TILE - 6); ctx.globalAlpha = 1; }

  // The player.
  const frame = Math.floor(animMs / 380) & 1;
  drawEntity('diver', p.x * TILE - camX, p.y * TILE - camY, frame);

  // HUD: what remains, and the live model.
  ctx.fillStyle = PALETTE.ink[1]; ctx.font = '9px ui-monospace, monospace';
  const rem = explore.remaining();
  ctx.fillText(rem > 0 ? `voices to hear: ${rem}` : 'the way out is open', 8, 16);
  renderModelHud();
}

function renderChoice(device) {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = PALETTE.void; ctx.fillRect(0, 0, W, H);
  if (learningMap) { // keep the space faintly behind the choice, if we're in one
    ctx.globalAlpha = 0.25; renderExploreBackdropOnly(); ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(4,5,10,0.7)'; ctx.fillRect(0, 0, W, H);
  const v = choiceScreen.view(device);
  ctx.fillStyle = PALETTE.ink[0]; ctx.font = '10px ui-monospace, monospace';
  wrapText(v.prompt, 12, 40, W - 24, 13);
  let ty = 100;
  for (const o of v.options) {
    ctx.fillStyle = o.selected ? PALETTE.voice[1] : PALETTE.ink[1];
    ctx.fillText((o.selected ? '> ' : '  ') + o.label, 16, ty);
    ty += 18;
  }
  ctx.fillStyle = PALETTE.ink[3]; ctx.font = '8px ui-monospace, monospace';
  ctx.fillText(v.hint, 16, H - 12);
  renderModelHud();
}

// Just the tiles+player, no HUD — used dimmed behind a choice overlay.
function renderExploreBackdropOnly() {
  if (!explore) return;
  const W = canvas.width, H = canvas.height;
  const { w, h, tiles } = learningMap.grid;
  const p = explore.player();
  const camX = Math.round(p.x * TILE + TILE / 2 - W / 2);
  const camY = Math.round(p.y * TILE + TILE / 2 - H / 2);
  const x0 = Math.max(0, Math.floor(camX / TILE)), x1 = Math.min(w - 1, Math.ceil((camX + W) / TILE));
  const y0 = Math.max(0, Math.floor(camY / TILE)), y1 = Math.min(h - 1, Math.ceil((camY + H) / TILE));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (tiles[ty * w + tx] === FLOOR) drawTile('floor', tx, ty, tx * TILE - camX, ty * TILE - camY);
  }
}

function renderEnded() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = PALETTE.void; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = PALETTE.ink[0]; ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(`It ends: ${world.arc.choice}`, 12, 20);
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillStyle = PALETTE.diver[1];
  const CPL = 46;
  let ty = 40;
  for (let i = 0; i < sagaCode.length && ty < H - 6; i += CPL, ty += 10) ctx.fillText(sagaCode.slice(i, i + CPL), 12, ty);
}

// Small word-wrap helper for prompts that outgrew one line.
function wrapText(text, x, y, maxW, lineH) {
  const words = String(text).split(' ');
  let line = '', ty = y;
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, ty); line = word; ty += lineH; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, ty);
}

const buildEl = document.getElementById('build');
function render(nowMs) {
  const device = tickFrame(nowMs);
  if (mode === 'title') renderTitle(device);
  else if (mode === 'cutscene') { ctx.fillStyle = PALETTE.void; ctx.fillRect(0, 0, canvas.width, canvas.height); if (world) renderModelHud(); if (cutscene) cutscene.draw(ctx); }
  else if (mode === 'explore') renderExplore();
  else if (mode === 'choice') renderChoice(device);
  else if (mode === 'ended') renderEnded();
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
  cutscene: () => (cutscene ? { id: cutscene.sceneId, elapsedMs: cutscene.elapsedMs(), firedCount: cutscene.firedCount(), ended: cutscene.isEnded(), cosmetics: cutscene.cosmetics() } : null),
  skipCutscene: () => { if (cutscene) cutscene.skip(); },
  cutsceneActiveId: () => (world ? world.cutscene.activeId : null),
  // Exploration hooks for e2e: read the player tile, force-walk to a slot.
  explore: () => (explore ? { player: explore.player(), remaining: explore.remaining(), atExitReady: explore.atExitReady(),
    assignments: explore.assignments.map((a) => ({ pointId: a.cp.id, slot: a.slot, done: a.done })), exit: learningMap.exit } : null),
  exploreStep: (dx, dy, dt = 120) => { if (explore) explore.update([Math.sign(dx), Math.sign(dy)], dt); },
  sagaCode: () => sagaCode,
  learningMap: () => learningMap,
  BUILD_ID,
};
