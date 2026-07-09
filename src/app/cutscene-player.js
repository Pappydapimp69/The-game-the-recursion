// The PRESENTATION-SIDE cutscene interpreter. Runs on its OWN capped-delta clock
// and touches the sim ONLY by dispatching each cmd marker through the same
// reduce() pipeline gameplay uses (injected as `dispatch`, so this module never
// imports the reducer — it stays decoupled and unit-testable). Cosmetic tracks
// (letterbox, captions, an optional particle flourish) are drawn here and NEVER
// reach the sim. Skip fires all remaining markers in order and ends, which — by
// the marker contract in sim/cutscene.js — lands byte-identical to watching.
// Precedent: research-cutscenes.md §1/§2/§4; PROPOSAL §5.1.
//
// Known simplification (honest): with no TTS/audio integration in the repo yet,
// captions advance off the cutscene's own elapsed ms, NOT real speaking state.
// The caption clock is injected (`captionMsOf`, default = elapsed) so a later
// pass can swap in polled audio.currentTime / SpeechSynthesis onboundary without
// touching this file's structure — the research brief's "sync to REAL speaking
// state, not estimated reading time" is deferred, not designed out.

import { markersInWindow } from '../sim/cutscene.js';

// Cap per-frame delta: a stall / backgrounded tab must not teleport the clock
// (memory: cap max frame delta or a stall becomes missed markers/collisions).
// Markers still never drop — markersInWindow covers the whole advance — but the
// cap keeps cosmetics and pacing sane after a hitch.
const MAX_DELTA_MS = 50;

export function createCutscenePlayer(scene, { dispatch, rng = null, captionMsOf = null } = {}) {
  let elapsed = 0;
  let lastFiredMs = -1; // below 0 so an atMs:0 marker fires on the first advance
  let ended = false;
  let started = false;
  let firedCount = 0;

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
    if (ended) return false;
    if (!started) start();
    const step = Math.max(0, Math.min(dtMs, MAX_DELTA_MS));
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

  // Sample the cosmetic tracks at the current caption/elapsed ms. Pure read of
  // scene data — no sim access. Letterbox bars animate 0->height over inMs and
  // back over the final outMs; the active caption is the last one reached.
  function cosmetics() {
    const ms = captionMsOf ? captionMsOf() : elapsed;
    const tracks = scene.cosmeticTracks || {};
    const cap = activeCaptionEntry(tracks.captions, ms);
    return {
      letterbox: letterboxFrac(tracks.letterbox, elapsed, scene.totalMs),
      caption: cap.text,
      captionAtMs: cap.atMs,
    };
  }

  const CAPTION_FONT = '10px ui-monospace, monospace';
  const LINE_H = 12;
  const MARGIN = 12;
  // Typewriter reveal rate, in characters per 1000 units of the scene's OWN
  // elapsed clock — NOT per real-world ms. main.js feeds this player a
  // slowed-down dt (its CUTSCENE_SPEED knob), so the reveal automatically
  // paces with whatever real-time speed the caller chooses, with no second
  // knob to keep in sync.
  const CHARS_PER_SEC = 90;

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
    const ms = captionMsOf ? captionMsOf() : elapsed;
    const revealChars = c.caption ? Math.floor(Math.max(0, ms - c.captionAtMs) * CHARS_PER_SEC / 1000) : 0;
    const shownLines = revealLines(fullLines, revealChars);

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
    advance, skip, draw, cosmetics,
    isEnded: () => ended,
    elapsedMs: () => elapsed,
    firedCount: () => firedCount,
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

// Active caption = the last one whose atMs has been reached. Existence-checked
// (not truthy) so an empty-string caption is still valid (wrong-sky#E5).
// Returns the entry (text + its OWN atMs), so the typewriter reveal can time
// itself from when THIS line started, not from scene start.
function activeCaptionEntry(captions, ms) {
  if (!Array.isArray(captions)) return { text: '', atMs: 0 };
  let cur = { text: '', atMs: 0 };
  for (const c of captions) { if (c.atMs <= ms) cur = c; }
  return cur;
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
