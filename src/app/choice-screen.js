// A small reusable "pick one of N" screen — the learning stage's choice
// points and the hollow's ending choice are the same shape (a prompt + a list
// of options, navigate with up/down, confirm to pick), so one module serves
// both rather than two near-duplicate UIs. Mirrors title.js's navigation
// discipline: one cursor, presses drive it, confirm fires exactly once.

import { hintLine } from './device-labels.js';

export function createChoiceScreen({ prompt, options, onChoose }) {
  let cursor = 0;
  let chosen = false;

  function handlePresses(presses) {
    for (const p of presses) {
      if (chosen) return;
      if (p === 'up') cursor = (cursor - 1 + options.length) % options.length;
      else if (p === 'down') cursor = (cursor + 1) % options.length;
      else if (p === 'confirm') { chosen = true; onChoose(cursor, options[cursor]); return; }
    }
  }

  function view(device) {
    return {
      prompt,
      options: options.map((o, i) => ({ label: o.label, selected: i === cursor })),
      hint: hintLine(device, [['up', '/'], ['down', 'move'], ['confirm', 'choose']]),
      chosen,
    };
  }

  return { handlePresses, view };
}
