// The ONE authoritative mutator. input -> command -> reduce(state, command) ->
// events[]; the view consumes events and reads state but NEVER writes it. Save =
// stringify(state); one chokepoint for debugging; the client/server seam already
// exists in shape. The renderer-never-mutates rule is the load-bearing constraint.
// Precedent: ideas authoritative-reducer/command-event-seam.
//
// reduce() mutates `state` in place and RETURNS the events array. All randomness
// goes through makeRng(state.rng) so the rng words in the save advance with the
// sim and nothing else. A cutscene changes state ONLY by enqueuing commands here
// (the same path gameplay uses), which is why watch-vs-skip provably agree.

import { makeRng } from './rng.js';
import { AXES } from './world.js';

export function reduce(state, cmd) {
  const events = [];
  const rng = makeRng(state.rng);
  const commit = () => { state.rng = rng.save(); };

  switch (cmd.type) {
    case 'MOVE': {
      // Discrete grid move. No float feeds any authoritative roll (split-state).
      const nx = state.player.x + Math.sign(cmd.dx | 0);
      const ny = state.player.y + Math.sign(cmd.dy | 0);
      if (nx !== state.player.x || ny !== state.player.y) {
        state.player.x = nx;
        state.player.y = ny;
        events.push({ t: 'moved', x: nx, y: ny });
      }
      break;
    }

    case 'TICK': {
      state.tick += 1;
      events.push({ t: 'tick', tick: state.tick });
      break;
    }

    // The voice learns you. A choice (in dialog, in a cutscene, in combat)
    // records a signed weight on one axis. This is the ONLY way playerModel
    // changes — a pure fold over these events, so it's deterministic and
    // hashable. describeModel (P4) is the single reader of the result.
    case 'RECORD_TRAIT_SIGNAL': {
      recordTrait(state, cmd.axis, cmd.weight, events);
      break;
    }

    // "The learning" (spine stage 1): picking a choice-point option both
    // records its trait signal AND advances the point index — via the SAME
    // recordTrait fold RECORD_TRAIT_SIGNAL uses, so the two can never drift
    // apart (the-game-prologue#E4: one text/data-effect path, not two copies).
    case 'CHOOSE_OPTION': {
      recordTrait(state, cmd.axis, cmd.weight, events);
      state.spine.learningIdx += 1;
      events.push({ t: 'choice', pointId: cmd.pointId });
      break;
    }

    // Advance the FIXED spine by exactly one stage (PROPOSAL §4 — the reducer
    // always advances through the spine in order; only the VARIANT shown at
    // each stage varies, chosen by the director outside this file). Gating
    // reads ONLY state already tracked (spine.totalChoicePoints, flags.ended) —
    // never a value the command itself supplies, which a caller could simply
    // omit to bypass. reduce.js still never imports content.js: the threshold
    // arrived once, at world construction, as a plain number (the content-
    // meets-code seam stays at the constructor, not scattered per-dispatch).
    // An ungated attempt is a no-op event, not a crash or a silent skip.
    case 'ADVANCE_SPINE': {
      const s = state.spine;
      let allowed = true;
      // Leaving 'learning' requires EVERY choice made AND every descent level
      // actually reached — belt-and-suspenders with ADVANCE_DEPTH's own gate
      // below (both should coincide by construction, since the last depth's
      // quota equals totalChoicePoints, but a command payload is never trusted
      // to prove that on its own).
      if (s.stage === 1) allowed = s.learningIdx >= s.totalChoicePoints && state.depth >= state.maxDepth;
      if (s.stage === 3) allowed = state.flags.ended; // leaving 'hollow' — the ending must be chosen
      if (allowed) { s.stage += 1; events.push({ t: 'spine', stage: s.stage }); }
      else events.push({ t: 'ignored', cmd: 'ADVANCE_SPINE' });
      break;
    }

    // Step to the next descent level WITHIN 'learning' (stage 1). Gated on the
    // SAME kind of construction-fixed threshold as ADVANCE_SPINE — the current
    // depth's own quota (spine.depthQuotas), never a value the command supplies.
    case 'ADVANCE_DEPTH': {
      const s = state.spine;
      const quota = s.depthQuotas[state.depth - 1];
      const allowed = s.stage === 1 && state.depth < state.maxDepth && typeof quota === 'number' && s.learningIdx >= quota;
      if (allowed) { state.depth += 1; events.push({ t: 'depth', depth: state.depth }); }
      else events.push({ t: 'ignored', cmd: 'ADVANCE_DEPTH' });
      break;
    }

    // Grant a player ability. Existence-gated: `id` must already be a known key
    // in state.abilities (fixed at world construction) — a command can request
    // an unlock, never invent a new ability slot (prologue#E9).
    case 'UNLOCK_ABILITY': {
      if (cmd.id in state.abilities && !state.abilities[cmd.id]) {
        state.abilities[cmd.id] = true;
        events.push({ t: 'ability', id: cmd.id });
      } else {
        events.push({ t: 'ignored', cmd: 'UNLOCK_ABILITY' });
      }
      break;
    }

    // The director selected and showed a beat — record it so the LRU stage of
    // the next selectBeat() call knows not to loop the same top pick.
    case 'BEAT_PLAYED': {
      if (cmd.beatId) {
        state.director.lastPlayed[cmd.beatId] = state.tick;
        events.push({ t: 'beat', beatId: cmd.beatId });
      }
      break;
    }

    // Cinematic mode as ONE authoritative flag with ONE exit path (test#E6:
    // reused modal state leaks). active:true records the scene id; active:false
    // clears it — every way a cutscene ends (watch-to-completion OR skip) funnels
    // through this same clear, so control can never be left half in cinematic mode.
    case 'MARK_CUTSCENE': {
      state.cutscene.activeId = cmd.active ? String(cmd.id || '') : null;
      events.push({ t: 'cutscene', activeId: state.cutscene.activeId });
      break;
    }

    // Bank the lost voices you were carrying — the safe half of the collect
    // loop. Only delivery is authoritative (and fingerprint-relevant to the
    // finale/saga); carrying is presentation and at risk. Clamped to total so a
    // double-deliver can't overcount.
    case 'DELIVER_ECHOES': {
      const n = Math.max(0, cmd.n | 0);
      if (n > 0) {
        state.quest.delivered = Math.min(state.quest.total, state.quest.delivered + n);
        events.push({ t: 'delivered', delivered: state.quest.delivered, total: state.quest.total });
      }
      break;
    }

    case 'RESTORE_FACET': {
      if (cmd.facet in state.facets) {
        state.facets[cmd.facet] = 1;
        events.push({ t: 'facet', facet: cmd.facet });
      }
      break;
    }

    case 'END': {
      if (!state.flags.ended) {
        state.flags.ended = true;
        state.arc.choice = String(cmd.choice || '');
        events.push({ t: 'ended', choice: state.arc.choice });
      }
      break;
    }

    default:
      events.push({ t: 'ignored', cmd: cmd.type });
  }

  commit();
  return events;
}

// The ONE trait-fold implementation — RECORD_TRAIT_SIGNAL and CHOOSE_OPTION
// both call this rather than each keeping their own copy.
function recordTrait(state, axis, weight, events) {
  const ax = state.playerModel.axes[axis];
  if (ax && Number.isFinite(weight)) {
    ax.sum += weight;
    ax.n += 1;
    state.playerModel.recentSignals.push({ axis, weight, tick: state.tick });
    if (state.playerModel.recentSignals.length > 16) state.playerModel.recentSignals.shift();
    events.push({ t: 'trait', axis, lean: leanLabel(axis, ax) });
  }
}

// Current signed lean on an axis as a word ('bold'/'cautious'/'—' when unknown).
export function leanLabel(axis, ax) {
  const def = AXES[axis];
  if (!def || !ax || ax.n === 0) return '—';
  const mean = ax.sum / ax.n;
  if (mean > 0.05) return def.pos;
  if (mean < -0.05) return def.neg;
  return '—';
}
