# The Recursion — Phase 5 Proposal

*Saga game 5. The finale's finale. Built from everything learned in Phases 1–4
and the Brain knowledge system — proven bones, wholly new flesh. Not copied.*

---

## 1. Vision

**The Recursion is a retelling.** The saga's descent is told again — but this time
the world is built from the accumulated memory of *who you have been across four
games*. You return to the surface, as the saga's protagonist does at the end, into
a world that has not yet been defined. **It defines itself from you.**

The engine's spine is a single idea: **a voice that learns you by reflecting you
back.** It watches how you choose — bold or cautious, merciful or ruthless, curious
or direct — and it retells the story in your own shape. The saga code you import is
not a bag of carryover stats; it is *the material the voice already holds* — the four
choices you made across the Prologue, Wrong Sky, the Waiting City, and the Answering
Deep are the seed of what it knows about you before you say a word. Start fresh
instead, and the voice knows nothing: it must learn you from scratch this run.

The narrative has a **fixed emotional spine** — descent, the voice learning your name,
the choice at the hollow — and a **variable surface**: every node has 2–4
state-selected variants, never N branches. Same story, never the same telling. That
is *recursion*: each pass through the loop is shaped by the residue of the last.

## 2. The growth marker — a new skill, demonstrated

Phases 1–4 proved a discipline: tight, correct, **deterministic systems** on an
authoritative reducer. Phase 5 keeps that discipline and adds three capabilities the
saga has never shown, each researched externally and grounded in Brain precedent:

1. **Cinematic direction** — animated cutscenes that punctuate the arc (an intro that
   sets the stakes, a mid-game reveal, a finale that *visualizes your accumulated
   choices*), integrated into the deterministic engine without breaking it.
2. **Generative content** — procedurally generated maps that feel **authored**,
   validated so they can never soft-lock, reproducible from the seed.
3. **Adaptive narrative** — a legible **player-model** that reshapes quests, dialog,
   world dressing, and cutscene content in a way the player can *see* responding.

The through-line is **integration discipline** — orchestrating ~20 systems into one
coherent product without cracks. That is the project-management growth the memory
catalog keeps demanding.

---

## 3. Architecture

### Proven bones (ported intent, fresh code — not copy-paste)
The command→event→reduce spine is non-negotiable and every new system rides it.

- `sim/reduce.js` — the ONE authoritative mutator. Input→commands→`reduce(state,cmd)`
  →events; renderer never writes state. *(idea: authoritative-reducer/command-event-seam)*
- `sim/rng.js` — one seeded RNG, full state words saved **inside** the save. Bans
  ambient `Math.random`/`Date.now`. This is what makes procgen legal. *(idea:
  seeded-rng/save-replay; memory: the-game-prologue#E1, wrong-sky#E2)*
- `sim/canonical.js` — sorted-key, NaN/Infinity-loud serialization for hashing.
- `sim/fingerprint.js` — fnv1a32 + golden value; the one cheap determinism/regression
  guard. *(idea: replay-fingerprint)*
- `sim/saga.js` — v5 import/export (§7).
- `sim/validate.js` — the authoritative validation ladder (§6).
- `sim/content.js`, `sim/world.js`, `sim/demo.js` (scripted playthrough for the hash).
- `sim/daynight.js`, `sim/visibility.js`, `sim/pathfind.js` as needed.
- Split state by determinism need: sim owns **discrete facts** (zone, HP, quest flags,
  player-model, cutscene mode); presentation owns **continuous cosmetic** (camera,
  tweens, cutscene easing). No authoritative outcome may read a float. *(idea:
  split-state-by-determinism-need)*

### New sim modules
- `sim/playermodel.js` — the ~5-axis trait vector + its fold (§5.3).
- `sim/procgen.js` — `gen(seed, genVersion) → map`, pure and seed-reproducible (§5.2).
- `sim/cutscene.js` — cutscene timeline **data** + the `cmd`-marker contract that lets
  a scene touch the sim (§5.1).
- `sim/director.js` — the beat/variant selector (Valve salience matcher, §5.3).

### App / presentation
- `app/input.js` — unified command vocabulary; every device (keyboard, touch, mouse,
  **gamepad**) translates to it; gamepad polled every frame (§8).
- `app/cutscene-player.js` — presentation-layer timeline interpreter: draws cosmetic
  tracks on its own capped-delta clock, fires `cmd` markers through the real pipeline,
  easing/letterbox/caption-VO sync (§5.1).
- `app/renderer.js`, `app/title.js` (rebuilt char creation), `app/save.js`,
  `app/device-labels.js`, `app/dither.js` (ordered/Bayer, reused).

---

## 4. Narrative structure

Fixed spine, variable surface. Audit structure for **want / opposition / stakes /
choice** before pacing or voice — a row of events plus polish is a chronicle, not a
story. *(memory: test#E10)*

**Spine (constant across every run):**
1. **Return / Intro cutscene** — the protagonist surfaces; the voice speaks first,
   already wearing what it learned of you (or, on a fresh start, blank and hungry).
2. **The world defines itself** — a small hub, then generated zones. The voice
   narrates, quoting your past when it can.
3. **The learning** — quests and encounters; every meaningful choice feeds the model.
4. **Mid reveal cutscene** — the voice shows you a reflection of yourself; the world
   gains or loses definition to match how well it now knows you.
5. **The hollow** — a final confrontation with the voice, which now answers *as you*.
6. **The choice + finale cutscene** — visualizes your accumulated saga choices and
   this run's. Exports saga.v5.

**Surface (varies):** each spine node carries 2–4 variants selected by player-model
state + saga flags. A merciful profile meets the voice differently than a ruthless
one; a fresh-start player gets the "voice knows nothing yet" surface. Only make a
node adaptive if its trigger *actually varies across players* — otherwise it is
relabeling, not adaptation. *(memory: waiting-city#E5)*

---

## 5. The three new systems (concrete)

### 5.1 Cutscenes — data, not code
A scene is a **timeline table of tracks**:
- **Cosmetic tracks** (drawn by the player, never touch sim): `camera`, `sprite`,
  `actorMove`, `particles`, `caption`, `letterbox` — each a list of keyframes sampled
  by ease curves.
- **`cmd` markers** — the ONLY way a scene changes authoritative state: it enqueues a
  command through the exact same input→`reduce` pipeline gameplay uses.

The **cutscene-player lives in the presentation layer** on its own capped-delta clock
(cap the delta so a stall can't skip a marker). Because sim outcome depends only on
*which* commands fired and *in what order* — never on cutscene wall-clock speed:
- **Skip = "fire all remaining `cmd`s now, drop the cosmetics."** Watch-vs-skip
  provably hash to the **same end state** — ship that as a test.
- Dev-scrub seeks by restoring a `t=0` snapshot (O(1) via saved RNG state words) and
  re-firing markers up to `T`.
- The golden fingerprint covers cutscene *outcomes* for free.

Tag `mode=cutscene` in sim state with **one restore-all exit path** (memory: test#E6
— modal-mode leaks). Integer-snap the camera. Keep the stray-`=` renderer-mutation
guard on (memory: test#E5).

**Captions/VO:** drive caption advance off the VO's **real speaking state**
(`SpeechSynthesis onboundary/onend`, or polled `audio.currentTime`); keep the tiny
on-screen caption **decoupled** from the full spoken line (idea: picture-book
mechanism-as-plot); use estimated reading time only as a *min-hold floor*; never
`await` audio resume on the critical path (memory: dog#E1); **verify with a full
seek-sweep**, every marker firing once with finite values, not sampled frames
(memory: test#E11/E12/E13).

**Procedural cutscene visuals stay tonally coherent** (not foreign): lock to the
shared fixed palette, simulate tone with **ordered/Bayer dither** not gradients
(idea: ordered-dither), native-res with `imageSmoothingEnabled=false` + integer
scaling, stepped ~8–12 FPS. Hand-author heroes/key backdrops; generate only
connective tissue (particles, light shafts, weather) from a **cosmetic RNG seeded
`(saveSeed, cutsceneId)` that stays OUT of the authoritative stream.**

### 5.2 Procgen — authored feel, completable by construction
Layered hybrid, not one algorithm:
1. **Mission graph first** (Dormans grammar): generate the quest spine as seeded
   rewrite rules — entry → key → gate → encounter → reward → boss/exit. This is what
   produces intentional lock/key pacing and **completability by construction**.
2. **Layout**: deterministic room packing + **MST + ~15% re-added Delaunay edges**
   (TinyKeep, physics-separation replaced by seeded packing for reproducibility).
3. **Fill** node rooms from **weighted hand-authored prefab pools** tagged by node
   type — *this is where the authored feel comes from* (idea: prefab-stitched).
4. **WFC (tiled) and cellular automata demoted** to small, bounded, local detail
   passes only — never whole-map topology (their backtracking/cost fight determinism
   and completability).

**Determinism:** `gen(seed, genVersion) → map`, pure. Continue/Restart reproduce the
identical map, never re-roll. Split per-stage sub-streams via `hash(seed, stageTag)`.
Any gen/validation failure → **bounded seed-stable retry** `hash(seed, attempt)`,
never wall-clock reseed.

**The generator is untrusted; the validator is authoritative** — extends our existing
ladder to *generated* output (memory: test#E1):
- schema sanity →
- all promised quest/interactable slots placed →
- **flood-fill reachability on the actual carved tiles** (MST-connected graph ≠
  connected tiles once prefab walls land) confirming exit + every required
  slot/key-before-gate is reachable →
- headless smoke playthrough across a seed suite (0..N) in CI.

**Soft-lock prevented structurally** (memory: prologue#E9): gen reserves
validated-reachable *slots*; `ACCEPT_QUEST` spawns targets into them → completion is
provably history-agnostic.

### 5.3 Adaptive narrative — the voice that learns you
Three small pure-function subsystems, all **folds over the event log** (deterministic,
hashable):

**(a) Player model** — a fixed ~5-axis bipolar vector:
`bold↔cautious, curious↔direct, mercy↔ruthless, candor, attachment`. Each axis is a
signed running `sum` + sample `n` (sign = lean, magnitude = confidence). Updated ONLY
inside the reducer via a `RECORD_TRAIT_SIGNAL` event carrying a **static per-choice
weight**. Stored in `save.playerModel`. The base64 saga code is parsed → validated →
**clamped** into the initial vector; malformed → degrade to zero-vector, **never
eval** (untrusted reference data; memory: chronicles#E1 atomic replace). This is the
proven no-ML "Player Traits" pattern + Dishonored context-weighted signals, sitting
directly on the repo's own `adaptive-quiz/contradiction-testing`,
`trust-as-character`, and `double-edged-signals` idea kernels.

**(b) Beat selection** — Elan Ruskin's Valve **salience/fuzzy-pattern matcher**:
facts-dictionary + criteria-rules, most-specific-rule-wins, always a 0-criteria
fallback, deterministic tie-break. Layer StoryNexus/Fallen-London **quality-based
storylets** for *which* scenes are available, plus a cheap Façade **tension** term so
pacing keeps its spine:
`score = criteriaCount·BIG − |beat.tension − targetTension(actProgress)|`. ~200 lines
of reducer code, no authored branch trees, sub-exponential content cost.

**(c) Legibility** — the world must *visibly* respond, or adaptation reads as random:
attributed **diegetic callbacks** (an NPC/the voice quoting a *specific named past
choice* via `recentSignals`/`flags`, plus saga-vs-current diff lines), balanced with
ambient axis-keyed world dressing. Rule of thumb: **one attributed reference per
adaptation stretch**; confidence-gate any "I know you…" assertion. Optionally tie the
world's own **presentation as progression** here — the world gains definition
(grayscale→palette, flat→lit) as the model sharpens (idea:
world-facets-as-reward/diegetic-restore, Wrong Sky).

Route ALL trait→text through **one `describeModel` function** — this project drifted
the same "data→player-text" logic apart twice before (memory: the-game-prologue#E4).

---

## 6. Validation & determinism strategy (one authoritative ladder)
Data-driven + generated content opts out of compile-time safety; a typo'd or
bad-gen id ships an uncompletable quest with **no error** (memory: test#E1). So:
1. **Schema** — every quest/objective/cutscene/prefab shape-checked.
2. **Referential integrity + completability** — every id resolves; every objective
   type is reachable; generated maps flood-fill-reachable (§5.2); N-choice offers
   explicitly withdraw the losers in the accept handler, not in a comment
   (memory: wrong-sky#E4); sparse maps with legit 0 values existence-checked, never
   truthy-checked (memory: wrong-sky#E5).
3. **Headless smoke playthrough** + **replay fingerprint** (golden) across a seed
   suite. Own port per concurrent run; gesture-init WebAudio (memory: test#E9).
   Re-read entity positions live before each scripted interaction (memory:
   waiting-city#E2). Cutscene watch-vs-skip hash-equality test (§5.1).

## 7. saga.v5 contract
Chain format unchanged: `SAGA<N>.base64(canonicalJSON).fnv1a32`. Phase 5 **imports
SAGA4** (archetype, difficulty, skills, coins, techniques, choices
`{ravagerFate, riftChoice, wardenFate, answererFate}`) → clamps into the initial
player-model and world seed → **exports SAGA5**, appending this run's own final
choice. Import is an **atomic full-seed**, never a piecemeal merge (memory:
chronicles#E1). A fresh start is always valid — the code is a courtesy, never a wall —
and drives the "voice knows nothing yet" surface. Downloadable file + paste + optional
`#code=` URL hash (idea: share-codes-not-accounts).

## 8. UI rebuild — gamepad-first, not a patch
The old char-creation screen never worked on a gamepad (only the first line
selectable; A starts the game; hardship unchoosable). Root cause is the
`test#E3` / `the-game-prologue#E6` family. **Rebuild the whole front-end input** per
the `unified-command-vocabulary` + `device-adaptive-ui` ideas:
- Every device → one small command vocabulary; adding a device is a thin adapter.
- **Poll `navigator.getGamepads()` every frame** — Chrome hides the pad until a
  button press (that IS the bug). Menus navigable by **both** stick (debounced) **and**
  D-pad. Label on-screen buttons with **words, not glyphs**.
- Capture presses at **event time into a pending queue**, not by sampling held state
  once per frame — sub-frame taps must register (memory: the-game-prologue#E2).
- Key-hint text recomputed from the **active device at render time**, not baked at
  construct time (memory: the-game-prologue#E3, #E6).
- One-shot "press" must fire for **dynamic-id UI zones** (title, char-create, saga
  import), not only the fixed held-action vocabulary (memory: the-game-prologue#E6).
- Char creation, pause, cutscene-skip, and saga-import all route through **one
  modal-mode discipline** with a single restore-all dismissal (memory: test#E6).
- Mobile: `100dvh/dvw`; fit world scale to `Math.min(W,H)`; verify on a real portrait
  viewport (memory: wrong-sky#E7, waiting-city#E7).
- "New Game" rebuilds the world via the real constructor/reset path (memory: dbh#E4);
  restart-on-death restores a run-start snapshot, never `makeWorld(...)` with empty
  options, and never autosaves an ended world (memory: wrong-sky#E2).

## 9. Preserved tension (Brain surfaced a real disagreement — human decides)
`ideas: effect-gated-not-existence-gated` (Wrong Sky) says *all* interactables exist
from the start and you gate the **effect** — early wrong interaction is a *feature*
(discovery clues). `memory: the-game-prologue#E9` says existence-gate quest targets so
pre-acceptance actions can't soft-lock — early access is a *bug*. Same spawn-everything
vs spawn-on-demand question, opposite answers, because one protects *discovery* and the
other protects *quest integrity*. Phase 5 has both kinds of object. **Decision: apply
per-object, not globally** — discovery clues use effect-gating; quest targets use
existence/slot-gating. Flagged here so it's a choice, not an accident.

## 10. Build plan (proven pass structure)
Each pass: build → **in-browser verify the real flow** (screenshot; full seek-sweep for
anything time-based) → smoke test + fingerprint → commit → next. Deploy to Pages; if
the dynamic branch-source run hangs queued, add an explicit Pages Actions workflow
(memory: dbh#E6). Bust every nested ESM import at deploy, render a visible build id
(memory: the-game-prologue#E8).

- **P0 Scaffold** — repo skeleton, CLAUDE.md (Brain link), reducer/RNG/canonical/
  fingerprint/saga.v5, validation ladder, dev server, Pages workflow, golden hash.
- **P1 Input + UI rebuild** — unified vocabulary, gamepad poll, device-adaptive UI,
  rebuilt gamepad-first char creation, modal-mode discipline.
- **P2 Player-model** — trait vector, `RECORD_TRAIT_SIGNAL`, `describeModel`, saga
  import→clamp.
- **P3 Procgen** — mission-graph → layout → prefab fill → validator; seed suite in CI.
- **P4 Director** — salience matcher + storylets + tension; adaptive dialog surface;
  legibility callbacks.
- **P5 Cutscenes** — timeline data + player, `cmd` markers, caption/VO sync,
  watch-vs-skip hash test; intro + mid + finale scenes.
- **P6 Content + world facets** — the retelling's spine + variants; presentation-as-
  progression; export saga.v5.
- **P7 Integration + QA** — full playthrough, mobile/portrait, Pages deploy, Brain
  write-back of what clears the bar.

## 11. Risks
- **Scope.** This is the most ambitious phase. Mitigation: the pass plan ships a
  playable slice each pass; procgen/cutscene/adaptive are additive on a working spine.
- **Adaptation legibility.** If players can't see the voice responding, it's wasted.
  Mitigation: the attributed-callback rule + confidence gating; verify by playing two
  opposite profiles and diffing what the voice says.
- **Generated-content quality.** Mitigation: prefab pools carry the authored feel; the
  validator is authoritative; seed suite in CI.
- **Determinism leaks** from three new systems. Mitigation: all folds over the event
  log, all randomness through the one seeded stream, the golden fingerprint + the
  cutscene hash-equality test catch divergence loudly.
