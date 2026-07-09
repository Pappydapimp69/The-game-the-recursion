// The authoritative gate on GENERATED maps — the same validation-ladder pattern
// validate.js applies to hand-authored content (test#E1), extended to gen output:
// pure functions returning string[] of problems (empty = pass). The generator is
// untrusted; THIS is the authority. A map that fails here is rejected and
// re-rolled (procgen.js), never shipped.
//
// Ladder, in order (research §3):
//   0. schema     — the tile grid + rooms + edges are shape-well-formed
//   1. slots      — every required node type actually got a reachable slot placed
//   2. reachability — flood-fill the ACTUAL carved tiles from entry, confirm the
//                     exit and EVERY required slot is reached (MST-connected graph
//                     != connected tiles once prefab walls land)
//   3. lock/key   — the key node precedes its gate in mission-graph order

import { FLOOR, requiredTypes } from './procgen.js';

export function validateMap(map, spec) {
  const problems = [];
  if (!map || typeof map !== 'object') return ['map: not an object'];

  const grid = map.grid;
  if (!grid || !Array.isArray(grid.tiles)) return ['map.grid: missing tiles array'];
  const { w, h, tiles } = grid;

  // --- 0. schema ------------------------------------------------------------
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    problems.push(`grid: bad dimensions ${w}x${h}`);
  }
  if (tiles.length !== w * h) {
    problems.push(`grid: tiles length ${tiles.length} != ${w}*${h}`);
  }
  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] !== 0 && tiles[i] !== 1) { problems.push(`grid: tile ${i} out of range (${tiles[i]})`); break; }
  }
  const roomIds = new Set();
  for (const r of map.rooms || []) {
    roomIds.add(r.id);
    if (r.x < 0 || r.y < 0 || r.x + r.w > w || r.y + r.h > h) {
      problems.push(`room ${r.id}: out of grid bounds`);
    }
  }
  for (const e of (map.graph && map.graph.edges) || []) {
    if (!roomIds.has(e.a) || !roomIds.has(e.b)) problems.push(`edge ${e.a}->${e.b}: references a missing room`);
  }
  if (!map.entry || !map.exit) problems.push('map: missing entry and/or exit anchor');
  // A structural failure makes reachability meaningless — stop here.
  if (problems.length) return problems;

  // --- 1. required slots placed --------------------------------------------
  const need = requiredTypes(spec);
  const bySlotRole = {};
  for (const s of map.slots) bySlotRole[s.role] = (bySlotRole[s.role] || 0) + 1;
  for (const type of need) {
    if (!bySlotRole[type]) problems.push(`required slot for '${type}' was not placed`);
  }

  // --- 2. flood-fill reachability on the carved tiles ----------------------
  const inb = (x, y) => x >= 0 && x < w && y >= 0 && y < h;
  const walk = (x, y) => inb(x, y) && tiles[y * w + x] === FLOOR;
  const reached = new Uint8Array(w * h);
  const { x: ex, y: ey } = map.entry;
  if (!walk(ex, ey)) {
    problems.push('entry tile is not walkable');
  } else {
    const stack = [[ex, ey]];
    reached[ey * w + ex] = 1;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (walk(nx, ny) && !reached[ny * w + nx]) { reached[ny * w + nx] = 1; stack.push([nx, ny]); }
      }
    }
    const isReached = (p, label) => {
      if (!reached[p.y * w + p.x]) problems.push(`${label} at (${p.x},${p.y}) is unreachable from entry`);
    };
    isReached(map.exit, 'exit');
    // Every required slot's own tile must be in the reached set — not just its
    // room, the actual anchor cell a quest target would spawn on.
    for (const s of map.slots) {
      if (need.includes(s.role)) isReached(s, `slot '${s.role}'`);
    }
  }

  // --- 3. lock/key ordering on the mission graph ---------------------------
  const nodes = (map.graph && map.graph.nodes) || [];
  const keyIdx = nodes.findIndex((nd) => nd.type === 'key');
  const gateIdx = nodes.findIndex((nd) => nd.type === 'gate');
  if (keyIdx >= 0 && gateIdx >= 0 && keyIdx > gateIdx) {
    problems.push('lock/key: key node comes AFTER its gate in mission order');
  }

  return problems;
}

// Assert helper mirroring validate.js's assertValid, for the smoke harness.
export function assertValidMap(label, map, spec) {
  const problems = validateMap(map, spec);
  if (problems.length) {
    throw new Error(`${label} failed map validation:\n  - ${problems.join('\n  - ')}`);
  }
}
