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
    // The ORIGINAL seed string, kept alongside the rng's derived state words so
    // procgen can regenerate this run's map on demand (gen(seed, version, spec)
    // is a pure function) rather than storing the whole tile grid in the save.
    seed: String(seed),
    settings,

    player: { x: 4, y: 4, hp: 10, maxHp: 10 },

    // The voice's model of you. Seeded from the saga import when present
    // (options.model is a signed lean per axis in [-1,1]); otherwise blank.
    playerModel: seedModel(options.model),

    // Discrete world facets earned as progression (presentation reads these to
    // decide how richly to draw). Start minimal; the world gains definition as
    // the voice learns you (world-facets-as-reward, Wrong Sky).
    facets: { color: options.imported ? 1 : 0, light: 0, depth: 0 },

    // The director's memory of what it has already shown — the LRU tie-break
    // salience selection needs so the voice doesn't loop the same top beat.
    director: { lastPlayed: {} },

    // The quest the encounter-echo sets: lost voices scattered through the deep,
    // to be gathered and delivered. `delivered` is authoritative and safe (banked
    // through DELIVER_ECHOES); what you're still CARRYING is presentation and at
    // risk from the hunter (P16). total is the content-defined count of lost
    // voices to find. Kept OUT of fingerprintOf (the demo never delivers, so the
    // golden hash is unaffected; the spine test covers determinism here).
    quest: { delivered: 0, total: options.echoTotal || 0 },

    // Cinematic mode, tracked in ONE place: activeId is the scene playing (null
    // = gameplay). The presentation cutscene-player sets/clears it via a single
    // MARK_CUTSCENE command with one exit path (test#E6). Kept OUT of
    // fingerprintOf below — the demo never enters a cutscene, so the golden hash
    // is unaffected; the watch-vs-skip test hashes the fields markers actually
    // mutate (model/facets), which is where determinism must hold.
    cutscene: { activeId: null },

    // The fixed emotional spine (PROPOSAL §4): the reducer always advances
    // through these stages IN ORDER; only the VARIANT shown at each stage
    // varies, chosen by the director from the live player-model (§5.3). One
    // stage index is the whole authoritative progress marker — no parallel
    // "have we shown X" flags to drift out of sync with it.
    //
    // totalChoicePoints is set ONCE here (the caller passes content.js's
    // CHOICE_POINTS.length) rather than re-supplied per ADVANCE_SPINE dispatch
    // — a threshold read from a COMMAND's own payload is bypassable by simply
    // omitting it; fixed in authoritative state at construction, it can't be.
    //
    // depthQuotas is the same anti-bypass move applied to the multiple descent
    // levels WITHIN 'learning': depthQuotas[d-1] is the CUMULATIVE learningIdx
    // required to leave depth d, fixed at construction from content.js's own
    // per-depth choice-point counts (never re-suppliable per ADVANCE_DEPTH
    // dispatch). Defaults to a single depth so any caller that doesn't opt in
    // (the demo, the older spine tests) gets the exact old one-floor behavior.
    spine: {
      stage: 0, learningIdx: 0, totalChoicePoints: options.totalChoicePoints || 0, variantOf: {},
      depthQuotas: options.depthQuotas || [options.totalChoicePoints || 0],
    },

    // How many descent levels deep 'learning' goes this run, and which one the
    // player is currently on (1-based). maxDepth defaults to 1 — a single
    // floor, byte-for-byte the old behavior — unless the caller (main.js)
    // explicitly opts into more.
    depth: 1,
    maxDepth: options.maxDepth || 1,

    // Unlockable player abilities. A fixed, known set of keys (existence-gated
    // at UNLOCK_ABILITY — prologue#E9: a gate can't unlock something that
    // doesn't already exist as a slot), all false until a depth transition
    // grants one.
    abilities: { pulse: false, dash: false, ward: false },

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
