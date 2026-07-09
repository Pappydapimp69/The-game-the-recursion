// A fixed scripted playthrough used by the smoke test as the determinism +
// regression guard. Runs the same commands twice from one seed; the end-state
// fingerprints must match (catches any leaked ambient randomness) and equal the
// golden (catches unintended logic/content changes).
// Precedent: ideas replay-fingerprint/determinism-regression-guard.

import { makeWorld } from './world.js';
import { reduce } from './reduce.js';

// A deterministic command sequence exercising the P0 seams: movement, ticks,
// the trait fold, a facet restore, and the ending. Grows as passes land.
export function demoScript() {
  const cmds = [];
  const move = (dx, dy) => cmds.push({ type: 'MOVE', dx, dy });
  const tick = () => cmds.push({ type: 'TICK' });
  const trait = (axis, weight) => cmds.push({ type: 'RECORD_TRAIT_SIGNAL', axis, weight });

  move(1, 0); move(1, 0); tick();
  trait('resolve', 1); trait('resolve', 1); trait('mercy', -1);
  move(0, 1); tick();
  trait('inquiry', 1); trait('mercy', 1);
  move(1, 1); move(-1, 0); tick();
  cmds.push({ type: 'RESTORE_FACET', facet: 'light' });
  trait('candor', 1); trait('attachment', -1);
  cmds.push({ type: 'END', choice: 'reflect' });
  return cmds;
}

// Run the script from a fixed seed and return the finished world.
export function runDemo(seed = 'recursion-smoke') {
  const world = makeWorld(seed);
  for (const cmd of demoScript()) reduce(world, cmd);
  return world;
}
