// P0 bootstrap: prove the deterministic core runs in a real browser and that its
// fingerprint matches Node (Node/browser parity — the-game-prologue#E1). This is
// deliberately thin; P1 replaces input with the unified vocabulary + gamepad, and
// the renderer grows from there. It exposes window.__game so headless e2e can
// drive the SAME reducer the UI does.

import { makeWorld, fingerprintOf } from './sim/world.js';
import { reduce, leanLabel } from './sim/reduce.js';
import { fingerprint } from './sim/fingerprint.js';
import { demoScript } from './sim/demo.js';
import { AXES } from './sim/world.js';

// Bump per deploy so a stale cache is observable, not guessed (the-game-prologue#E8).
const BUILD_ID = 'p0';

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

let world = makeWorld('recursion');

// Dispatch through the ONE reducer; the loop re-reads state each frame.
function dispatch(cmd) { return reduce(world, cmd); }

// Minimal placeholder input (P1 builds the real unified/gamepad layer). Arrow
// keys / WASD move the marker so the browser verify shows a live, deterministic
// world. Presses are edge-triggered here; P1 adds the event-time queue.
const KEYMAP = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};
window.addEventListener('keydown', (e) => {
  const m = KEYMAP[e.key];
  if (m) { dispatch({ type: 'MOVE', dx: m[0], dy: m[1] }); e.preventDefault(); }
});

const TILE = 12;
function render() {
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#05060a';
  ctx.fillRect(0, 0, W, H);

  // faint grid so motion is legible
  ctx.strokeStyle = '#10131d';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += TILE) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke(); }

  // the marker
  ctx.fillStyle = world.settings.imported ? '#e6c15a' : '#8fb6ff';
  ctx.fillRect(world.player.x * TILE + 2, world.player.y * TILE + 2, TILE - 4, TILE - 4);

  // HUD: what the voice currently leans (proves the model is live)
  ctx.fillStyle = '#5a6a8a';
  ctx.font = '8px ui-monospace, monospace';
  let ty = 10;
  ctx.fillText(`tick ${world.tick}  @(${world.player.x},${world.player.y})`, 4, ty);
  for (const axis of Object.keys(AXES)) {
    ty += 9;
    ctx.fillText(`${axis}: ${leanLabel(axis, world.playerModel.axes[axis])}`, 4, ty);
  }

  requestAnimationFrame(render);
}
requestAnimationFrame(render);

// Live build id + current fingerprint, so parity with Node is visible on screen.
const buildEl = document.getElementById('build');
function refreshBuild() {
  buildEl.textContent = `the recursion · build ${BUILD_ID} · fp ${fingerprint(fingerprintOf(world))}`;
  setTimeout(refreshBuild, 250);
}
refreshBuild();

// Headless hook — e2e drives the same reducer the UI does.
window.__game = {
  world: () => world,
  dispatch,
  fingerprint: () => fingerprint(fingerprintOf(world)),
  reset: (seed, options) => { world = makeWorld(seed, options); },
  // Replay the exact smoke script in-browser so e2e can assert Node/browser
  // fingerprint parity without duplicating the sequence (drift-proof).
  runScript: (seed = 'recursion-smoke') => { world = makeWorld(seed); for (const c of demoScript()) reduce(world, c); return fingerprint(fingerprintOf(world)); },
  BUILD_ID,
};
