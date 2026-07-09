// The whole soundtrack, synthesized — zero sample files, zero URLs (strict-CSP
// target: every sound is generated in code with the Web Audio API). One reactive
// ambient drone the game steers with a single 0..1 mood value, plus a handful of
// short envelope-only SFX. Presentation-only: audio NEVER feeds the sim, so its
// one use of Math.random (noise fill) can't desync a replay (see step()).
//
// Hard-won lifecycle rules baked in here (do not regress — these are real user
// breakages, not theory):
//  - NEVER await resume()/start() on any critical path. Brave's privacy shields
//    leave resume() pending forever; gating init or gameplay on it locks those
//    users out. Init is fire-and-forget; every method is a safe no-op until the
//    context is actually 'running'. The game runs fully with audio silently dead.
//  - Schedule on the AudioContext clock (ctx.currentTime + offset), never a
//    per-note setTimeout — JS timers drift and get throttled when backgrounded.
//  - Connected/scheduled nodes are NOT GC'd for you: every one-shot voice
//    disconnects its whole chain on the source's onended, and SFX carry a
//    concurrent-voice cap + small cooldown so rapid triggers can't leak.

// Low root chords, one per game mood. Frequencies in Hz; [0] is the root the
// drone tracks for setChord's octave/detune math. Intro is a warm open fifth;
// the hollow leans dissonant (a flat-second cluster) so it reads as wrong.
const CHORDS = {
  intro:   [55.00, 82.41, 110.00, 164.81], // A1 + E2 + A2 + E3 — open, hopeful
  learning:[61.74, 92.50, 123.47, 185.00], // B1 + F#2 + B2 + F#3 — neutral lift
  reveal:  [58.27, 87.31, 116.54, 155.56], // Bb1 + F2 + Bb2 + Eb3 — unresolved
  hollow:  [55.00, 58.27, 87.31, 110.00],  // A1 + Bb1 clash — dissonant, hollow
};

const VOICE_COUNT = 4;               // oscillators in the drone stack
const MASTER_CEIL = 0.12;            // drone bus ceiling — deliberately LOW
const SFX_VOICE_CAP = 16;            // hard cap on concurrent one-shot SFX voices
const STEP_COOLDOWN_MS = 55;         // footsteps fire fastest; throttle them

// Detune spread per voice at mood 0, in cents. Incommensurate-ish so the stack
// beats against itself instead of phase-locking into a single fat tone.
const BASE_DETUNE = [-7, +5, -11, +9];
const VOICE_TYPES = ['sine', 'triangle', 'sine', 'sawtooth']; // [3] is the warmth saw

export function createAudio() {
  let ctx = null;
  let ok = false;         // true only once the graph is built without throwing

  // Drone graph handles, kept so setMood/setChord can automate their params.
  let master = null;      // drone bus gain (mood tremolo rides on top of this)
  let filter = null;      // shared lowpass; its cutoff is the main mood lever
  let voices = [];        // { osc, gain } per drone voice
  let lfos = [];          // { osc, gain } modulators, torn down on dispose
  let droneOn = false;

  let enabled = true;     // mute toggle (setEnabled) — independent of ctx state
  let userVolume = 1;     // 0..1 user master multiplier over MASTER_CEIL
  let mood = 0;           // last setMood value, re-applied after a chord change
  let chordName = 'intro';

  let liveSfx = 0;        // concurrent one-shot voice count (against SFX_VOICE_CAP)
  let lastStepAt = -1e9;  // ctx-clock ms of last footstep, for the cooldown

  // Build the context lazily and defensively. If AudioContext is missing or
  // construction throws (locked-down browser, no output device), ok stays false
  // and the whole engine degrades to no-ops — never throws upward.
  try {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (AC) { ctx = new AC(); ok = true; }
  } catch { ok = false; }

  // Guard used at the top of every audible method: no context, disabled, or the
  // context isn't running (autoplay-suspended / Brave-pending) => stay silent.
  function live() { return ok && enabled && ctx.state === 'running'; }

  // The effective drone bus level, folding in the user volume and the low ceiling.
  function busLevel() { return MASTER_CEIL * userVolume; }

  // --- drone ------------------------------------------------------------------

  // Build the detuned oscillator stack -> master gain -> lowpass -> destination,
  // then hang unsynced LFOs off the filter cutoff and the bus gain. Idempotent:
  // calling twice while running is a no-op. Safe (no-op) if the context is dead.
  function startDrone() {
    if (!ok || droneOn) return;
    const t = ctx.currentTime;
    const chord = CHORDS[chordName] || CHORDS.intro;

    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.9;
    filter.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = busLevel();
    master.connect(filter);

    voices = [];
    for (let i = 0; i < VOICE_COUNT; i++) {
      const osc = ctx.createOscillator();
      osc.type = VOICE_TYPES[i];
      osc.frequency.value = chord[i] || chord[chord.length - 1];
      osc.detune.value = BASE_DETUNE[i];
      const g = ctx.createGain();
      // The saw sits well under the sines/triangles — it's warmth, not a lead.
      g.gain.value = (VOICE_TYPES[i] === 'sawtooth') ? 0.06 : 0.22;
      osc.connect(g); g.connect(master);
      osc.start(t);
      voices.push({ osc, gain: g });
    }

    // Unsynced modulators at incommensurate low rates so the bed never audibly
    // loops. Each is osc -> depth-gain -> target AudioParam (added to the param's
    // base value). Rates chosen to share no small common multiple.
    lfos = [];
    addLfo(0.073, 300, filter.frequency);   // cutoff drift ±300 Hz
    addLfo(0.041, 0.02, master.gain);        // slow tremolo ±0.02 on the bus
    addLfo(0.017, 4, voices[0].osc.detune);  // faint detune wander on one voice

    droneOn = true;
    applyMood(mood, 0.001); // seat the initial mood without an audible glide
  }

  function addLfo(rateHz, depth, targetParam) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = rateHz;
    const g = ctx.createGain();
    g.gain.value = depth;
    osc.connect(g); g.connect(targetParam);
    osc.start(ctx.currentTime);
    lfos.push({ osc, gain: g });
  }

  // Map mood 0..1 onto the drone's live params via setTargetAtTime so everything
  // GLIDES (never jumps): brighter/opener filter, wider detune, louder warmth saw
  // as tension climbs. timeConstant ~0.6s => reaches ~95% of target in ~1.8s.
  function applyMood(x, tc = 0.6) {
    if (!ok || !droneOn) return;
    const t = ctx.currentTime;
    const cutoff = 400 + x * 1400;                 // 400..1800 Hz
    filter.frequency.setTargetAtTime(cutoff, t, tc);
    for (let i = 0; i < voices.length; i++) {
      const spread = BASE_DETUNE[i] * (1 + x * 1.5); // detune widens with tension
      voices[i].osc.detune.setTargetAtTime(spread, t, tc);
    }
    const saw = voices[VOICE_COUNT - 1];
    if (saw && VOICE_TYPES[VOICE_COUNT - 1] === 'sawtooth') {
      saw.gain.gain.setTargetAtTime(0.02 + x * 0.08, t, tc);
    }
  }

  function setMood(x) {
    mood = Math.max(0, Math.min(1, x || 0));
    applyMood(mood);
  }

  // Swap the drone's root chord for a different game mood. Glides each live voice
  // to its new frequency; if the drone isn't running yet, just remembers the name
  // so startDrone builds on the right chord.
  function setChord(name) {
    if (!CHORDS[name]) return;
    chordName = name;
    if (!ok || !droneOn) return;
    const t = ctx.currentTime;
    const chord = CHORDS[name];
    for (let i = 0; i < voices.length; i++) {
      voices[i].osc.frequency.setTargetAtTime(chord[i] || chord[chord.length - 1], t, 0.9);
    }
  }

  function stopDrone() {
    if (!droneOn) return;
    const t = ok ? ctx.currentTime : 0;
    for (const v of voices) { try { v.osc.stop(t + 0.05); } catch {} }
    for (const l of lfos) { try { l.osc.stop(t + 0.05); } catch {} }
    // Disconnect after the tails have surely stopped — nodes aren't GC'd while
    // connected. Best-effort; a dead context makes these harmless no-ops.
    setTimeout(() => {
      for (const v of voices) { try { v.osc.disconnect(); v.gain.disconnect(); } catch {} }
      for (const l of lfos) { try { l.osc.disconnect(); l.gain.disconnect(); } catch {} }
      try { master.disconnect(); filter.disconnect(); } catch {}
    }, 120);
    voices = []; lfos = []; master = null; filter = null; droneOn = false;
  }

  // --- SFX --------------------------------------------------------------------

  // One reusable one-shot voice: an oscillator through its own gain envelope,
  // straight to destination (SFX bypass the drone bus so they read clearly). The
  // whole chain disconnects on ended, and counts against the concurrent cap so a
  // mashed button can't leak nodes. Returns silently if capped or not live.
  function tone({ type = 'sine', from, to = from, dur, attack = 0.004, peak = 0.3, glideEnd = null }) {
    if (!live() || liveSfx >= SFX_VOICE_CAP) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.linearRampToValueAtTime(to, t + (glideEnd ?? dur));

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    // exponentialRamp can't hit 0 — decay to a floor, then hard-stop the source.
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g); g.connect(ctx.destination);
    liveSfx++;
    osc.onended = () => { liveSfx--; try { osc.disconnect(); g.disconnect(); } catch {} };
    osc.start(t);
    osc.stop(t + dur + 0.02);
    return { osc, g, t };
  }

  // Rising blip — menu accept.
  function confirm() {
    tone({ type: 'triangle', from: 880, to: 1320, dur: 0.10, attack: 0.003, peak: 0.3, glideEnd: 0.06 });
  }

  // Descending triangle — menu back/cancel.
  function cancel() {
    tone({ type: 'triangle', from: 440, to: 220, dur: 0.13, attack: 0.004, peak: 0.26, glideEnd: 0.12 });
  }
  const back = cancel; // alias — same sound, both names the game might reach for

  // Footstep: a filtered white-noise burst plus a faint low sine body. The noise
  // buffer is filled with Math.random — fine here because audio is presentation
  // only and never touches the deterministic sim (any seeded RNG would do, but
  // there's no replay value in footstep grain). Throttled + capped like all SFX.
  function step() {
    if (!live()) return;
    const t = ctx.currentTime;
    const nowMs = t * 1000;
    if (nowMs - lastStepAt < STEP_COOLDOWN_MS) return;
    if (liveSfx >= SFX_VOICE_CAP) return;
    lastStepAt = nowMs;

    const dur = 0.08;
    const frames = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 220; lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);

    liveSfx++;
    src.onended = () => { liveSfx--; try { src.disconnect(); lp.disconnect(); g.disconnect(); } catch {} };
    src.start(t);

    // Low sine body under the noise — a soft thud, not a click. Its own voice so
    // it counts and cleans up on its own.
    tone({ type: 'sine', from: 82, to: 64, dur: 0.09, attack: 0.004, peak: 0.10, glideEnd: 0.09 });
  }

  // Soft bell-ish stinger for cutscene beats — two detuned sines with a long
  // exponential tail. Both partials share the cap accounting via tone().
  function chime() {
    tone({ type: 'sine', from: 587.33, to: 587.33, dur: 1.4, attack: 0.006, peak: 0.18 }); // D5
    tone({ type: 'sine', from: 883.00, to: 883.00, dur: 1.1, attack: 0.006, peak: 0.10 }); // ~A5, detuned
  }
  const reveal = chime; // alias for the cutscene-reveal beat

  // --- lifecycle / mixer ------------------------------------------------------

  // Best-effort resume on a user gesture. FIRE-AND-FORGET: we call resume() and
  // drop the promise on the floor — awaiting it hangs forever under Brave's
  // shields (see file header). If it stays suspended, live() keeps us silent.
  function resume() {
    if (!ok) return;
    try { if (ctx.state !== 'running') ctx.resume(); } catch {}
  }
  const unlock = resume;

  function setEnabled(on) {
    enabled = !!on;
    if (!ok || !droneOn) return;
    // Duck the whole drone bus rather than tearing down the graph, so toggling
    // mute mid-scene doesn't lose the evolving LFO phase.
    try { master.gain.setTargetAtTime(enabled ? busLevel() : 0, ctx.currentTime, 0.05); } catch {}
  }

  function setVolume(v) {
    userVolume = Math.max(0, Math.min(1, v || 0));
    if (ok && droneOn && enabled) {
      try { master.gain.setTargetAtTime(busLevel(), ctx.currentTime, 0.1); } catch {}
    }
  }

  // Full teardown — stop the drone and close the context. Safe to call twice.
  function dispose() {
    stopDrone();
    if (ok) { try { ctx.close(); } catch {} }
    ok = false;
  }

  return {
    resume, unlock,
    startDrone, stopDrone,
    setMood, setChord,
    confirm, cancel, back, step, chime, reveal,
    setEnabled, setVolume, dispose,
    // Read-only introspection for callers/tests — never throws.
    state: () => (ok ? ctx.state : 'unavailable'),
    isRunning: () => live(),
  };
}
