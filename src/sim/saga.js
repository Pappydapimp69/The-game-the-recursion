// The carryover contract between games of the saga. Versioned forever:
// SAGA<N>.<base64 canonical JSON>.<fnv1a32 checksum>. Every sequel accepts the
// PRIOR game's code OR a fresh start — the code is a courtesy, never a wall.
//
// The Recursion (game 5, the finale's finale): IMPORTS the Answering Deep's
// saga.v4 (SAGA4) to carry the whole saga's accumulated choices forward, and
// EXPORTS a saga.v5 (SAGA5). For THIS game the import is thematic bedrock, not
// just stats: the four accumulated choices (ravagerFate, riftChoice, wardenFate,
// answererFate) are what the voice already knows about you — they seed the
// player-model. A fresh start is always valid; then the voice knows nothing and
// must learn you from scratch this run.
//
// Safety: importSaga NEVER throws on user input (a mistyped code is a player
// mistake, not a crash) and NEVER evals — the payload is untrusted reference
// data. The caller clamps the parsed values into the world; import replaces
// state atomically, never a piecemeal merge (chronicles#E1).

import { stableStringify } from './canonical.js';
import { fnv1a32 } from './fingerprint.js';

const IMPORT_PREFIX = 'SAGA4';
const IMPORT_VERSION = 'saga.v4';
export const SAGA_VERSION = 'saga.v5';
const EXPORT_PREFIX = 'SAGA5';

export function exportSaga(state) {
  if (!state.flags.ended) throw new Error('exportSaga: the chapter is not finished');
  const data = {
    v: SAGA_VERSION,
    game: 'recursion',
    archetype: state.settings.archetype,
    difficulty: state.settings.difficulty,
    // The player-model the voice built this run, distilled to signed lean per
    // axis (the next game, if any, reads who you became here).
    model: distillModel(state.playerModel),
    choices: {
      ravagerFate: state.flags.ravagerFate || '',   // Prologue
      riftChoice: state.flags.riftChoice || '',      // Wrong Sky
      wardenFate: state.flags.wardenFate || '',      // Waiting City
      answererFate: state.flags.answererFate || '',  // Answering Deep
      recursionFate: state.arc.choice || '',         // this game's own choice
    },
  };
  const json = stableStringify(data);
  const payload = btoa(json);
  return `${EXPORT_PREFIX}.${payload}.${fnv1a32(payload)}`;
}

// Distill the running trait vector to a compact signed lean in [-1,1] per axis.
function distillModel(pm) {
  const out = {};
  if (pm && pm.axes) {
    for (const [axis, v] of Object.entries(pm.axes)) {
      const n = v.n || 0;
      out[axis] = n > 0 ? Math.max(-1, Math.min(1, v.sum / n)) : 0;
    }
  }
  return out;
}

// Returns { ok: true, data } or { ok: false, error }. Never throws.
export function importSaga(code) {
  if (typeof code !== 'string') return { ok: false, error: 'not a string' };
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== IMPORT_PREFIX) {
    return { ok: false, error: 'not an Answering Deep (saga.v4) code' };
  }
  const [, payload, check] = parts;
  if (fnv1a32(payload) !== check) return { ok: false, error: 'checksum mismatch — mistyped or altered' };
  let data;
  try { data = JSON.parse(atob(payload)); } catch { return { ok: false, error: 'corrupt payload' }; }
  if (!data || data.v !== IMPORT_VERSION) return { ok: false, error: `unsupported version ${data && data.v}` };
  for (const field of ['archetype', 'skills', 'choices']) {
    if (!data[field]) return { ok: false, error: `missing field ${field}` };
  }
  return { ok: true, data };
}
