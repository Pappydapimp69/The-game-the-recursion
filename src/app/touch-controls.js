// The on-screen touch control layer — the piece input.js's own comment had
// flagged as "(P-later)" and never actually built. Wires simple DOM buttons
// directly into the SAME unified input vocabulary every other device uses
// (input.js's pressTouchDown/Up + setTouchMove), never a second parallel input
// path. Buttons are WORD-labeled (confirm/cancel/action/skip), not bare glyphs
// — an unlabeled glyph button makes players press random ones to find out
// what it does (test#E3, device-adaptive-ui). Directional arrows are the one
// exception: an arrow's meaning is its shape, the same reasoning that makes
// keyboard arrow keys legible without a text label.
//
// Only created at all on a touch-CAPABLE device (checked once via
// navigator.maxTouchPoints, independent of `activeDevice` — a hybrid
// laptop/tablet should have the option available before its first touch, not
// only after one already happened).

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

export function isTouchCapable() {
  if (typeof navigator === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || (typeof window !== 'undefined' && 'ontouchstart' in window);
}

export function createTouchControls(container, input) {
  const root = document.createElement('div');
  root.id = 'touch-ui';

  // The d-pad's four directions are tracked as a HELD set (not just the last
  // button pressed) so releasing one direction doesn't zero out another still
  // held — the same reasoning KEY_MOVE's heldKeys Set already uses for the
  // keyboard, kept consistent across devices.
  const heldDirs = new Set();
  function updateMove() {
    let dx = 0, dy = 0;
    for (const dir of heldDirs) { const [mx, my] = DIRS[dir]; dx += mx; dy += my; }
    input.setTouchMove([dx, dy]);
  }

  function bindPress(btn, name, onDown) {
    const start = (e) => { e.preventDefault(); btn.classList.add('tc-held'); onDown(); input.pressTouchDown(name); };
    const end = (e) => { e.preventDefault(); btn.classList.remove('tc-held'); input.pressTouchUp(name); if (DIRS[name]) { heldDirs.delete(name); updateMove(); } };
    btn.addEventListener('touchstart', start, { passive: false });
    btn.addEventListener('touchend', end, { passive: false });
    btn.addEventListener('touchcancel', end, { passive: false });
  }

  function makeButton(cls, label) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `tc-btn ${cls}`;
    b.textContent = label;
    return b;
  }

  const dpad = document.createElement('div');
  dpad.className = 'tc-dpad';
  const dirButtons = [
    ['up', '▲', 'tc-up'], ['left', '◀', 'tc-left'], ['right', '▶', 'tc-right'], ['down', '▼', 'tc-down'],
  ];
  for (const [dir, glyph, cls] of dirButtons) {
    const b = makeButton(`tc-dir ${cls}`, glyph);
    bindPress(b, dir, () => { heldDirs.add(dir); updateMove(); });
    dpad.appendChild(b);
  }

  const actions = document.createElement('div');
  actions.className = 'tc-actions';
  const actionButtons = [
    ['action', 'action', 'tc-y'], ['cancel', 'cancel', 'tc-b'],
    ['skip', 'hold\nskip', 'tc-x'], ['confirm', 'confirm', 'tc-a'],
  ];
  for (const [press, label, cls] of actionButtons) {
    const b = makeButton(`tc-action-btn ${cls}`, label);
    bindPress(b, press, () => {});
    actions.appendChild(b);
  }

  root.appendChild(dpad);
  root.appendChild(actions);
  container.appendChild(root);
  return root;
}
