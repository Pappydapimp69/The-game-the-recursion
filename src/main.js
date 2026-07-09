// P1: the real front door. Title (gamepad-first character creation) -> gameplay,
// both driven by ONE unified input layer polled once per frame. Exposes
// window.__game so headless e2e can drive the same reducer/input the UI does.

import { makeWorld, fingerprintOf, AXES } from './sim/world.js';
import { reduce, leanLabel } from './sim/reduce.js';
import { fingerprint } from './sim/fingerprint.js';
import { demoScript } from './sim/demo.js';
import { createInput } from './app/input.js';
import { createTitleScreen } from './app/title.js';
import { hintLine } from './app/device-labels.js';

// Bump per deploy so a stale cache is observable, not guessed (the-game-prologue#E8).
const BUILD_ID = 'p1';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const input = createInput(window);

// mode is the ONE source of truth for which screen is live — every dismissal
// path sets it explicitly so nothing leaks between modes (test#E6).
let mode = 'title'; // 'title' | 'play'
let world = null;
let title = createTitleScreen({
  onBegin: (opts) => { world = makeWorld('recursion', opts); mode = 'play'; },
  promptForCode: () => window.prompt('Paste a saga code (or Cancel for a fresh start):'),
});

function dispatch(cmd) { return world ? reduce(world, cmd) : []; }

function tickFrame(nowMs) {
  const { device } = input.sample(nowMs);
  const presses = input.takePresses();
  if (mode === 'title') {
    title.handlePresses(presses);
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
  if (mode === 'title') renderTitle(device); else renderPlay();
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
  forceBegin: (opts) => { world = makeWorld('recursion', opts); mode = 'play'; },
  runScript: (seed = 'recursion-smoke') => { world = makeWorld(seed); mode = 'play'; for (const c of demoScript()) reduce(world, c); return fingerprint(fingerprintOf(world)); },
  BUILD_ID,
};
