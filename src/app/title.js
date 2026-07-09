// Character creation, rebuilt from scratch — gamepad-first, not patched. The old
// screen only let the first line be selected and A just started the game, so
// hardship/difficulty was never actually choosable on a controller. Root cause
// was in input.js's stale gamepad handling (fixed there); this screen is built
// so that bug class can't recur:
//  - every field is a row in ONE navigable list (up/down moves the cursor)
//  - left/right (or confirm on a toggle) changes the selected field's value
//  - confirm on the LAST row ("Begin") is the only thing that starts the game
//  - the control hint line is recomputed every render from the ACTIVE device
//    (device-labels.js), never baked once at construct time
//  - the whole screen is ONE modal-mode ('title') with a single exit path, so
//    dismissing it can't leave stray flags set (test#E6)

import { hintLine } from './device-labels.js';
import { importSaga } from '../sim/saga.js';

const ARCHETYPES = ['wanderer', 'warden', 'answerer'];
const DIFFICULTIES = ['gentle', 'measured', 'unforgiving'];

// Field model: each row knows how to cycle its own value. 'begin' has no value,
// confirming it fires onBegin. 'sagaCode' confirming opens a text prompt (the
// browser's native prompt() as the input surface — see note in createTitleScreen).
function buildFields(state) {
  return [
    { id: 'archetype', label: 'Archetype', get: () => state.archetype,
      cycle: (d) => { state.archetype = cycleList(ARCHETYPES, state.archetype, d); } },
    { id: 'difficulty', label: 'Hardship', get: () => state.difficulty,
      cycle: (d) => { state.difficulty = cycleList(DIFFICULTIES, state.difficulty, d); } },
    { id: 'sagaCode', label: 'Saga code', get: () => state.sagaStatus,
      cycle: () => {} },
    { id: 'begin', label: 'Begin', get: () => '', cycle: () => {} },
  ];
}

function cycleList(list, current, dir) {
  const i = list.indexOf(current);
  const n = list.length;
  return list[(i + dir + n) % n];
}

export function createTitleScreen({ onBegin, promptForCode }) {
  const state = {
    archetype: ARCHETYPES[0],
    difficulty: DIFFICULTIES[1],
    sagaCode: '',
    sagaStatus: '(none — fresh start)',
    sagaData: null, // parsed { archetype, skills, choices, model } once a code validates
  };
  let cursor = 0;
  let fields = buildFields(state);
  let done = false;

  function moveCursor(delta) {
    cursor = (cursor + delta + fields.length) % fields.length;
  }

  // One entry point for every device's "confirm" press on the current row.
  function confirmRow() {
    const row = fields[cursor];
    if (row.id === 'begin') {
      done = true;
      onBegin({
        archetype: state.archetype,
        difficulty: state.difficulty,
        imported: !!state.sagaData,
        choices: state.sagaData ? state.sagaData.choices : undefined,
        model: state.sagaData ? state.sagaData.model : undefined,
      });
      return;
    }
    if (row.id === 'sagaCode') {
      const raw = promptForCode ? promptForCode() : null;
      if (raw == null || raw.trim() === '') return; // cancelled — a mistyped/empty entry is not an error
      const result = importSaga(raw);
      if (result.ok) {
        state.sagaData = result.data;
        state.archetype = ARCHETYPES.includes(result.data.archetype) ? result.data.archetype : state.archetype;
        state.sagaStatus = `imported ✓ (${result.data.game || 'prior game'})`;
      } else {
        state.sagaData = null;
        state.sagaStatus = `invalid — ${result.error}`;
      }
    }
  }

  // Called once per frame with { move, device, presses } from input.createInput().
  // `move` drives up/down between fields (edge-detected by the caller's presses,
  // NOT by continuous hold, so navigation doesn't machine-gun) and left/right
  // cycles a value. All navigation goes through PRESSES so keyboard, gamepad
  // D-pad, and gamepad stick (already debounced in input.js) behave identically.
  function handlePresses(presses) {
    for (const p of presses) {
      if (done) return;
      if (p === 'up') moveCursor(-1);
      else if (p === 'down') moveCursor(1);
      else if (p === 'left') fields[cursor].cycle(-1);
      else if (p === 'right') fields[cursor].cycle(1);
      else if (p === 'confirm') confirmRow();
    }
  }

  // Pure read model for the renderer: rows + which is selected + the hint line
  // for the CURRENTLY ACTIVE device (computed fresh, not cached).
  function view(device) {
    return {
      rows: fields.map((f, i) => ({ id: f.id, label: f.label, value: f.get(), selected: i === cursor })),
      hint: hintLine(device, [['up', '/'], ['down', 'move'], ['left', '/'], ['right', 'change'], ['confirm', 'select']]),
      done,
    };
  }

  return { handlePresses, view, state };
}
