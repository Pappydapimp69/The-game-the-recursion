// "The learning" as an actually-walked space, not three menus over a dim
// backdrop. The player moves tile-by-tile through the procgen map; reaching a
// choice-point's assigned slot opens that choice; once every choice is made,
// reaching the exit ends the stage.
//
// DELIBERATELY presentation-only. Movement never touches the sim — the ONLY
// authoritative event the learning stage produces is CHOOSE_OPTION (fired by
// main when a choice resolves) and ADVANCE_SPINE/ADVANCE_DEPTH/UNLOCK_ABILITY.
// The sim doesn't care HOW you walked to a slot, only which option you picked
// and in what order, so the golden fingerprint and the scripted-spine test
// stay valid no matter the path (the sim/presentation split — discrete
// authoritative facts vs continuous cosmetic detail). The map itself is a pure
// function of world.seed, so this whole space is reproducible without storing
// a single tile in the save.
//
// Enemies and player abilities are ALL presentation-only, same reasoning as
// the original hunter (P16): whatever they do only touches presentation state
// (position, cooldowns, what you're carrying), never the sim, so adding more
// of either never risks the determinism contract.

import { FLOOR } from '../sim/procgen.js';
import { makeRng } from '../sim/rng.js';

const STEP_MS = 108; // grid-step cadence while a direction is held
const N_ECHOES = 4;  // ambient drifting voices that inhabit the space

const SENSE_R = 5.5;   // tiles: within this (and not on a haven) the hunter wakes
const LEASH_R = 10;    // tiles: beyond this it gives up and settles (defend-and-reset)
const HUNT_SPD = 4.6;  // tiles/sec while pursuing — outrunnable in a straight line, but it cuts corners
const WANDER_SPD = 1.5;
const CATCH_R = 0.55;  // tiles: this close and it catches you
const STUN_MS = 1600;  // after a catch it recoils, giving you a moment

// The warden (depth 2+): a squat guardian rooted near one spot. It wakes when
// you cross its (short) wake radius, LUNGES at you for a bounded burst, then
// returns to its post regardless of whether it caught you — an obstacle to
// route AROUND, not a sustained chase like the hunter (research: vary the
// sensing/return rule, not just the stats, to make a second enemy feel like a
// different kind of problem).
const WARDEN_WAKE_R = 3.5;
const WARDEN_LUNGE_SPD = 5.2;
const WARDEN_RETURN_SPD = 2.2;
const WARDEN_LUNGE_MS = 2200; // gives up the lunge and heads home after this long
const WARDEN_CATCH_R = 0.6;
const WARDEN_KNOCKBACK_TILES = 2;
const WARDEN_STUN_MS = 900;

// The screamer (depth 3+): fast, harmless on its own — it never catches you.
// If it SEES you within its (generous) sense radius it alerts, forcing the
// HUNTER into hunt state immediately even if the hunter itself is far away
// (research: couple enemy systems together rather than adding pure damage
// variety). It then flees toward a new wander target so it can't sit and
// spam alerts.
const SCREAMER_SENSE_R = 6.5;
const SCREAMER_SPD = 3.4;
const SCREAMER_ALERT_COOLDOWN_MS = 4500;

// Ability tuning. All presentation-only effects on enemy state/player position
// — never touch the sim (abilities are UNLOCKED via UNLOCK_ABILITY, an
// authoritative fact; USING one, every time, is not). Exported so main.js's
// HUD (cooldown bars, the pulse ring) reads the SAME numbers rather than
// keeping its own guessed copies that could silently drift out of sync.
export const PULSE_COOLDOWN_MS = 3000;
export const PULSE_RADIUS = 3.5;
const PULSE_STUN_MS = 1200;
export const DASH_COOLDOWN_MS = 2500;
const DASH_TILES = 3;
export const WARD_COOLDOWN_MS = 7000;
const WARD_DURATION_MS = 2500;

export function createExplore(map, choicePoints, {
  onReachChoice, onReachExit, onGather, onCaught, echoCount = 0,
  enemyKinds = ['hunter'], abilities = {},
} = {}) {
  const { w, h, tiles } = map.grid;

  // Give every choice point its OWN distinct position: the interior slots first
  // (never entry/exit), then extra floor tiles for any overflow, so no two
  // choices ever share a tile (which would soft-lock the second — a trigger only
  // fires on stepping ONTO a tile). Positions are seeded so a map lays out the
  // same choices every time. All floor is flood-fill-reachable by construction
  // (procgen validator), so no choice can be walled off.
  const interior = map.slots.filter((s) => s.role !== 'entry' && s.role !== 'exit');
  const positions = interior.slice();
  if (choicePoints.length > positions.length) {
    const used = new Set(positions.map((s) => s.x + ',' + s.y));
    used.add(map.entry.x + ',' + map.entry.y);
    used.add(map.exit.x + ',' + map.exit.y);
    const spare = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] === FLOOR && !used.has(x + ',' + y)) spare.push({ role: 'extra', x, y });
    }
    makeRng(`${map.seed}:${map.attempt}:cpslots`).shuffle(spare);
    while (positions.length < choicePoints.length && spare.length) positions.push(spare.pop());
  }
  const assignments = choicePoints.map((cp, i) => ({
    cp,
    slot: positions[i % positions.length],
    done: false,
  }));

  const player = { x: map.entry.x, y: map.entry.y };
  let stepCd = 0;
  let facing = [0, 1]; // for sprite orientation later; last non-zero move dir

  const walkable = (x, y) => x >= 0 && x < w && y >= 0 && y < h && tiles[y * w + x] === FLOOR;

  // The encounter slot's resident: the assignment whose slot IS the encounter
  // node hosts a hovering echo you approach to speak with (so the encounter node
  // is mechanically AND visibly distinct, not just another waypoint).
  const encounter = assignments.find((a) => a.slot && a.slot.role === 'encounter') || null;

  // Ambient echoes — fragments of the voice drifting through the space. PURELY
  // presentation (they gate nothing, touch no sim state), but they make the map
  // feel inhabited and, crucially, LEGIBLE: they steer toward a curious player
  // and shy from a guarded one, so "the voice learns you" is visible in the world
  // itself, not just in dialog. Seeded initial placement so a run is reproducible.
  const echoes = [];
  {
    const erng = makeRng(`${map.seed}:${map.attempt}:echoes`);
    const floors = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tiles[y * w + x] === FLOOR) floors.push([x, y]);
    for (let i = 0; i < N_ECHOES && floors.length; i++) {
      const [fx, fy] = erng.pick(floors);
      echoes.push({ x: fx + 0.5, y: fy + 0.5, phase: erng.float() * 6.283, sp: 0.6 + erng.float() * 0.5 });
    }
  }
  // Lost voices — the encounter-echo's quest. Stationary motes scattered on
  // floor tiles distinct from the choice positions/entry/exit. Walk onto one to
  // CARRY it (presentation, at risk); deliver at the encounter or exit to bank
  // it (authoritative). Seeded placement so a run's quest is reproducible.
  const collectibles = [];
  {
    const used = new Set(positions.map((s) => s.x + ',' + s.y));
    used.add(map.entry.x + ',' + map.entry.y); used.add(map.exit.x + ',' + map.exit.y);
    const spare = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] === FLOOR && !used.has(x + ',' + y)) spare.push({ x, y });
    }
    makeRng(`${map.seed}:${map.attempt}:echoquest`).shuffle(spare);
    for (let i = 0; i < echoCount && spare.length; i++) { const t = spare.pop(); collectibles.push({ x: t.x, y: t.y, taken: false, home: { x: t.x, y: t.y } }); }
  }
  let carried = 0;

  const floorList = () => {
    const floors = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tiles[y * w + x] === FLOOR) floors.push([x, y]);
    return floors;
  };

  const hasHunter = enemyKinds.includes('hunter');
  const hasWarden = enemyKinds.includes('warden');
  const hasScreamer = enemyKinds.includes('screamer');

  // The hunter — the hollow's reaching fragment. Detection/comfort predator
  // (Answering Deep kernel) + pursuit-ring leash: it wakes when you're near AND
  // not on a lit haven, chases, and settles if you break its leash or reach a
  // waypoint. A catch is a cheap setback (re-collect, re-navigate) — choices
  // already made and voices already delivered stay (waiting-city#E1:
  // attempt-based stakes are only fair when retry is cheap).
  const hunter = hasHunter ? (() => {
    const hrng = makeRng(`${map.seed}:${map.attempt}:hunter`);
    const floors = floorList();
    // Start as far from the entry as a sampled handful of floor tiles allows.
    let best = floors[0], bestD = -1;
    for (let i = 0; i < 24 && floors.length; i++) {
      const [fx, fy] = hrng.pick(floors);
      const d = Math.abs(fx - map.entry.x) + Math.abs(fy - map.entry.y);
      if (d > bestD) { bestD = d; best = [fx, fy]; }
    }
    return { x: best[0] + 0.5, y: best[1] + 0.5, state: 'wander', stun: 0, wander: null, rng: hrng };
  })() : null;

  // The warden — rooted near a seeded post, away from the entry/exit so it
  // can't ambush either. It only ever strays as far as its lunge, then heads
  // home.
  const warden = hasWarden ? (() => {
    const wrng = makeRng(`${map.seed}:${map.attempt}:warden`);
    const floors = floorList();
    let best = floors[0], bestD = -1;
    for (let i = 0; i < 24 && floors.length; i++) {
      const [fx, fy] = wrng.pick(floors);
      const d = Math.abs(fx - map.entry.x) + Math.abs(fy - map.entry.y) + Math.abs(fx - map.exit.x) + Math.abs(fy - map.exit.y);
      if (d > bestD) { bestD = d; best = [fx, fy]; }
    }
    const post = { x: best[0] + 0.5, y: best[1] + 0.5 };
    return { x: post.x, y: post.y, post, state: 'post', lungeMs: 0, stun: 0, rng: wrng };
  })() : null;

  // The screamer — starts somewhere central-ish and just wanders/senses; it
  // has no home to return to, it simply flees toward a new random tile
  // whenever it needs a new wander target, same rhythm as the hunter's wander.
  const screamer = hasScreamer ? (() => {
    const srng = makeRng(`${map.seed}:${map.attempt}:screamer`);
    const floors = floorList();
    const [fx, fy] = floors.length ? srng.pick(floors) : [map.entry.x, map.entry.y];
    return { x: fx + 0.5, y: fy + 0.5, wander: null, alertCd: 0, rng: srng };
  })() : null;

  // A "haven" is a lit waypoint (a choice slot or the encounter) — enemies
  // won't press you while you stand on one, which gives the map's glowing
  // points a real second purpose. Entry/exit count too. A held ward extends
  // this same protection to wherever you're standing, temporarily.
  const havens = new Set([
    map.entry.x + ',' + map.entry.y,
    map.exit.x + ',' + map.exit.y,
    ...assignments.map((a) => a.slot.x + ',' + a.slot.y),
  ]);
  let wardMs = 0;
  const onHaven = () => havens.has(player.x + ',' + player.y) || wardMs > 0;

  const allChoicesDone = () => assignments.every((a) => a.done);

  // After any step, see what the player is standing on. A pending choice fires
  // once (its assignment isn't marked done until the choice resolves, but we
  // guard re-entry with `resolving` so standing on the tile doesn't spam it).
  let resolving = false;
  function checkTriggers() {
    if (resolving) return;
    // Pick up a lost voice you're standing on (doesn't interrupt movement).
    for (const c of collectibles) {
      if (!c.taken && player.x === c.x && player.y === c.y) { c.taken = true; carried += 1; if (onGather) onGather(carried); }
    }
    for (const a of assignments) {
      if (!a.done && player.x === a.slot.x && player.y === a.slot.y) {
        resolving = true;
        onReachChoice(a);
        return;
      }
    }
    if (allChoicesDone() && player.x === map.exit.x && player.y === map.exit.y) onReachExit();
  }

  // Called by main when the choice UI closes: mark that assignment satisfied and
  // let exploration resume. The player is still standing on the slot, but `done`
  // now blocks re-trigger.
  function resolveChoice(a) { a.done = true; resolving = false; }

  // Drift the ambient echoes. `curiosity` in [-1,1] is the player's inquiry lean:
  // positive pulls them gently inward (a curious diver draws the voice close),
  // negative pushes them away. Cheap float integration, clamped to map bounds;
  // echoes are incorporeal so drifting over walls is fine (and eerie).
  function driftEchoes(dtMs, curiosity) {
    const s = dtMs * 0.001;
    for (const e of echoes) {
      e.phase += s * e.sp;
      let vx = Math.cos(e.phase) * 0.35, vy = Math.sin(e.phase * 0.7) * 0.35;
      const dx = player.x + 0.5 - e.x, dy = player.y + 0.5 - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const bias = Math.max(-1, Math.min(1, curiosity)) * (d > 2 ? 0.8 : -0.4); // approach at range, keep a little distance up close
      vx += (dx / d) * bias; vy += (dy / d) * bias;
      e.x = Math.max(0.5, Math.min(w - 0.5, e.x + vx * s));
      e.y = Math.max(0.5, Math.min(h - 0.5, e.y + vy * s));
    }
  }

  // Slide an entity one step toward (tx,ty), refusing to enter wall tiles so it
  // follows corridors (imperfectly — it loses you around corners, which is how
  // you escape). Axis-independent slide so it hugs walls instead of sticking.
  function moveToward(entity, tx, ty, step) {
    const dx = tx - entity.x, dy = ty - entity.y, d = Math.hypot(dx, dy) || 1;
    const nx = entity.x + (dx / d) * step, ny = entity.y + (dy / d) * step;
    if (walkable(Math.floor(nx), Math.floor(entity.y))) entity.x = nx;
    if (walkable(Math.floor(entity.x), Math.floor(ny))) entity.y = ny;
  }

  function updateHunter(dtMs) {
    const dts = dtMs * 0.001;
    if (hunter.stun > 0) { hunter.stun -= dtMs; return; }
    const px = player.x + 0.5, py = player.y + 0.5;
    const dist = Math.hypot(hunter.x - px, hunter.y - py);
    const safe = onHaven();

    if (hunter.state === 'hunt') {
      if (safe || dist > LEASH_R) hunter.state = 'wander';
    } else if (!safe && dist < SENSE_R) {
      hunter.state = 'hunt';
    }

    if (hunter.state === 'hunt') {
      moveToward(hunter, px, py, HUNT_SPD * dts);
      if (dist < CATCH_R) {
        // Caught: drop everything you carry back onto the map, go back to the
        // entry, and the hunter recoils. Delivered voices and made choices stay.
        scatter(); player.x = map.entry.x; player.y = map.entry.y; stepCd = 0;
        hunter.stun = STUN_MS;
        // recoil to a far tile so it isn't sitting on the entry when you respawn
        hunter.x = map.exit.x + 0.5; hunter.y = map.exit.y + 0.5; hunter.state = 'wander';
        if (onCaught) onCaught();
      }
    } else {
      // Wander toward a slowly-refreshed drift target (a random floor tile).
      if (!hunter.wander || Math.hypot(hunter.x - hunter.wander.x, hunter.y - hunter.wander.y) < 1) {
        let tx = hunter.x, ty = hunter.y;
        for (let i = 0; i < 8; i++) { const gx = hunter.rng.int(0, w - 1), gy = hunter.rng.int(0, h - 1); if (tiles[gy * w + gx] === FLOOR) { tx = gx + 0.5; ty = gy + 0.5; break; } }
        hunter.wander = { x: tx, y: ty };
      }
      moveToward(hunter, hunter.wander.x, hunter.wander.y, WANDER_SPD * dts);
    }
  }

  // The warden: sleeps at its post until you cross its short wake radius, then
  // lunges — a bounded burst, never a sustained chase. It gives up and heads
  // home once the lunge times out OR it catches you, so the punishment for
  // getting close is routing around it, not losing ground on the whole floor.
  function updateWarden(dtMs) {
    const dts = dtMs * 0.001;
    if (warden.stun > 0) { warden.stun -= dtMs; return; }
    const px = player.x + 0.5, py = player.y + 0.5;
    const dist = Math.hypot(warden.x - px, warden.y - py);
    const safe = onHaven();

    if (warden.state === 'post' && !safe && dist < WARDEN_WAKE_R) {
      warden.state = 'lunge'; warden.lungeMs = 0;
    }

    if (warden.state === 'lunge') {
      warden.lungeMs += dtMs;
      moveToward(warden, px, py, WARDEN_LUNGE_SPD * dts);
      if (dist < WARDEN_CATCH_R) {
        // A physical shove, not an economic loss: knock the player back away
        // from the warden and stun them a moment, but carried voices and made
        // choices are untouched — a different KIND of punishment than the
        // hunter's, not just a smaller number.
        const dx = px - warden.x, dy = py - warden.y, d = Math.hypot(dx, dy) || 1;
        let nx = player.x, ny = player.y;
        for (let i = 1; i <= WARDEN_KNOCKBACK_TILES; i++) {
          const tx = Math.round(player.x + (dx / d) * i), ty = Math.round(player.y + (dy / d) * i);
          if (walkable(tx, ty)) { nx = tx; ny = ty; } else break;
        }
        player.x = nx; player.y = ny; stepCd = WARDEN_STUN_MS;
        warden.stun = WARDEN_STUN_MS;
        warden.state = 'return';
        if (onCaught) onCaught();
      } else if (warden.lungeMs > WARDEN_LUNGE_MS) {
        warden.state = 'return';
      }
    } else if (warden.state === 'return') {
      moveToward(warden, warden.post.x, warden.post.y, WARDEN_RETURN_SPD * dts);
      if (Math.hypot(warden.x - warden.post.x, warden.y - warden.post.y) < 0.3) warden.state = 'post';
    }
  }

  // The screamer: wanders, never touches you. If it senses you, it forces the
  // HUNTER into hunt state (if the hunter exists on this floor) and flees
  // toward a fresh wander target — coupling the two systems instead of adding
  // a third flavor of "chases and catches you".
  function updateScreamer(dtMs) {
    const dts = dtMs * 0.001;
    if (screamer.alertCd > 0) screamer.alertCd -= dtMs;
    const px = player.x + 0.5, py = player.y + 0.5;
    const dist = Math.hypot(screamer.x - px, screamer.y - py);
    if (dist < SCREAMER_SENSE_R && screamer.alertCd <= 0) {
      screamer.alertCd = SCREAMER_ALERT_COOLDOWN_MS;
      if (hunter) hunter.state = 'hunt';
      screamer.wander = null; // force a fresh flee target
    }
    if (!screamer.wander || Math.hypot(screamer.x - screamer.wander.x, screamer.y - screamer.wander.y) < 1) {
      let tx = screamer.x, ty = screamer.y;
      for (let i = 0; i < 8; i++) { const gx = screamer.rng.int(0, w - 1), gy = screamer.rng.int(0, h - 1); if (tiles[gy * w + gx] === FLOOR) { tx = gx + 0.5; ty = gy + 0.5; break; } }
      screamer.wander = { x: tx, y: ty };
    }
    moveToward(screamer, screamer.wander.x, screamer.wander.y, SCREAMER_SPD * dts);
  }

  // Drop all carried voices back at their homes (shared by the catch and the
  // public scatterCarried) — ONE reset path (test#E8).
  function scatter() { if (carried > 0) { for (const c of collectibles) if (c.taken) c.taken = false; carried = 0; } }

  // --- abilities: cooldown state + effects, all presentation-only -----------
  let pulseCd = 0, dashCd = 0;
  let lastPulse = null; // { x, y, ms } cosmetic ring for renderExplore, or null

  function nearbyEnemies() {
    const list = [];
    if (hunter) list.push(hunter);
    if (warden) list.push(warden);
    if (screamer) list.push(screamer);
    return list;
  }

  function usePulse() {
    if (!abilities.pulse || pulseCd > 0) return false;
    pulseCd = PULSE_COOLDOWN_MS;
    const px = player.x + 0.5, py = player.y + 0.5;
    for (const e of nearbyEnemies()) {
      if (Math.hypot(e.x - px, e.y - py) <= PULSE_RADIUS && 'stun' in e) e.stun = Math.max(e.stun || 0, PULSE_STUN_MS);
      if (e === screamer && Math.hypot(e.x - px, e.y - py) <= PULSE_RADIUS) screamer.alertCd = Math.max(screamer.alertCd, PULSE_STUN_MS);
    }
    lastPulse = { x: player.x + 0.5, y: player.y + 0.5, ms: 0 };
    return true;
  }

  function useDash() {
    if (!abilities.dash || dashCd > 0) return false;
    const [fx, fy] = facing;
    if (!fx && !fy) return false;
    dashCd = DASH_COOLDOWN_MS;
    let nx = player.x, ny = player.y;
    for (let i = 1; i <= DASH_TILES; i++) {
      const tx = player.x + fx * i, ty = player.y + fy * i;
      if (walkable(tx, ty)) { nx = tx; ny = ty; } else break;
    }
    if (nx !== player.x || ny !== player.y) { player.x = nx; player.y = ny; checkTriggers(); }
    return true;
  }

  let wardCd = 0;
  function useWard() {
    if (!abilities.ward || wardCd > 0) return false;
    wardCd = WARD_COOLDOWN_MS;
    wardMs = WARD_DURATION_MS;
    return true;
  }

  // One frame of exploration. moveVec is the held direction from the unified
  // input layer (already reduced to -1/0/1 per axis). We step at most one tile
  // per STEP_MS so holding a direction walks smoothly without teleporting, and
  // prefer the horizontal axis then vertical for diagonal input (grid-clean).
  function update(moveVec, dtMs, curiosity = 0) {
    driftEchoes(dtMs, curiosity); // ambient life continues even mid-step-cooldown
    if (hunter) updateHunter(dtMs);
    if (warden) updateWarden(dtMs);
    if (screamer) updateScreamer(dtMs);
    if (pulseCd > 0) pulseCd = Math.max(0, pulseCd - dtMs);
    if (dashCd > 0) dashCd = Math.max(0, dashCd - dtMs);
    if (wardCd > 0) wardCd = Math.max(0, wardCd - dtMs);
    if (wardMs > 0) wardMs = Math.max(0, wardMs - dtMs);
    if (lastPulse) { lastPulse.ms += dtMs; if (lastPulse.ms > 500) lastPulse = null; }
    if (resolving) return;
    stepCd -= dtMs;
    const [mx, my] = moveVec;
    if ((mx || my) && (mx || my) !== 0) { facing = [mx || facing[0], my || facing[1]]; }
    if (stepCd > 0 || (!mx && !my)) return;

    let moved = false;
    if (mx && walkable(player.x + mx, player.y)) { player.x += mx; moved = true; }
    else if (my && walkable(player.x, player.y + my)) { player.y += my; moved = true; }
    if (moved) { stepCd = STEP_MS; checkTriggers(); }
  }

  return {
    update,
    resolveChoice,
    map,
    assignments,
    player: () => player,
    facing: () => facing,
    echoes: () => echoes,
    encounter: () => encounter,
    remaining: () => assignments.filter((a) => !a.done).length,
    atExitReady: () => allChoicesDone(),
    isWalkable: walkable,
    // The lost-voices quest.
    collectibles: () => collectibles,
    carried: () => carried,
    takeCarried: () => { const n = carried; carried = 0; return n; }, // deliver: hand off carried to be banked
    // Enemies (any may be null if not present on this floor).
    hunter: () => hunter,
    warden: () => warden,
    screamer: () => screamer,
    inDanger: () => !!(hunter && hunter.state === 'hunt') || !!(warden && warden.state === 'lunge'),
    scatterCarried: scatter,
    respawnToEntry: () => { player.x = map.entry.x; player.y = map.entry.y; stepCd = 0; resolving = false; },
    // Abilities.
    usePulse, useDash, useWard,
    abilityState: () => ({ pulseCd, dashCd, wardCd, wardMs, lastPulse }),
    onWard: () => wardMs > 0,
  };
}
