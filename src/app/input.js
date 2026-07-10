// Unified input — every device translates its raw signal into ONE small command
// vocabulary; everything downstream is device-agnostic, so adding a device is a
// thin adapter and all devices stay interchangeable mid-session. The headless
// test harness is a "device" too (it pushes presses / sets the move vector
// through the same queue).
// Precedent: ideas unified-command-vocabulary + device-adaptive-ui.
//
// Hard-won rules baked in here (do not regress):
//  - Poll navigator.getGamepads() EVERY FRAME; do NOT trust the 'gamepadconnected'
//    event — Chrome hides the pad until a button press (test#E3). THIS is the
//    old char-creation "controller does nothing" bug.
//  - Menus navigable by BOTH the left stick (debounced) AND the D-pad (test#E3).
//  - Capture presses at EVENT TIME into a queue, not by sampling held state once
//    per frame — a tap shorter than one frame is invisible to pure sampling
//    (the-game-prologue#E2). Keyboard uses real keydown events; the gamepad,
//    which has no event API, edge-detects every poll so no transition is missed.
//  - Track the ACTIVE device so the UI can render hints in its language at RENDER
//    time (the-game-prologue#E3/#E6). Never bake a hint at construct time.

// The vocabulary. `moveVec` is continuous (held); everything in PRESSES is
// edge-triggered (one event per press).
export const PRESSES = ['confirm', 'cancel', 'up', 'down', 'left', 'right', 'pause', 'skip', 'action'];

// Standard Gamepad API button indices (Xbox layout; DualShock maps the same).
const GP = { A: 0, B: 1, X: 2, Y: 3, START: 9, DUP: 12, DDOWN: 13, DLEFT: 14, DRIGHT: 15 };
const GP_PRESS = {
  [GP.A]: 'confirm', [GP.B]: 'cancel', [GP.START]: 'pause', [GP.X]: 'skip', [GP.Y]: 'action',
  [GP.DUP]: 'up', [GP.DDOWN]: 'down', [GP.DLEFT]: 'left', [GP.DRIGHT]: 'right',
};

const KEY_PRESS = {
  Enter: 'confirm', ' ': 'confirm', z: 'confirm', Z: 'confirm',
  Escape: 'cancel', x: 'cancel', X: 'cancel',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right',
  p: 'pause', P: 'pause', Backspace: 'skip',
  e: 'action', E: 'action', f: 'action', F: 'action',
};
const KEY_MOVE = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
};

const STICK_DEADZONE = 0.4;
const STICK_REPEAT_MS = 180; // debounce for stick-as-menu-nav

export function createInput(target = (typeof window !== 'undefined' ? window : null)) {
  const heldKeys = new Set();
  const touchHeld = new Set(); // named presses currently held via an on-screen touch button
  const pressQueue = [];
  let activeDevice = 'keyboard'; // 'keyboard' | 'gamepad' | 'touch'
  let touchMove = [0, 0];

  // gamepad edge state
  let prevButtons = [];
  let gamepadConnected = false;
  let stickAxis = [0, 0];
  let lastStickNavAt = { x: -1e9, y: -1e9 };

  function pushPress(name, device) {
    if (name) { pressQueue.push(name); if (device) activeDevice = device; }
  }

  if (target) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return; // event-time capture; ignore OS auto-repeat
      heldKeys.add(e.key);
      activeDevice = 'keyboard';
      const p = KEY_PRESS[e.key];
      if (p) { pressQueue.push(p); e.preventDefault(); }
    });
    target.addEventListener('keyup', (e) => heldKeys.delete(e.key));
    // Touch/mouse mark the device active; the on-screen control layer
    // (app/touch-controls.js) drives movement/presses through
    // setTouchMove/pressTouchDown/pressTouchUp below.
    target.addEventListener('touchstart', () => { activeDevice = 'touch'; }, { passive: true });
    target.addEventListener('pointerdown', () => { if (activeDevice !== 'gamepad') activeDevice = 'mouse'; });
  }

  // Called ONCE per frame. Polls the gamepad (edge-detecting buttons + stick),
  // drains nothing — returns the current held move vector and lets the caller
  // drain presses via takePresses(). `nowMs` is passed in so the sim/test stays
  // free of Date.now(); the render loop supplies performance.now().
  function sample(nowMs = 0) {
    let move = keyboardMove();
    const gpMove = pollGamepad(nowMs);
    if (gpMove) move = gpMove;
    else if (activeDevice === 'touch') move = touchMove.slice();
    return { move, device: activeDevice };
  }

  function keyboardMove() {
    let dx = 0, dy = 0;
    for (const k of heldKeys) { const m = KEY_MOVE[k]; if (m) { dx += m[0]; dy += m[1]; } }
    return [Math.sign(dx), Math.sign(dy)];
  }

  function pollGamepad(nowMs) {
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : [];
    let gp = null;
    for (const p of pads) { if (p) { gp = p; break; } }
    if (!gp) { gamepadConnected = false; return null; }
    gamepadConnected = true;

    // Edge-detect every button so no press between polls is lost. `prevButtons`
    // doubles as this frame's HELD state after the loop below (it's read back
    // by isHeld() for hold-to-dismiss gestures — the-game-prologue#E7 wants an
    // authoritative "is it down right now", not inference from press/release
    // timing).
    const btns = gp.buttons.map((b) => (typeof b === 'object' ? b.pressed : b > 0.5));
    for (let i = 0; i < btns.length; i++) {
      if (btns[i] && !prevButtons[i]) pushPress(GP_PRESS[i], 'gamepad');
    }
    prevButtons = btns;

    // Left stick → held move vector (discrete sign) AND debounced menu-nav press.
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    if (Math.abs(ax) > STICK_DEADZONE || Math.abs(ay) > STICK_DEADZONE) activeDevice = 'gamepad';
    stickAxis = [Math.abs(ax) > STICK_DEADZONE ? Math.sign(ax) : 0, Math.abs(ay) > STICK_DEADZONE ? Math.sign(ay) : 0];

    // Menu-nav from stick: emit up/down/left/right presses, debounced, only on a
    // fresh push (so a held stick doesn't machine-gun the menu). D-pad already
    // emits via the button edge-detect above.
    if (stickAxis[1] !== 0 && nowMs - lastStickNavAt.y > STICK_REPEAT_MS) {
      pushPress(stickAxis[1] < 0 ? 'up' : 'down', 'gamepad'); lastStickNavAt.y = nowMs;
    } else if (stickAxis[1] === 0) { lastStickNavAt.y = -1e9; }
    if (stickAxis[0] !== 0 && nowMs - lastStickNavAt.x > STICK_REPEAT_MS) {
      pushPress(stickAxis[0] < 0 ? 'left' : 'right', 'gamepad'); lastStickNavAt.x = nowMs;
    } else if (stickAxis[0] === 0) { lastStickNavAt.x = -1e9; }

    const anyBtn = btns.some(Boolean);
    if (anyBtn) activeDevice = 'gamepad';
    return stickAxis[0] !== 0 || stickAxis[1] !== 0 ? stickAxis.slice() : [0, 0];
  }

  // Drain the edge-triggered presses accumulated since the last call.
  function takePresses() {
    if (pressQueue.length === 0) return [];
    const out = pressQueue.slice();
    pressQueue.length = 0;
    return out;
  }

  // Continuous HELD state for one named press, for gestures that must be a
  // deliberate hold rather than a tap (e.g. cutscene skip — a bare tap can
  // accidentally eat a story beat; wrong-sky precedent, the-game-prologue#E7).
  // Reverse-looks-up the same KEY_PRESS/GP_PRESS tables `sample`/keydown use,
  // so a hold check is never a second source of truth for what a button means.
  function isHeld(name) {
    for (const k of heldKeys) { if (KEY_PRESS[k] === name) return true; }
    if (gamepadConnected) {
      for (let i = 0; i < prevButtons.length; i++) { if (prevButtons[i] && GP_PRESS[i] === name) return true; }
    }
    return touchHeld.has(name);
  }

  // Test hook — the headless harness is just another device.
  function injectPress(name) { pushPress(name, activeDevice === 'gamepad' ? 'gamepad' : 'keyboard'); }

  // The on-screen touch control layer (app/touch-controls.js): a button's
  // touchstart both fires an edge press (menu nav, one-shot actions) AND marks
  // it HELD (so isHeld('skip') — the cutscene hold-to-dismiss gesture — works
  // from a touch button exactly like a held key or gamepad button); touchend
  // clears the held mark. Two different calls because "pressed once" and
  // "held right now" are different questions or the wrong-sky/prologue#E7
  // hold-counter contract would have to special-case touch.
  function pressTouchDown(name) { touchHeld.add(name); pushPress(name, 'touch'); }
  function pressTouchUp(name) { touchHeld.delete(name); }
  function setTouchMove(vec) { touchMove = [Math.sign(vec[0] || 0), Math.sign(vec[1] || 0)]; }

  return {
    sample, takePresses, injectPress, setTouchMove, isHeld, device: () => activeDevice,
    pressTouchDown, pressTouchUp,
  };
}
