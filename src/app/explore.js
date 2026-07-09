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

const STEP_MS = 108; // grid-step cadence while a direction is held

export function createExplore(map, choicePoints, { onReachChoice, onReachExit }) {
  const { w, h, tiles } = map.grid;

  // Assign each choice point to a distinct interior slot (never entry/exit), in
  // a fixed order so the layout is deterministic for a given map. With the
  // default spec there are more interior slots than choice points, so each gets
  // its own; the modulo is just a safety net if that ever inverts.
  const interior = map.slots.filter((s) => s.role !== 'entry' && s.role !== 'exit');
  const assignments = choicePoints.map((cp, i) => ({
    cp,
    slot: interior[i % interior.length],
    done: false,
  }));

  const player = { x: map.entry.x, y: map.entry.y };
  let stepCd = 0;
  let facing = [0, 1]; // for sprite orientation later; last non-zero move dir

  const walkable = (x, y) => x >= 0 && x < w && y >= 0 && y < h && tiles[y * w + x] === FLOOR;
  const allChoicesDone = () => assignments.every((a) => a.done);

  // After any step, see what the player is standing on. A pending choice fires
  // once (its assignment isn't marked done until the choice resolves, but we
  // guard re-entry with `resolving` so standing on the tile doesn't spam it).
  let resolving = false;
  function checkTriggers() {
    if (resolving) return;
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
  function update(moveVec, dtMs) {
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
    remaining: () => assignments.filter((a) => !a.done).length,
    atExitReady: () => allChoicesDone(),
    isWalkable: walkable,
  };
}
