// The procedural PIXEL-ART generator: sprites and tiles, all seeded so the same
// seed always paints the same world (seed-reproducible procgen is a core project
// value — see sim/rng.js). Every color here indexes PALETTE and shades by ±1
// along a ramp; nothing computes raw RGB, so generated art and hand-placed pixels
// read as one world (the palette-constraint from app/palette.js). No ImageData:
// each pixel is a filled rect on a small offscreen cache, blitted scaled by the
// caller — chunky pixels stay crisp at any integer-ish display size.
// Technique: mask-and-mirror creatures (Bollinger / zfedoran pixelspaceships),
// speckled-stone tiles. Silhouettes are hand-authored (readable), rng fills only
// the detail cells and the tile speckle (variation without noise).

import { PALETTE, shade } from './palette.js';
import { makeRng } from '../sim/rng.js';

// Half-grid cell markup: '.' always-empty, '#' always-body, '?' rng body-or-empty.
// Only the left half is authored; it is mirrored for bilateral symmetry, so a
// centre-column gap ('..' at the right edge of a row) becomes a real split (legs,
// hollow eyes) after mirroring. Border pixels are NOT authored — an edge pass
// derives them, so every silhouette gets a clean darkest-shade outline for free.

// The diver — you. A helmeted front-facing humanoid: domed head, wide shoulders,
// tapering torso, split legs. Cool-blue diver ramp; the light descending.
const DIVER = [
  '........',
  '......##',
  '.....###',
  '.....###',
  '.....###',
  '......##',
  '....####',
  '...#####',
  '...##?##',
  '...##?##',
  '....####',
  '.....###',
  '.....###',
  '.....##.',
  '.....##.',
  '.....##.',
];

// The echo / voice — what learns you. A wispy vertical flame, ragged rng edges
// that flicker frame-to-frame. Gold voice ramp; a glow, not a body.
const ECHO = [
  '.......?',
  '......?#',
  '......##',
  '.....?##',
  '.....###',
  '....?###',
  '....?###',
  '...?##?#',
  '...?##?#',
  '....?###',
  '....?###',
  '.....?##',
  '.....?##',
  '......?#',
  '......?#',
  '.......?',
];

// The hollow — the thing at the bottom wearing your shape, wrong. Humanoid but
// gutted: void eyes, a hollow ribcage core, thin splayed legs. Muted-warm hollow
// ramp. The centre gaps are deliberate empties the edge pass rings with outline.
const HOLLOW = [
  '......##',
  '.....###',
  '.....#.#',
  '.....###',
  '......##',
  '.....###',
  '...#####',
  '..###.?#',
  '..#?...#',
  '..#?..?#',
  '...##.##',
  '....####',
  '....#.##',
  '....###.',
  '....#.#.',
  '....#.#.',
];

const CREATURES = {
  diver: { rows: DIVER, ramp: 'diver' },
  echo: { rows: ECHO, ramp: 'voice' },
  hollow: { rows: HOLLOW, ramp: 'hollow' },
};

// Cell states after resolution (distinct from the authoring markup above).
const EMPTY = 0, BODY = 1, BORDER = 2;

function newCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Resolve authored half-rows (rolling the '?' detail cells on this seed) and
// mirror to a full-width grid of EMPTY/BODY. Half width is inferred from the rows.
function resolveMirrored(rows, rng) {
  const half = rows[0].length;
  const W = half * 2, H = rows.length;
  const g = Array.from({ length: H }, () => new Array(W).fill(EMPTY));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < half; x++) {
      const ch = rows[y][x];
      const v = ch === '#' ? BODY : ch === '?' ? (rng.int(0, 1) ? BODY : EMPTY) : EMPTY;
      g[y][x] = v;
      g[y][W - 1 - x] = v; // mirror onto the right half
    }
  }
  return { g, W, H };
}

// Any body pixel touching empty (or the canvas edge) becomes outline — one pass,
// darkest ramp shade. This is what turns a blobby mask into a read-able shape.
function edgePass(g, W, H) {
  const out = g.map((row) => row.slice());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== BODY) continue;
      const touchesEmpty =
        y === 0 || g[y - 1][x] === EMPTY ||
        y === H - 1 || g[y + 1][x] === EMPTY ||
        x === 0 || g[y][x - 1] === EMPTY ||
        x === W - 1 || g[y][x + 1] === EMPTY;
      if (touchesEmpty) out[y][x] = BORDER;
    }
  }
  return out;
}

// Fixed pseudo-lighting: lit toward top-left, shadowed toward bottom-right, by
// the pixel's diagonal position — so the mirrored (symmetric) silhouette still
// reads as a lit 3D form, not a flat cutout. Body sits mid-ramp; outline darkest.
function paintGrid(cctx, g, W, H, ramp, vBob) {
  const bodyBase = (PALETTE[ramp].length - 1) >> 1; // mid of a 3-step ramp -> 1
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cell = g[y][x];
      if (cell === EMPTY) continue;
      let color;
      if (cell === BORDER) {
        color = PALETTE[ramp][0];
      } else {
        const t = (x + y) / (W + H);
        const delta = t < 0.4 ? 1 : t > 0.62 ? -1 : 0;
        color = shade(ramp, bodyBase, delta);
      }
      cctx.fillStyle = color;
      cctx.fillRect(x, y + vBob, 1, 1); // 1px rects; the caller scales on blit
    }
  }
}

// Bake one creature frame to its own native-resolution offscreen canvas.
function bakeCreature(rows, ramp, rng, vBob) {
  const { g, W, H } = resolveMirrored(rows, rng);
  const grid = edgePass(g, W, H);
  const cv = newCanvas(W, H);
  paintGrid(cv.getContext('2d'), grid, W, H, ramp, vBob);
  return cv;
}

// A speckled stone tile: flat base fill, then a deterministic ~13% of pixels
// nudged ±1 shade so the tile reads as textured rock, not a flat block. A SET of
// variants lets a tilemap vary by (x,y) hash without any tile looking repeated.
function bakeTile(size, base, rng) {
  const cv = newCanvas(size, size);
  const cctx = cv.getContext('2d');
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const delta = rng.float() < 0.13 ? (rng.int(0, 1) ? 1 : -1) : 0;
      cctx.fillStyle = shade('stone', base, delta);
      cctx.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

// Pre-generate and cache everything ONCE for a seed, then hand back blit helpers.
// nativeSprite / nativeTile set the generated resolution; display size is chosen
// per-call, so the same sheet serves a 10px tilemap and a 64px cutscene entity.
export function makeSpriteSheet(opts = {}) {
  const {
    seed = 'recursion',
    nativeTile = 8,
    tileVariants = 4,
  } = opts;

  // Independent sub-streams per item (keyed by seed+tag) so adding a creature or
  // a variant never shifts another's rolls — reproducibility stays local.
  const creatures = {};
  for (const [which, { rows, ramp }] of Object.entries(CREATURES)) {
    // Two pre-baked frames: frame 1 is a 1px up-bob (cheap idle life). Each frame
    // re-rolls its own detail cells from a distinct stream, so the flicker on the
    // wispy echo is real variation, not just a shift.
    const f0 = bakeCreature(rows, ramp, makeRng(`${seed}:${which}:0`), 0);
    const f1 = bakeCreature(rows, ramp, makeRng(`${seed}:${which}:1`), -1);
    creatures[which] = { frames: [f0, f1], w: f0.width, h: f0.height };
  }

  const tiles = { floor: [], wall: [] };
  for (let i = 0; i < tileVariants; i++) {
    tiles.floor.push(bakeTile(nativeTile, 2, makeRng(`${seed}:floor:${i}`))); // mid stone
    tiles.wall.push(bakeTile(nativeTile, 1, makeRng(`${seed}:wall:${i}`)));  // darker stone
  }

  function drawTile(ctx, kind, variant, dx, dy, size) {
    const set = tiles[kind];
    if (!set) return;
    const cv = set[((variant % set.length) + set.length) % set.length];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, dx, dy, size ?? cv.width, size ?? cv.height);
  }

  function drawSprite(ctx, which, dx, dy, size, frame = 0) {
    const c = creatures[which];
    if (!c) return;
    const cv = c.frames[((frame % 2) + 2) % 2];
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv, dx, dy, size ?? cv.width, size ?? cv.height);
  }

  return {
    seed,
    nativeTile,
    tileVariants,
    spriteSize: { w: creatures.diver.w, h: creatures.diver.h },
    drawTile,
    drawSprite,
    // Raw caches — for a (x,y)-hashed tilemap picking its own variant, and for the
    // determinism check (compare frames[n].toDataURL() across two generations).
    caches: { creatures, tiles },
  };
}
