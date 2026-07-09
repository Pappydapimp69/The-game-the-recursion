// Control hints rendered in the ACTIVE device's own language — recomputed every
// frame from the live device, NOT baked when a UI element is constructed (the
// device active at creation is not guaranteed to still be active at render;
// the-game-prologue#E3/#E6, refines test#E3). Labels are WORDS, never bare glyphs
// — unlabeled glyph buttons make players "press random buttons" (device-adaptive-ui).

// For each abstract press, what to call the control on each device.
const LABELS = {
  keyboard: {
    confirm: 'Enter', cancel: 'Esc', up: '↑', down: '↓', left: '←', right: '→',
    pause: 'P', skip: 'Backspace', action: 'E', move: 'WASD / Arrows',
  },
  gamepad: {
    confirm: 'A', cancel: 'B', up: 'D-pad ↑', down: 'D-pad ↓', left: 'D-pad ←', right: 'D-pad →',
    pause: 'Start', skip: 'X', action: 'Y', move: 'Left stick / D-pad',
  },
  touch: {
    confirm: 'tap', cancel: 'back', up: 'up', down: 'down', left: 'left', right: 'right',
    pause: 'menu', skip: 'skip', action: 'act', move: 'joystick',
  },
  mouse: {
    confirm: 'click', cancel: 'Esc', up: '↑', down: '↓', left: '←', right: '→',
    pause: 'P', skip: 'Backspace', action: 'E', move: 'WASD / Arrows',
  },
};

// The word for one press on a device (falls back to keyboard, then the raw name).
export function labelFor(device, press) {
  const d = LABELS[device] || LABELS.keyboard;
  return d[press] || LABELS.keyboard[press] || press;
}

// Build a full hint string for a set of (press, verb) pairs, in the device's
// language: e.g. "A confirm · B back" on a gamepad, "Enter confirm · Esc back"
// on a keyboard. hints = [['confirm','choose'], ['cancel','back']].
export function hintLine(device, hints) {
  return hints.map(([press, verb]) => `${labelFor(device, press)} ${verb}`).join('   ·   ');
}
