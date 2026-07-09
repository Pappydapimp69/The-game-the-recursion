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
import { makeSpriteSheet } from './app/sprites.js';
import { createAudio } from './app/audio.js';
import { PALETTE, shade } from './app/palette.js';
import { exportSaga } from './sim/saga.js';
import { gen, DEFAULT_SPEC, GEN_VERSION } from './sim/procgen.js';
import { buildFacts, selectBeat } from './sim/director.js';
import { axisRead } from './sim/playermodel.js';
import { BEATS, CHOICE_POINTS, ENDINGS, ECHO_COUNT } from './sim/content.js';
import { labelFor } from './app/device-labels.js';

// Bump per deploy so a stale cache is observable, not guessed (the-game-prologue#E8).
const BUILD_ID = 'p20';

// A cutscene shares its skip control with nothing else, but a bare tap can
// still eat a story beat by accident — require a deliberate ~1.2s HOLD instead
// (wrong-sky precedent, freshly written back to memory). The counter is
// AUTHORITATIVE: it only grows while input.isHeld('skip') reads true this
// frame and snaps to 0 the instant it doesn't — never inferred from how long
// ago the button was released (the-game-prologue#E7).
const HOLD_DISMISS_MS = 1200;

// Cutscenes play out at a QUARTER of their authored pace — the letterbox
// bars, the entity's breathing/scale animation, and the caption typewriter
// (cutscene-player.js) are all driven off the SAME internal elapsed clock, so
// scaling the real-time delta fed into it is the one lever that slows
// everything in lockstep, rather than four separate speed knobs drifting out
// of sync with each other.
const CUTSCENE_SPEED = 0.25;

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

// The canvas's 320x240 attributes are its native pixel BUFFER, not its display
// size — CSS `max-width/height: 100%` is only a ceiling, so with no explicit
// CSS size the canvas rendered at a literal 320x240 CSS-pixel box, tiny on any
// real screen. Scale it up to fill the AVAILABLE space instead: measure the
// #stage container's own post-layout box (its clientWidth/clientHeight), not
// the raw window — #stage is what's actually left after the HUD row below it
// takes its own space, so this stays correct no matter what else shares the
// page, rather than hardcoding one bar's height as a magic-number subtraction.
// Fit the CONSTRAINING (shorter) axis (waiting-city#E7 — a formula that only
// looks at one axis over-zooms or under-fills depending on orientation), at an
// INTEGER factor so nearest-neighbor pixel art stays crisp (no fractional-pixel
// blur). A small fractional allowance keeps portrait phones (which cap in the
// low 1.x range on integer-only scaling) from sitting oddly small.
const stage = document.getElementById('stage');
function fitCanvas() {
  const aw = stage.clientWidth, ah = stage.clientHeight;
  const raw = Math.min(aw / canvas.width, ah / canvas.height);
  const scale = raw >= 2 ? Math.floor(raw) : Math.max(1, Math.round(raw * 4) / 4);
  canvas.style.width = `${Math.round(canvas.width * scale)}px`;
  canvas.style.height = `${Math.round(canvas.height * scale)}px`;
}
fitCanvas();
window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', fitCanvas);

const input = createInput(window);
const audio = createAudio(); // fully synthesized; safe no-op if Web Audio is unavailable
let audioStarted = false;    // unlocked + drone started on the first real gesture

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
let cutsceneNode = '';    // which spine node the active cutscene visualizes (P12)
let lastFrameMs = 0;      // cutscene's own capped-delta clock
let cutsceneHoldMs = 0;   // authoritative hold-to-skip counter (p19)
let cutsceneSkipped = false; // true only when THIS scene ended via hold-to-skip, not the natural clock
let prevMs = 0;           // general per-frame delta for exploration
let animMs = 0;           // free-running clock for idle animation
let caughtFlash = 0;      // ms remaining on the red 'caught' vignette (P16)

let title = createTitleScreen({
  onBegin: (opts) => startRun(opts),
  promptForCode: () => window.prompt('Paste a saga code (or Cancel for a fresh start):'),
});

function dispatch(cmd) { return world ? reduce(world, cmd) : []; }
function newWorld(opts) {
  // The seed varies per run (chosen here in the app layer — the sim never rolls
  // ambient randomness) so every descent generates a DIFFERENT map, then is
  // stored in world.seed so that run stays reproducible. e2e/tests can pass a
  // fixed opts.seed for a stable map.
  const seed = (opts && opts.seed) || `deep-${Date.now()}`;
  return makeWorld(seed, { ...opts, totalChoicePoints: CHOICE_POINTS.length, echoTotal: ECHO_COUNT });
}

// One place a run starts: build the world AND its sprite sheet (seeded from the
// same seed, so the art is as reproducible as the map), then enter the intro.
function startRun(opts) {
  world = newWorld(opts);
  sprites = makeSpriteSheet({ seed: world.seed });
  audio.setChord('intro'); audio.setMood(0.15);
  beginIntro();
}

// Bank whatever lost voices the player is carrying — safe, authoritative.
function deliverCarried() {
  if (!explore) return;
  const n = explore.takeCarried();
  if (n > 0) { dispatch({ type: 'DELIVER_ECHOES', n }); audio.chime(); }
}

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
  cutsceneHoldMs = 0;
  cutsceneSkipped = false;
  cutsceneOnEnd = onEnd;
  cutsceneNode = scene.id.split(':')[0];
  audio.chime(); // a soft stinger as a beat opens
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
  audio.setChord('learning'); audio.setMood(0.35);
  learningMap = gen(world.seed, GEN_VERSION, DEFAULT_SPEC);
  explore = createExplore(learningMap, CHOICE_POINTS, {
    echoCount: ECHO_COUNT,
    onGather: () => audio.confirm(), // a soft note as a lost voice is taken up
    onCaught: () => { caughtFlash = 700; audio.cancel(); }, // the hunter reaches you
    onReachChoice: (assignment) => {
      // The encounter-echo is the quest-giver: reaching it also banks whatever
      // you carried this far, safe from the hunter.
      if (assignment.slot && assignment.slot.role === 'encounter') deliverCarried();
      openChoice(assignment.cp, () => {
        explore.resolveChoice(assignment);
        mode = 'explore';
      }, (opt) => dispatch({ type: 'CHOOSE_OPTION', pointId: assignment.cp.id, axis: opt.axis, weight: opt.weight }));
    },
    onReachExit: () => {
      deliverCarried(); // carry everything else up as you leave
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
  audio.setChord('reveal'); audio.setMood(0.6);
  startCutscene(makeBeatScene('reveal'), () => {
    dispatch({ type: 'ADVANCE_SPINE' }); // reveal(2) -> hollow(3)
    beginHollow();
  });
}

function beginHollow() {
  audio.setChord('hollow'); audio.setMood(0.88);
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

  // Audio unlocks on the FIRST real gesture (autoplay policy), fire-and-forget —
  // never awaited (Brave's shields leave resume() pending forever; dog#E1).
  if (!audioStarted && presses.length) { audio.resume(); audio.startDrone(); audioStarted = true; }

  if (mode === 'title') {
    title.handlePresses(presses);
  } else if (mode === 'cutscene') {
    if (input.isHeld('skip')) {
      cutsceneHoldMs += dt;
      if (cutsceneHoldMs >= HOLD_DISMISS_MS) { cutscene.skip(); cutsceneSkipped = true; }
    } else {
      cutsceneHoldMs = 0;
    }
    if (!cutscene.isEnded()) {
      const cdt = lastFrameMs ? (nowMs - lastFrameMs) * CUTSCENE_SPEED : 0;
      cutscene.advance(cdt);
    }
    lastFrameMs = nowMs;
    // A deliberate hold-to-skip advances immediately (the player already made
    // the call). Reaching the end NATURALLY never auto-advances on its own —
    // it waits for an explicit confirm, so nobody gets yanked into the next
    // beat mid-read just because the clock ran out.
    if (cutscene.isEnded() && (cutsceneSkipped || presses.includes('confirm'))) endCutscene();
  } else if (mode === 'explore') {
    // The player's inquiry lean is the echoes' curiosity: a curious diver draws
    // the drifting voices close, a direct/guarded one keeps them at bay.
    const px = explore ? explore.player().x : 0, py = explore ? explore.player().y : 0;
    if (explore) explore.update(move, dt, world ? axisRead('inquiry', world.playerModel.axes.inquiry).lean : 0);
    if (explore && (explore.player().x !== px || explore.player().y !== py)) audio.step();
    if (caughtFlash > 0) caughtFlash = Math.max(0, caughtFlash - dt);
    // The drone tightens when the hunter is on you.
    if (explore) audio.setMood(explore.inDanger() ? 0.85 : 0.35);
  } else if (mode === 'choice') {
    if (presses.includes('confirm')) audio.confirm();
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

// Entities draw a touch larger than a tile and sit slightly high, so a walker
// reads as standing ON the floor rather than boxed into a cell.
const ENT = 15;

// Draw a creature sprite at an explicit size/position (used for echoes and any
// non-tile-aligned entity). Falls back to a palette blob before sprites load.
function drawEntitySized(which, sx, sy, size, frame) {
  if (sprites) { sprites.drawSprite(ctx, which, sx, sy, size, frame); return; }
  const ramp = which === 'diver' ? PALETTE.diver : which === 'hollow' ? PALETTE.hollow : PALETTE.voice;
  ctx.fillStyle = ramp[1]; ctx.fillRect(sx + 2, sy + 1, size - 4, size - 2);
}

// The player: sized ENT, offset to stand on its tile.
function drawEntity(which, sx, sy, frame) {
  drawEntitySized(which, sx - (ENT - TILE) / 2, sy - (ENT - TILE) - 1, ENT, frame);
}

// Is (x,y) a wall tile that borders at least one floor tile? Those are the only
// walls worth drawing — the carved edge — so the screen reads as rooms hewn from
// rock, not a solid field of wall texture.
function isEdgeWall(tiles, w, h, x, y) {
  if (x < 0 || x >= w || y < 0 || y >= h || tiles[y * w + x] === FLOOR) return false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < w && ny >= 0 && ny < h && tiles[ny * w + nx] === FLOOR) return true;
  }
  return false;
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
      const sx = tx * TILE - camX, sy = ty * TILE - camY;
      if (tiles[ty * w + tx] === FLOOR) drawTile('floor', tx, ty, sx, sy);
      else if (isEdgeWall(tiles, w, h, tx, ty)) drawTile('wall', tx, ty, sx, sy);
    }
  }

  // Ambient echoes drift through first (behind waypoints/player) — the space is
  // inhabited. They flicker (frame toggles fast) and fade with distance.
  const efr = Math.floor(animMs / 140) & 1;
  for (const e of explore.echoes()) {
    const dx = e.x * TILE - camX - ENT / 2, dy = e.y * TILE - camY - ENT / 2;
    ctx.globalAlpha = 0.55;
    drawEntitySized('echo', dx, dy, ENT - 3, efr);
    ctx.globalAlpha = 1;
  }

  // Lost voices to gather: small pulsing motes on the floor. Taken ones vanish
  // (they're being carried); a soft ring marks each one still out there.
  const mote = 0.5 + 0.5 * Math.sin(animMs / 220);
  for (const c of explore.collectibles()) {
    if (c.taken) continue;
    const dx = c.x * TILE - camX + TILE / 2, dy = c.y * TILE - camY + TILE / 2;
    ctx.globalAlpha = 0.4 + 0.5 * mote;
    ctx.fillStyle = PALETTE.voice[2];
    ctx.beginPath(); ctx.arc(dx, dy, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.18 + 0.2 * mote;
    ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Choice waypoints: an unmade choice glows (voice gold, gently pulsing); a made
  // one dims. The ENCOUNTER slot hosts a resident echo you approach to speak
  // with, so it reads as a creature, not a marker. The exit brightens only once
  // every choice is done.
  const pulse = 0.5 + 0.5 * Math.sin(animMs / 320);
  for (const a of explore.assignments) {
    const s = a.slot;
    const dx = s.x * TILE - camX, dy = s.y * TILE - camY;
    if (s.role === 'encounter' && !a.done) {
      // a hovering resident echo, brighter and steadier than the ambient ones
      const bob = Math.round(Math.sin(animMs / 300) * 1.5);
      drawEntitySized('echo', dx - (ENT - TILE) / 2, dy - (ENT - TILE) / 2 + bob, ENT + 1, efr);
    } else if (a.done) {
      ctx.fillStyle = PALETTE.voice[0]; ctx.fillRect(dx + 4, dy + 4, TILE - 8, TILE - 8);
    } else {
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

  // The hunter — the hollow's reaching fragment. Drawn on top; when it's hunting
  // it flickers faster and trails a faint dread.
  const hn = explore.hunter();
  {
    const hx = hn.x * TILE - camX - ENT / 2, hy = hn.y * TILE - camY - ENT / 2;
    if (explore.inDanger()) { ctx.globalAlpha = 0.18; ctx.fillStyle = PALETTE.hollow[0];
      ctx.beginPath(); ctx.arc(hx + ENT / 2, hy + ENT / 2, ENT * 0.7, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    drawEntitySized('hollow', hx, hy, ENT + 1, Math.floor(animMs / (explore.inDanger() ? 110 : 220)) & 1);
  }

  // Danger vignette while hunted; a sharper red flash on a fresh catch.
  if (explore.inDanger() || caughtFlash > 0) {
    const a = caughtFlash > 0 ? 0.28 * (caughtFlash / 700) + 0.1 : 0.14;
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.28, W / 2, H / 2, H * 0.72);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(158,88,102,${a})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // HUD: choices left, the lost-voices quest, and the live model.
  ctx.fillStyle = PALETTE.ink[1]; ctx.font = '9px ui-monospace, monospace';
  const rem = explore.remaining();
  ctx.fillText(rem > 0 ? `voices to hear: ${rem}` : 'the way out is open', 8, 16);
  const carried = explore.carried();
  const delivered = world.quest.delivered, total = world.quest.total;
  ctx.fillStyle = PALETTE.voice[1];
  ctx.fillText(`lost voices  saved ${delivered}/${total}` + (carried > 0 ? `  ·  carrying ${carried}` : ''), 8, 28);
  if (explore.inDanger()) {
    ctx.fillStyle = PALETTE.hollow[2];
    ctx.fillText('the hollow has your scent — reach the light', 8, 40);
  }
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

// The cinematic layer: a single animated entity per beat, breathing and lit,
// that visualizes the moment — the diver descending in the intro, the echo
// swelling as the voice "shows you yourself" in the reveal, and a finale shaped
// by YOUR ending. Driven off the cutscene's own elapsed clock, so the verified
// determinism contract of the player is untouched (this only reads time).
function renderCutsceneEntity(node, tMs, totalMs) {
  const W = canvas.width, H = canvas.height;
  const p = Math.max(0, Math.min(1, tMs / Math.max(1, totalMs)));
  const ease = 1 - (1 - p) * (1 - p);
  const breathe = 1 + 0.06 * Math.sin(tMs / 500);
  const frame = Math.floor(tMs / 160) & 1;
  const cx = W / 2;

  let which = 'echo', ramp = 'voice', size = 52, cy = H / 2, alpha = 1, companion = null;
  if (node === 'intro') {
    which = 'diver'; ramp = 'diver';
    cy = 52 + (H / 2 - 52) * ease; // descend from above into the deep
    size = 46 * breathe;
    alpha = 0.3 + 0.7 * Math.min(1, p * 2);
  } else if (node === 'reveal') {
    which = 'echo'; ramp = 'voice';
    size = (38 + 26 * ease) * breathe; // grows as it takes your measure
  } else if (node === 'finale') {
    const listen = world && world.arc.choice === 'listen';
    which = listen ? 'diver' : 'echo';
    ramp = listen ? 'diver' : 'voice';
    size = 50 * breathe;
    if (listen) companion = 'echo';   // you let it speak: the two stand together
    else alpha = 1 - 0.85 * ease;      // you silenced it: the voice fades out
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  // Soft glow: stacked translucent discs in the ramp's light shade.
  const glow = PALETTE[ramp][2];
  for (let i = 4; i >= 1; i--) {
    ctx.globalAlpha = alpha * 0.06 * i;
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, (size * 0.6) * (i / 2.2), 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = alpha;
  drawEntitySized(which, cx - size / 2, cy - size / 2, size, frame);
  if (companion) drawEntitySized(companion, cx + size * 0.34, cy - size * 0.42, size * 0.74, frame ^ 1);
  ctx.restore();
}

// Cutscene control hint, in the ACTIVE device's own language (never baked at
// construct time — the-game-prologue#E3/#E6). Two distinct states: mid-scene
// it's a hold-to-skip hint + progress bar (the bar only appears once the
// player has actually started holding, so it doesn't clutter a cutscene
// someone's just watching); once the scene has fully played out, skip is
// moot and it becomes a plain "continue" prompt instead.
function renderHoldToSkip(device) {
  const W = canvas.width;
  ctx.font = '8px ui-monospace, monospace';
  ctx.fillStyle = PALETTE.ink[3];
  ctx.textAlign = 'right';
  if (cutscene.isEnded()) {
    ctx.fillText(`${labelFor(device, 'confirm')} to continue`, W - 8, 14);
  } else {
    ctx.fillText(`hold ${labelFor(device, 'skip')} to skip`, W - 8, 14);
    if (cutsceneHoldMs > 0) {
      const frac = Math.min(1, cutsceneHoldMs / HOLD_DISMISS_MS);
      const barW = 60, barH = 4, bx = W - 8 - barW, by = 18;
      ctx.fillStyle = PALETTE.ink[3]; ctx.fillRect(bx, by, barW, barH);
      ctx.fillStyle = PALETTE.voice[1]; ctx.fillRect(bx, by, barW * frac, barH);
    }
  }
  ctx.textAlign = 'left';
}

const buildEl = document.getElementById('build');
function render(nowMs) {
  const device = tickFrame(nowMs);
  if (mode === 'title') renderTitle(device);
  else if (mode === 'cutscene') {
    ctx.fillStyle = PALETTE.void; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (cutscene) {
      renderCutsceneEntity(cutsceneNode, cutscene.elapsedMs(), STAGE_TIMING[cutsceneNode] ? STAGE_TIMING[cutsceneNode].totalMs : 2400);
      cutscene.draw(ctx);
      renderHoldToSkip(device);
    }
  }
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
  forceBegin: (opts) => startRun(opts),
  runScript: (seed = 'recursion-smoke') => { world = makeWorld(seed); for (const c of demoScript()) reduce(world, c); return fingerprint(fingerprintOf(world)); },
  cutscene: () => (cutscene ? { id: cutscene.sceneId, elapsedMs: cutscene.elapsedMs(), firedCount: cutscene.firedCount(), ended: cutscene.isEnded(), cosmetics: cutscene.cosmetics() } : null),
  skipCutscene: () => { if (cutscene) { cutscene.skip(); cutsceneSkipped = true; } },
  cutsceneActiveId: () => (world ? world.cutscene.activeId : null),
  // Exploration hooks for e2e: read the player tile, force-walk to a slot.
  explore: () => (explore ? { player: explore.player(), remaining: explore.remaining(), atExitReady: explore.atExitReady(),
    assignments: explore.assignments.map((a) => ({ pointId: a.cp.id, slot: a.slot, done: a.done })), exit: learningMap.exit,
    carried: explore.carried(), collectibles: explore.collectibles().map((c) => ({ x: c.x, y: c.y, taken: c.taken })),
    hunter: { x: explore.hunter().x, y: explore.hunter().y, state: explore.hunter().state }, inDanger: explore.inDanger() } : null),
  exploreStep: (dx, dy, dt = 120) => { if (explore) explore.update([Math.sign(dx), Math.sign(dy)], dt); },
  // Advance only the ambient/hunter sim (no move) — e2e drives the hunter clock.
  exploreTick: (dt = 100) => { if (explore) explore.update([0, 0], dt); },
  // Teleport the hunter next to the player to force a catch on the next tick (e2e).
  forceHunterOnto: () => { if (explore) { const p = explore.player(); const hn = explore.hunter(); hn.x = p.x + 0.5; hn.y = p.y + 0.7; hn.state = 'hunt'; hn.stun = 0; } },
  sagaCode: () => sagaCode,
  learningMap: () => learningMap,
  BUILD_ID,
};
