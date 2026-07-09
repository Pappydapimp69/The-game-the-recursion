// The single source of color truth. Every visual — generated sprites, tiles,
// cutscene entities, UI — indexes THIS, so generated and hand-placed pixels
// read as one world (the palette-constraint that makes procedural pixel-art
// cohere; research: "every pixel decision indexes a fixed array, shading is
// ±1 index along an ordered ramp, never lighten()").
//
// A dark, moody, cold-with-warm-accents ramp. Ordered ramps (dark -> light)
// so a sprite/tile shader can shift ±1 index for pseudo-lighting.

export const PALETTE = {
  // The absolute void — nothing drawn, the unlit cutoff.
  void: '#04050a',

  // Stone: walls and floor. 4-step ramp, cold blue-grey.
  stone: ['#0b0f1b', '#141b2e', '#202c48', '#33456a'],

  // The diver — you. Cool blue, the light descending. 3-step.
  diver: ['#5877b8', '#8fb6ff', '#c2dbff'],

  // The voice / echoes — gold. What learns you. 3-step.
  voice: ['#a37d28', '#e6c15a', '#f6e1a0'],

  // The hollow — the thing at the bottom wearing your shape. Muted warm. 3-step.
  hollow: ['#5c3540', '#9e5866', '#c88996'],

  // Text tiers, brightest -> dimmest.
  ink: ['#dfe4ef', '#aeb8cf', '#7684a0', '#4a5670'],
};

// Convenience: the darkest and lightest of a named ramp.
export const dark = (ramp) => PALETTE[ramp][0];
export const light = (ramp) => PALETTE[ramp][PALETTE[ramp].length - 1];

// Shift along a ramp by delta, clamped to its ends — the ONE pseudo-lighting
// primitive (never compute arbitrary RGB): a body pixel at index i, its lit
// edge at i+1, its shadow at i-1.
export function shade(ramp, i, delta) {
  const r = PALETTE[ramp];
  const j = Math.max(0, Math.min(r.length - 1, i + delta));
  return r[j];
}
