// "The learning" as an actually-walked space, not three menus over a dim
// backdrop. The player moves tile-by-tile through the procgen map; reaching a
// choice-point's assigned slot opens that choice; once every choice is made,
// reaching the exit ends the stage.
//
// DELIBERATELY presentation-only. Movement never touches the sim — the ONLY
// authoritative event the learning stage produces is CHOOSE_OPTION (fired by
// main when a choice resolves) and ADVANCE_SPINE. The sim doesn't care HOW you
// walked to a slot, only which option you picked and in what order, so the
// golden fingerprint and the scripted-spine test stay valid no matter the path
// (the sim/presentation split — discrete authoritative facts vs continuous
// cosmetic detail). The map itself is a pure function of world.seed, so this
// whole space is reproducible without storing a single tile in the save.

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

export function createExplore(map, choicePoints, { onReachChoice, onReachExit, onGather, onCaught, echoCount = 0 }) {
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

  // The hunter — the hollow's reaching fragment. PRESENTATION ONLY: its only
  // consequence is to presentation state (scatter what you carry, send you back),
  // so the authoritative/fingerprinted core is untouched no matter what it does.
  // Detection/comfort predator (Answering Deep kernel) + pursuit-ring leash: it
  // wakes when you're near AND not on a lit haven, chases, and settles if you
  // break its leash or reach a waypoint. A catch is a cheap setback (re-collect,
  // re-navigate) — choices already made and voices already delivered stay
  // (waiting-city#E1: attempt-based stakes are only fair when retry is cheap).
  const hunter = (() => {
    const hrng = makeRng(`${map.seed}:${map.attempt}:hunter`);
    const floors = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (tiles[y * w + x] === FLOOR) floors.push([x, y]);
    // Start as far from the entry as a sampled handful of floor tiles allows.
    let best = floors[0], bestD = -1;
    for (let i = 0; i < 24 && floors.length; i++) {
      const [fx, fy] = hrng.pick(floors);
      const d = Math.abs(fx - map.entry.x) + Math.abs(fy - map.entry.y);
      if (d > bestD) { bestD = d; best = [fx, fy]; }
    }
    return { x: best[0] + 0.5, y: best[1] + 0.5, state: 'wander', stun: 0, wander: null, rng: hrng };
  })();

  // A "haven" is a lit waypoint (a choice slot or the encounter) — the hunter
  // won't press you while you stand on one, which gives the map's glowing points
  // a real second purpose. Entry/exit count too.
  const havens = new Set([
    map.entry.x + ',' + map.entry.y,
    map.exit.x + ',' + map.exit.y,
    ...assignments.map((a) => a.slot.x + ',' + a.slot.y),
  ]);
  const onHaven = () => havens.has(player.x + ',' + player.y);

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

  // One frame of exploration. moveVec is the held direction from the unified
  // input layer (already reduced to -1/0/1 per axis). We step at most one tile
  // per STEP_MS so holding a direction walks smoothly without teleporting, and
  // prefer the horizontal axis then vertical for diagonal input (grid-clean).
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

  // Slide the hunter one step toward (tx,ty), refusing to enter wall tiles so it
  // follows corridors (imperfectly — it loses you around corners, which is how
  // you escape). Axis-independent slide so it hugs walls instead of sticking.
  function moveHunterToward(tx, ty, step) {
    const dx = tx - hunter.x, dy = ty - hunter.y, d = Math.hypot(dx, dy) || 1;
    const nx = hunter.x + (dx / d) * step, ny = hunter.y + (dy / d) * step;
    if (walkable(Math.floor(nx), Math.floor(hunter.y))) hunter.x = nx;
    if (walkable(Math.floor(hunter.x), Math.floor(ny))) hunter.y = ny;
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
      moveHunterToward(px, py, HUNT_SPD * dts);
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
      moveHunterToward(hunter.wander.x, hunter.wander.y, WANDER_SPD * dts);
    }
  }

  // Drop all carried voices back at their homes (shared by the catch and the
  // public scatterCarried) — ONE reset path (test#E8).
  function scatter() { if (carried > 0) { for (const c of collectibles) if (c.taken) c.taken = false; carried = 0; } }

  function update(moveVec, dtMs, curiosity = 0) {
    driftEchoes(dtMs, curiosity); // ambient life continues even mid-step-cooldown
    updateHunter(dtMs);
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
    // The hunter.
    hunter: () => hunter,
    inDanger: () => hunter.state === 'hunt',
    scatterCarried: scatter,
    respawnToEntry: () => { player.x = map.entry.x; player.y = map.entry.y; stepCd = 0; resolving = false; },
  };
}
