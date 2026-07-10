// The PRESENTATION-SIDE cutscene interpreter. Runs on its OWN capped-delta clock
// and touches the sim ONLY by dispatching each cmd marker through the same
// reduce() pipeline gameplay uses (injected as `dispatch`, so this module never
// imports the reducer — it stays decoupled and unit-testable). Cosmetic tracks
// (letterbox, captions, an optional particle flourish) are drawn here and NEVER
// reach the sim. Skip fires all remaining markers in order and ends, which — by
// the marker contract in sim/cutscene.js — lands byte-identical to watching.
// Precedent: research-cutscenes.md §1/§2/§4; PROPOSAL §5.1.
//
// Dialogue is PLAYER-PACED, not clock-paced (design change: a fixed per-line
// timer either cuts a line off mid-type for a slow reader or drags for a fast
// one — no fixed number is right for everyone). advanceCaption() is the one
// entry point: a press either instantly completes the current line's
// typewriter reveal, or — once it's fully revealed — steps to the next line.
// This is entirely independent of `elapsed`/`advance()`/`skip()` below, which
// keep driving markers, the entity animation, and the letterbox exactly as
// before (untouched — that machinery is what the watch-vs-skip determinism
// contract in scripts/smoke.mjs verifies, and this file must not put that at
// risk just to make captions player-paced).

import { markersInWindow } from '../sim/cutscene.js';

// Cap per-frame delta: a stall / backgrounded tab must not teleport the clock
// (memory: cap max frame delta or a stall becomes missed markers/collisions).
// Markers still never drop — markersInWindow covers the whole advance — but the
// cap keeps cosmetics and pacing sane after a hitch.
const MAX_DELTA_MS = 50;

// Typewriter reveal rate, in characters per 1000 units of its OWN presentation
// clock (`typeElapsed`, below) — NOT per real-world ms. main.js feeds this
// player a slowed-down dt (its CUTSCENE_SPEED knob), so the reveal
// automatically paces with whatever real-time speed the caller chooses.
export const CHARS_PER_SEC = 90;

export function createCutscenePlayer(scene, { dispatch, rng = null } = {}) {
  let elapsed = 0;
  let lastFiredMs = -1; // below 0 so an atMs:0 marker fires on the first advance
  let ended = false;
  let started = false;
  let firedCount = 0;

  // A SEPARATE, never-capped, never-frozen presentation clock for the
  // typewriter only. `elapsed` clamps at scene.totalMs and freezes once ended
  // — fine for markers/entity/letterbox, which are done by then, but a slow
  // reader who's still mid-dialogue when that ceiling is reached must not
  // have their current line's reveal freeze along with it.
  let typeElapsed = 0;
  let captionIndex = 0;
  let lineStartMs = 0;   // typeElapsed value when the CURRENT line began
  let lineForced = false; // true once a press force-completed the current line's reveal

  // Cosmetic particle flourish (optional): positions drawn from an injected
  // cosmetic RNG seeded (saveSeed, sceneId) and kept OUT of the authoritative
  // stream. Purely decorative — never dispatched, never read by the sim.
  const particles = [];
  if (rng) {
    const n = 24;
    for (let i = 0; i < n; i++) {
      particles.push({ x: rng.int(0, 320), y: rng.int(0, 240), life: rng.int(30, 90) });
    }
  }

  function captionsList() { return (scene.cosmeticTracks && scene.cosmeticTracks.captions) || []; }

  function fireWindow(prevMs, curMs) {
    for (const marker of markersInWindow(scene, prevMs, curMs)) {
      dispatch(marker.cmd);
      firedCount++;
    }
    lastFiredMs = Math.max(lastFiredMs, curMs);
  }

  // Enter cinematic mode once, through the single authoritative flag.
  function start() {
    if (started) return;
    started = true;
    dispatch({ type: 'MARK_CUTSCENE', active: true, id: scene.id });
  }

  function finish() {
    if (ended) return;
    ended = true;
    dispatch({ type: 'MARK_CUTSCENE', active: false });
  }

  // Advance the presentation clock by a real frame delta and fire any newly
  // crossed markers. Returns whether the scene is still running.
  function advance(dtMs) {
    const step = Math.max(0, Math.min(dtMs, MAX_DELTA_MS));
    typeElapsed += step;
    if (ended) return false;
    if (!started) start();
    const prev = elapsed;
    elapsed = Math.min(scene.totalMs, elapsed + step);
    fireWindow(prev, elapsed);
    if (elapsed >= scene.totalMs) finish();
    return !ended;
  }

  // Skip = fire every not-yet-fired marker NOW, in order, drop the cosmetics,
  // end the scene. Same commands, same order → same end state as watching.
  function skip() {
    if (ended) return;
    if (!started) start();
    fireWindow(lastFiredMs, scene.totalMs);
    elapsed = scene.totalMs;
    finish();
  }

  // How much of the CURRENT line is revealed right now.
  function revealedChars() {
    const captions = captionsList();
    const text = captions[captionIndex] ? captions[captionIndex].text || captions[captionIndex] : '';
    if (lineForced) return String(text).length;
    return Math.max(0, Math.floor((typeElapsed - lineStartMs) * CHARS_PER_SEC / 1000));
  }

  function currentLineDone() {
    const captions = captionsList();
    const text = captions[captionIndex] ? (captions[captionIndex].text || captions[captionIndex]) : '';
    return revealedChars() >= String(text).length;
  }

  function isAtLastLine() {
    const captions = captionsList();
    return captions.length === 0 || captionIndex >= captions.length - 1;
  }

  // The player's one dialogue input: press-to-advance. First press on a
  // still-typing line snaps it to fully revealed (never SKIPS a line's
  // content, just stops making the player wait for it); a press once it's
  // fully revealed steps to the next line. On the last, fully-revealed line
  // this is a no-op — main.js gates leaving the scene on the hold-to-dismiss
  // gesture instead, never on a plain confirm press.
  function advanceCaption() {
    if (!currentLineDone()) { lineForced = true; return; }
    const captions = captionsList();
    if (captionIndex < captions.length - 1) {
      captionIndex++;
      lineStartMs = typeElapsed;
      lineForced = false;
    }
  }

  // Sample the cosmetic tracks. Pure read of scene data — no sim access.
  // Letterbox bars animate 0->height over inMs and back over the final outMs.
  function cosmetics() {
    const captions = captionsList();
    const entry = captions[captionIndex];
    const text = entry ? (entry.text || entry) : '';
    return {
      letterbox: letterboxFrac(scene.cosmeticTracks && scene.cosmeticTracks.letterbox, elapsed, scene.totalMs),
      caption: text,
    };
  }

  const CAPTION_FONT = '10px ui-monospace, monospace';
  const LINE_H = 12;
  const MARGIN = 12;

  // Greedy word-wrap to the canvas's own width. A caption is authored as one
  // sentence-length string (this repo's captions run well past what fits on
  // one line at this font/width) — with no wrap, fillText simply draws past
  // the canvas edge and the tail is gone, invisible only because the canvas
  // used to render too small to notice. ctx.font must already be set by the
  // caller (draw() sets it right before calling this).
  function wrapLines(ctx, text, maxWidth) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function draw(ctx) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const c = cosmetics();
    // Cosmetic particles first (behind the bars), from the cosmetic RNG only.
    if (particles.length) {
      ctx.fillStyle = '#2b3450';
      for (const p of particles) {
        if (elapsed % (p.life + 1) < p.life) ctx.fillRect(p.x, p.y, 2, 2);
      }
    }

    ctx.font = CAPTION_FONT;
    // Word-wrap against the FULL line first — line-break points must stay
    // fixed for the whole reveal, or text would visibly reflow as it types.
    const fullLines = c.caption ? wrapLines(ctx, c.caption, W - MARGIN * 2) : [];
    const shownLines = revealLines(fullLines, revealedChars());

    // Letterbox bars, drawn LAST in screen space (integer-snapped, no
    // smoothing). The bottom bar is sized off the FULL line count (its
    // eventual, not currently-revealed, size) so it doesn't grow mid-type —
    // the top bar stays the authored/animated height for symmetry during
    // fade-in.
    if (c.letterbox > 0) {
      const bar = Math.round(H * c.letterbox);
      const bottomBar = Math.max(bar, fullLines.length ? fullLines.length * LINE_H + 18 : 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bottomBar, W, bottomBar);
    }

    if (shownLines.length) {
      ctx.fillStyle = '#e6e9f2';
      ctx.font = CAPTION_FONT;
      // Anchor off the FULL line count so each line's y-position is fixed
      // from the moment it starts typing, not shifting as later lines appear.
      let y = H - 14 - (fullLines.length - 1) * LINE_H;
      for (const line of shownLines) { ctx.fillText(line, MARGIN, y); y += LINE_H; }
    }
  }

  return {
    advance, skip, draw, cosmetics, advanceCaption,
    isEnded: () => ended,
    elapsedMs: () => elapsed,
    totalMs: () => scene.totalMs,
    firedCount: () => firedCount,
    isCurrentLineDone: currentLineDone,
    isAtLastLine,
    sceneId: scene.id,
  };
}

// Bars grow in over inMs, hold, then shrink over the final outMs. Linear is
// enough for this pass (research brief: no easing-curve library needed).
function letterboxFrac(lb, ms, totalMs) {
  if (!lb) return 0;
  const h = lb.height || 0;
  const inMs = lb.inMs || 0, outMs = lb.outMs || 0;
  if (inMs > 0 && ms < inMs) return h * (ms / inMs);
  if (outMs > 0 && ms > totalMs - outMs) return h * Math.max(0, (totalMs - ms) / outMs);
  return h;
}

// Truncate a set of already-fixed word-wrapped lines down to the first `n`
// characters total (each line boundary counts as one character, matching the
// join-with-space `wrapLines` collapsed) — lines beyond the cutoff are
// dropped, not shown blank, so nothing pops in ahead of its turn.
function revealLines(fullLines, n) {
  const out = [];
  let remaining = n;
  for (const line of fullLines) {
    if (remaining <= 0) break;
    if (remaining >= line.length) { out.push(line); remaining -= line.length + 1; }
    else { out.push(line.slice(0, remaining)); remaining = 0; }
  }
  return out;
}
