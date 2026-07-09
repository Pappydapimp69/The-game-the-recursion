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
    return {
      letterbox: letterboxFrac(tracks.letterbox, elapsed, scene.totalMs),
      caption: activeCaption(tracks.captions, ms),
    };
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
    // Letterbox bars, drawn LAST in screen space (integer-snapped, no smoothing).
    if (c.letterbox > 0) {
      const bar = Math.round(H * c.letterbox);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    }
    if (c.caption) {
      ctx.fillStyle = '#e6e9f2';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(c.caption, 12, H - 14);
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
function activeCaption(captions, ms) {
  if (!Array.isArray(captions)) return '';
  let cur = '';
  for (const c of captions) { if (c.atMs <= ms) cur = c.text; }
  return cur;
}
