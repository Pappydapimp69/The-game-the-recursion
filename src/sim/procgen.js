// Procedural map generation — authored feel, completable by construction. A PURE
// function gen(seed, genVersion, missionSpec) -> map: identical inputs always
// yield byte-identical output. Every roll draws from the ONE seeded RNG via
// makeRng/subStream keyed off the passed seed — never Math.random/Date.now, or
// save/replay and the seed suite break (prologue#E1, wrong-sky#E2).
//
// Layered hybrid, not one algorithm (research §2): mission-graph grammar first
// (the authored intent + lock/key order), THEN deterministic room packing + MST
// connection, THEN prefab-template fill. The generator is untrusted; the
// validator (procgen-validate.js) is the authority — see gen()'s reject-and-retry.

import { seedState, subStream } from './rng.js';
import { validateMap } from './procgen-validate.js';

export const GEN_VERSION = 1;

// Tile vocabulary. Kept to two values — the reachability flood-fill only cares
// walkable-vs-not; décor/biome is a later cosmetic pass on top of this.
export const WALL = 0;
export const FLOOR = 1;

// The default mission spine. missionSpec is deliberately abstract — a sequence of
// required node types — because quest CONTENT doesn't exist yet (a later pass).
// Our job is the map + graph skeleton + validated slots, not quest text.
export const DEFAULT_SPEC = ['entry', 'key', 'gate', 'encounter', 'reward', 'exit'];

// Node types that reserve a required, must-be-reachable slot. 'filler' is
// connective tissue the grammar may add and carries no required slot.
const REQUIRED_TYPES = new Set(['entry', 'key', 'gate', 'encounter', 'reward', 'exit']);

// --- Prefab templates: the authored feel (research §5.1). A small weighted pool
// per node type; '#' wall, '.' floor, '*' the single slot anchor (also floor).
// The node's type IS the slot's role, so one marker suffices. Add templates here
// to widen variety without touching the pipeline. -----------------------------
const TEMPLATES = [
  { id: 'entry-a', type: 'entry', weight: 2, rows: ['#######', '#.....#', '#..*..#', '#.....#', '#######'] },
  { id: 'entry-b', type: 'entry', weight: 1, rows: ['#####', '#...#', '#.*.#', '#...#', '#####'] },

  { id: 'key-a', type: 'key', weight: 2, rows: ['#####', '#.*.#', '#...#', '#####'] },
  { id: 'key-b', type: 'key', weight: 1, rows: ['#######', '#.....#', '#..*..#', '#######'] },

  { id: 'gate-a', type: 'gate', weight: 2, rows: ['#######', '#..*..#', '#.....#', '#######'] },
  { id: 'gate-b', type: 'gate', weight: 1, rows: ['#####', '#...#', '#.*.#', '#...#', '#####'] },

  { id: 'enc-a', type: 'encounter', weight: 2, rows: ['#########', '#.......#', '#...*...#', '#.......#', '#########'] },
  { id: 'enc-b', type: 'encounter', weight: 1, rows: ['#######', '#.....#', '#..*..#', '#.....#', '#.....#', '#######'] },

  { id: 'reward-a', type: 'reward', weight: 2, rows: ['#####', '#...#', '#.*.#', '#...#', '#####'] },
  { id: 'reward-b', type: 'reward', weight: 1, rows: ['#######', '#..*..#', '#.....#', '#######'] },

  { id: 'exit-a', type: 'exit', weight: 2, rows: ['#######', '#.....#', '#..*..#', '#.....#', '#######'] },
  { id: 'exit-b', type: 'exit', weight: 1, rows: ['#####', '#...#', '#.*.#', '#...#', '#####'] },

  { id: 'filler-a', type: 'filler', weight: 2, rows: ['#####', '#...#', '#...#', '#####'] },
  { id: 'filler-b', type: 'filler', weight: 1, rows: ['######', '#....#', '#....#', '######'] },
];

// --- Mission-graph grammar (research §1, Dormans). Rewrite rules expand the
// required spine into a node sequence. Each RHS REPLACES its node but always
// re-contains the original required type, so required slots can never be rewritten
// away — completability stays structural. Keyed by type so new rules/types slot
// in without touching the walker. -------------------------------------------
const REWRITES = {
  // Tension can build before the lock and around the payoff; filler is optional
  // connective tissue that gives the map non-trivial length without new slots.
  encounter: [['encounter'], ['encounter', 'filler'], ['filler', 'encounter']],
  gate: [['gate'], ['gate', 'filler']],
  reward: [['filler', 'reward'], ['reward']],
};

function buildMissionGraph(seed, genVersion, spec) {
  // Grammar seed is FIXED across layout retries — the spine is valid by
  // construction, so only geometry re-rolls on a validation miss.
  const rng = subStream(seedState(`${genVersion}:${seed}`), 'grammar');

  // One rewrite pass over the axiom. entry/exit are terminals (never rewritten)
  // so the spine's endpoints stay pinned.
  const out = [];
  for (const type of spec) {
    const rule = REWRITES[type];
    if (!rule || type === 'entry' || type === 'exit') { out.push(type); continue; }
    for (const t of rng.pick(rule)) out.push(t);
  }

  const nodes = out.map((type, i) => ({ id: `n${i}`, type, roomId: `n${i}` }));
  // Chain edges follow mission order — this is what makes the key node precede
  // its gate in traversal order (validated on the graph, then on the tiles).
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) edges.push({ a: nodes[i].id, b: nodes[i + 1].id, loop: false });
  return { nodes, edges };
}

// Weighted template pick for a node type. Deterministic: cumulative-weight roll
// over the pool filtered by type, iterated in stable array order.
function pickTemplate(rng, type) {
  const pool = TEMPLATES.filter((t) => t.type === type);
  const total = pool.reduce((s, t) => s + t.weight, 0);
  let r = rng.int(1, total);
  for (const t of pool) { r -= t.weight; if (r <= 0) return t; }
  return pool[pool.length - 1];
}

const tW = (t) => t.rows[0].length;
const tH = (t) => t.rows.length;

// --- MST + ~15% extra edges (research §2, TinyKeep). We DEVIATE from full
// Delaunay: at this room count a Delaunay triangulation is overkill, so we build
// the MST over the complete graph (all-pairs, Euclidean) via Kruskal, then re-add
// the shortest ~15% of the remaining candidate edges as loops/shortcuts. Purely
// geometric and deterministic — no RNG draw — so it never perturbs the streams. -
function connectRooms(rooms) {
  const n = rooms.length;
  const cand = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = rooms[i].cx - rooms[j].cx, dy = rooms[i].cy - rooms[j].cy;
      cand.push({ a: i, b: j, d: dx * dx + dy * dy });
    }
  }
  // Tie-break on indices so equal distances resolve identically every run.
  cand.sort((p, q) => p.d - q.d || p.a - q.a || p.b - q.b);

  const parent = rooms.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const mst = [], extra = [];
  for (const e of cand) {
    const ra = find(e.a), rb = find(e.b);
    if (ra !== rb) { parent[ra] = rb; mst.push(e); } else { extra.push(e); }
  }
  const loops = extra.slice(0, Math.ceil(extra.length * 0.15));
  return [...mst.map((e) => ({ ...e, loop: false })), ...loops.map((e) => ({ ...e, loop: true }))];
}

// Carve a floor cell (grid is a flat 0/1 array; corridors turn wall into door).
function carve(grid, w, h, x, y) {
  if (x >= 0 && x < w && y >= 0 && y < h) grid[y * w + x] = FLOOR;
}

// Build the tile map + rooms for one attempt. Layout re-rolls per attempt
// (via attemptWords); grammar does not.
function assembleMap(graph, attemptWords, genVersion, seed, attempt) {
  const fillRng = subStream(attemptWords, 'fill');
  const layoutRng = subStream(attemptWords, 'layout');

  // Pick a template per node FIRST — room dimensions come from the template, so
  // packing never has to fit a slot into a too-small rect.
  const placed = graph.nodes.map((node) => ({ node, tmpl: pickTemplate(fillRng, node.type) }));

  // Deterministic room packing: grid-of-slots, each node in its own cell with a
  // gap, so rooms can NEVER overlap (overlap could wall off a slot). Shuffling
  // the node->slot assignment is what makes different seeds lay out differently;
  // full physics-separation (TinyKeep) is the reproducibility risk we replaced.
  const n = placed.length;
  const cols = Math.ceil(Math.sqrt(n));
  const cellW = Math.max(...TEMPLATES.map(tW)) + 3; // +gap for corridors
  const cellH = Math.max(...TEMPLATES.map(tH)) + 3;
  const rows = Math.ceil(n / cols);

  const slotOrder = layoutRng.shuffle(placed.map((_, i) => i));

  const rooms = [];
  for (let i = 0; i < n; i++) {
    const p = placed[slotOrder[i]];
    const col = i % cols, row = (i / cols) | 0;
    const w = tW(p.tmpl), h = tH(p.tmpl);
    // Small seeded jitter inside the cell's slack — variety without overlap.
    const slackX = cellW - w - 1, slackY = cellH - h - 1;
    const jx = slackX > 0 ? layoutRng.int(0, slackX) : 0;
    const jy = slackY > 0 ? layoutRng.int(0, slackY) : 0;
    const x = col * cellW + 1 + jx;
    const y = row * cellH + 1 + jy;
    rooms.push({
      id: p.node.id, type: p.node.type, templateId: p.tmpl.id,
      x, y, w, h, tmpl: p.tmpl,
      cx: x + (w >> 1), cy: y + (h >> 1),
    });
  }
  const byId = {};
  for (const r of rooms) byId[r.id] = r;

  const gridW = cols * cellW + 1;
  const gridH = rows * cellH + 1;
  const tiles = new Array(gridW * gridH).fill(WALL);

  // Blit each template; record its slot anchor. The node's type is the role.
  const slots = [];
  let entry = null, exit = null;
  for (const r of rooms) {
    for (let ly = 0; ly < r.h; ly++) {
      const line = r.tmpl.rows[ly];
      for (let lx = 0; lx < r.w; lx++) {
        const ch = line[lx];
        if (ch === '#') continue;
        const gx = r.x + lx, gy = r.y + ly;
        tiles[gy * gridW + gx] = FLOOR;
        if (ch === '*') {
          const slot = { role: r.type, x: gx, y: gy, roomId: r.id };
          slots.push(slot);
          if (r.type === 'entry') entry = { x: gx, y: gy };
          if (r.type === 'exit') exit = { x: gx, y: gy };
        }
      }
    }
  }

  // Carve L-corridors between connected room centers. This is what turns an
  // MST-connected GRAPH into connected TILES — the guarantee the graph alone
  // can't make once prefab walls land (research §3, the core reason to flood-fill).
  const edges = connectRooms(rooms);
  for (const e of edges) {
    const A = rooms[e.a], B = rooms[e.b];
    const x0 = Math.min(A.cx, B.cx), x1 = Math.max(A.cx, B.cx);
    for (let x = x0; x <= x1; x++) carve(tiles, gridW, gridH, x, A.cy);
    const y0 = Math.min(A.cy, B.cy), y1 = Math.max(A.cy, B.cy);
    for (let y = y0; y <= y1; y++) carve(tiles, gridW, gridH, B.cx, y);
  }

  // Graph edges rewritten to room-id form for the returned map (mission-order
  // chain + geometric loops both preserved).
  const mapEdges = edges.map((e) => ({ a: rooms[e.a].id, b: rooms[e.b].id, loop: !!e.loop }));

  return {
    genVersion, seed, attempt,
    graph: { nodes: graph.nodes.map((nd) => ({ id: nd.id, type: nd.type, roomId: nd.roomId })), edges: mapEdges },
    rooms: rooms.map((r) => ({ id: r.id, type: r.type, templateId: r.templateId, x: r.x, y: r.y, w: r.w, h: r.h })),
    grid: { w: gridW, h: gridH, tiles },
    slots,
    entry, exit,
  };
}

// Bounded, SEED-STABLE retry (research §4). A validation miss re-rolls geometry
// from hash(seed, genVersion, attempt) — never wall-clock — so the same save
// always lands on the same map, and a "bad seed" stays reproducible/regression-
// testable. The grammar spine is valid by construction, so attempt 0 should
// virtually always pass; exhausting the cap means a real generator bug, surfaced
// loudly rather than papered over by weakening the validator.
const MAX_ATTEMPTS = 8;

export function gen(seed = 'recursion', genVersion = GEN_VERSION, missionSpec = DEFAULT_SPEC) {
  const spec = Array.isArray(missionSpec) && missionSpec.length ? missionSpec.slice() : DEFAULT_SPEC.slice();
  const graph = buildMissionGraph(seed, genVersion, spec);

  let lastProblems = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const attemptWords = seedState(`${genVersion}:${seed}:attempt:${attempt}`);
    const map = assembleMap(graph, attemptWords, genVersion, seed, attempt);
    lastProblems = validateMap(map, spec);
    if (lastProblems.length === 0) return map;
  }
  throw new Error(`procgen: seed ${seed} failed validation after ${MAX_ATTEMPTS} attempts:\n  - ${lastProblems.join('\n  - ')}`);
}

// The required node types for a spec — what the validator must find placed. Kept
// here so the validator and generator agree on one definition.
export function requiredTypes(spec) {
  return spec.filter((t) => REQUIRED_TYPES.has(t));
}
