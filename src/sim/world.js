// The authoritative world state — the ONE source of truth. Everything that must
// survive a save, replay identically, or feed the golden fingerprint lives here
// as DISCRETE facts. Continuous cosmetic detail (camera, tweens, cutscene
// easing) lives in the presentation layer, never here (split-state-by-
// determinism-need). The renderer reads this and never writes it.
//
// makeWorld(seed, options) is the ONE constructor. "New Game" and restart-on-
// death must both route through here (or a JSON snapshot of a state built here),
// never reconstruct state ad hoc (dbh#E4, wrong-sky#E2).

import { seedState } from './rng.js';

// The five bipolar trait axes the voice learns you along. Each is a signed
// running sum + sample count: sign(sum) = your lean, |sum/n| = how sure the
// voice is. Positive/negative poles are documented for describeModel to speak.
export const AXES = {
  resolve: { pos: 'bold', neg: 'cautious' },
  inquiry: { pos: 'curious', neg: 'direct' },
  mercy: { pos: 'merciful', neg: 'ruthless' },
  candor: { pos: 'candid', neg: 'guarded' },
  attachment: { pos: 'attached', neg: 'detached' },
};

function freshModel() {
  const axes = {};
  for (const k of Object.keys(AXES)) axes[k] = { sum: 0, n: 0 };
  return { axes, recentSignals: [] };
}

export function makeWorld(seed = 'recursion', options = {}) {
  const settings = {
    archetype: options.archetype || 'wanderer',
    difficulty: options.difficulty || 'measured',
    // Whether a valid saga.v4 code seeded this run. Drives the "voice knows you"
    // vs "voice knows nothing yet" surface.
    imported: !!options.imported,
  };

  const world = {
    schemaVersion: 5,
    tick: 0,
    rng: seedState(seed),
    settings,

    player: { x: 4, y: 4, hp: 10, maxHp: 10 },

    // The voice's model of you. Seeded from the saga import when present
    // (options.model is a signed lean per axis in [-1,1]); otherwise blank.
    playerModel: seedModel(options.model),

    // Discrete world facets earned as progression (presentation reads these to
    // decide how richly to draw). Start minimal; the world gains definition as
    // the voice learns you (world-facets-as-reward, Wrong Sky).
    facets: { color: options.imported ? 1 : 0, light: 0, depth: 0 },

    // Saga choices carried in + this run's, so the export can re-emit the chain.
    flags: {
      ended: false,
      ravagerFate: (options.choices && options.choices.ravagerFate) || '',
      riftChoice: (options.choices && options.choices.riftChoice) || '',
      wardenFate: (options.choices && options.choices.wardenFate) || '',
      answererFate: (options.choices && options.choices.answererFate) || '',
    },
    arc: { choice: '' },
  };
  return world;
}

// Clamp a distilled saga model (signed lean per axis) into the running-sum
// representation with a modest starting confidence, so an imported run begins
// already leaning. Malformed input degrades to a blank model — never trusts the
// payload blindly (saga import is untrusted reference data).
function seedModel(distilled) {
  const pm = freshModel();
  if (distilled && typeof distilled === 'object') {
    const SEED_N = 3; // the voice starts with a few games' worth of impression
    for (const axis of Object.keys(AXES)) {
      const lean = Number(distilled[axis]);
      if (Number.isFinite(lean)) {
        const clamped = Math.max(-1, Math.min(1, lean));
        pm.axes[axis] = { sum: clamped * SEED_N, n: SEED_N };
      }
    }
  }
  return pm;
}

// A compact, deliberate fingerprint of the run's outcome — SMALL and STABLE so
// the golden hash isn't coupled to incidental fields. (fingerprint.js hashes a
// canonical view of exactly this.)
export function fingerprintOf(world) {
  return {
    tick: world.tick,
    rng: world.rng.slice(),
    player: { x: world.player.x, y: world.player.y, hp: world.player.hp },
    model: world.playerModel.axes,
    facets: world.facets,
    arc: world.arc.choice,
    ended: world.flags.ended,
  };
}
