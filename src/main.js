// P1: the real front door. Title (gamepad-first character creation) -> gameplay,
// both driven by ONE unified input layer polled once per frame. Exposes
// window.__game so headless e2e can drive the same reducer/input the UI does.

import { makeWorld, fingerprintOf, AXES } from './sim/world.js';
import { reduce, leanLabel } from './sim/reduce.js';
import { fingerprint } from './sim/fingerprint.js';
import { demoScript } from './sim/demo.js';
import { makeRng, seedState, subStream } from './sim/rng.js';
import { createInput } from './app/input.js';
import { createTitleScreen } from './app/title.js';
import { createCutscenePlayer } from './app/cutscene-player.js';
import { hintLine } from './app/device-labels.js';

// Bump per deploy so a stale cache is observable, not guessed (the-game-prologue#E8).
const BUILD_ID = 'p5';

// A tiny synthetic intro cutscene — data only. Proves the whole pipeline end to
// end (letterbox + captions + markers dispatched through reduce) without being
// real narrative content; the retelling's actual scenes are P6. Markers mutate
// authoritative state the same way gameplay would, so watch and skip agree.
const INTRO_SCENE = {
  id: 'intro',
  totalMs: 2600,
  cmdMarkers: [
    { atMs: 300, cmd: { type: 'RECORD_TRAIT_SIGNAL', axis: 'resolve', weight: 1 } },
    { atMs: 1200, cmd: { type: 'RESTORE_FACET', facet: 'light' } },
    { atMs: 2100, cmd: { type: 'RECORD_TRAIT_SIGNAL', axis: 'mercy', weight: 1 } },
  ],
  cosmeticTracks: {
    letterbox: { inMs: 400, outMs: 400, height: 0.16 },
    captions: [
      { atMs: 150, text: 'You surface.' },
      { atMs: 1100, text: 'The voice remembers your shape.' },
      { atMs: 2050, text: 'It begins again.' },
    ],
  },
};

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const input = createInput(window);

// mode is the ONE source of truth for which screen is live — every dismissal
// path sets it explicitly so nothing leaks between modes (test#E6).
let mode = 'title'; // 'title' | 'cutscene' | 'play'
let world = null;
let cutscene = null;   // the active presentation-layer player, or null
let lastFrameMs = 0;   // for the cutscene's own capped-delta clock
let title = createTitleScreen({
  onBegin: (opts) => { world = makeWorld('recursion', opts); startCutscene(INTRO_SCENE); },
  promptForCode: () => window.prompt('Paste a saga code (or Cancel for a fresh start):'),
});

function dispatch(cmd) { return world ? reduce(world, cmd) : []; }

// Enter cinematic mode: the player dispatches MARK_CUTSCENE(active) itself on its
// first advance, so the authoritative flag flips through the one command path.
function startCutscene(scene) {
  const rng = subStream(seedState(world.rng.join(':')), 'cutscene:' + scene.id);
  cutscene = createCutscenePlayer(scene, { dispatch, rng });
  lastFrameMs = 0;
  mode = 'cutscene';
}

// The single exit: whether the scene finished or was skipped, land in 'play'.
function endCutscene() { cutscene = null; mode = 'play'; }

function tickFrame(nowMs) {
  const { device } = input.sample(nowMs);
  const presses = input.takePresses();
  if (mode === 'title') {
    title.handlePresses(presses);
  } else if (mode === 'cutscene') {
    // Cinematic mode routes input to ONE control only — skip — and advances the
    // player on its own capped-delta clock (the player caps the step). Any frame
    // can end the scene, and both end paths (finish, skip) land through endCutscene.
    if (presses.includes('skip')) cutscene.skip();
    else {
      const dt = lastFrameMs ? nowMs - lastFrameMs : 0;
      cutscene.advance(dt);
    }
    lastFrameMs = nowMs;
    if (cutscene.isEnded()) endCutscene();
  } else if (mode === 'play') {
    for (const p of presses) {
      const m = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[p];
      if (m) dispatch({ type: 'MOVE', dx: m[0], dy: m[1] });
    }
  }
  return device;
}

const TILE = 12;
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

function renderPlay() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#10131d'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += TILE) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }
  ctx.fillStyle = world.settings.imported ? '#e6c15a' : '#8fb6ff';
  ctx.fillRect(world.player.x * TILE + 2, world.player.y * TILE + 2, TILE - 4, TILE - 4);
  ctx.fillStyle = '#5a6a8a'; ctx.font = '8px ui-monospace, monospace';
  let ty = 10;
  ctx.fillText(`${world.settings.archetype} / ${world.settings.difficulty}  tick ${world.tick}  @(${world.player.x},${world.player.y})`, 4, ty);
  for (const axis of Object.keys(AXES)) { ty += 9; ctx.fillText(`${axis}: ${leanLabel(axis, world.playerModel.axes[axis])}`, 4, ty); }
}

const buildEl = document.getElementById('build');
function render(nowMs) {
  const device = tickFrame(nowMs);
  if (mode === 'title') renderTitle(device);
  else if (mode === 'cutscene') { renderPlay(); if (cutscene) cutscene.draw(ctx); }
  else renderPlay();
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
  forceBegin: (opts) => { world = makeWorld('recursion', opts); startCutscene(INTRO_SCENE); },
  runScript: (seed = 'recursion-smoke') => { world = makeWorld(seed); mode = 'play'; for (const c of demoScript()) reduce(world, c); return fingerprint(fingerprintOf(world)); },
  // Cutscene drive/read for headless e2e (skip fires all remaining markers).
  cutscene: () => (cutscene ? { id: cutscene.sceneId, elapsedMs: cutscene.elapsedMs(), firedCount: cutscene.firedCount(), ended: cutscene.isEnded(), cosmetics: cutscene.cosmetics() } : null),
  skipCutscene: () => { if (cutscene) cutscene.skip(); },
  cutsceneActiveId: () => (world ? world.cutscene.activeId : null),
  BUILD_ID,
};
