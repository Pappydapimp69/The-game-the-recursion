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
      const ax = state.playerModel.axes[cmd.axis];
      if (ax && Number.isFinite(cmd.weight)) {
        ax.sum += cmd.weight;
        ax.n += 1;
        state.playerModel.recentSignals.push({ axis: cmd.axis, weight: cmd.weight, tick: state.tick });
        if (state.playerModel.recentSignals.length > 16) state.playerModel.recentSignals.shift();
        events.push({ t: 'trait', axis: cmd.axis, lean: leanLabel(cmd.axis, ax) });
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

// Current signed lean on an axis as a word ('bold'/'cautious'/'—' when unknown).
export function leanLabel(axis, ax) {
  const def = AXES[axis];
  if (!def || !ax || ax.n === 0) return '—';
  const mean = ax.sum / ax.n;
  if (mean > 0.05) return def.pos;
  if (mean < -0.05) return def.neg;
  return '—';
}
