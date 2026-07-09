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

export function createExplore(map, choicePoints, { onReachChoice, onReachExit, onGather, echoCount = 0 }) {
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

  function update(moveVec, dtMs, curiosity = 0) {
    driftEchoes(dtMs, curiosity); // ambient life continues even mid-step-cooldown
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
    // The hunter's stakes (P16): drop everything you're carrying back onto the
    // map at the voices' home tiles, and send the diver back to the entry.
    scatterCarried: () => {
      if (carried > 0) { for (const c of collectibles) if (c.taken) c.taken = false; carried = 0; }
    },
    respawnToEntry: () => { player.x = map.entry.x; player.y = map.entry.y; stepCd = 0; resolving = false; },
  };
}
