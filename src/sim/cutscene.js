// The SIM-SIDE cutscene contract. A cutscene is DATA, not code: a timeline of
// `cmd` markers (each { atMs, cmd } where cmd is a NORMAL command dispatched
// through the SAME reduce() pipeline gameplay uses) plus opaque cosmeticTracks
// the presentation player interprets. Markers are the ONLY way a scene touches
// authoritative state — so the sim outcome depends only on WHICH cmds fired and
// IN WHAT ORDER, never on the cutscene's wall-clock speed. That is what makes
// watch and skip provably hash to the same end state.
// Precedent: research-cutscenes.md §4 (clock contract); ideas split-state-by-
// determinism-need; PROPOSAL §5.1.
//
// Scene shape:
//   {
//     id: string,
//     totalMs: number,              // authoritative length of the scene
//     cmdMarkers: [{ atMs, cmd }],  // atMs = when it fires; cmd = reducer command
//     cosmeticTracks: { ... }       // opaque to the sim; the player draws these,
//   }                               // they NEVER reach reduce()

// Markers sorted by fire time, ties broken by original index — a stable, total
// order so "in what order" is well-defined regardless of authoring order.
function orderedMarkers(scene) {
  return (scene.cmdMarkers || [])
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.atMs - b.m.atMs) || (a.i - b.i))
    .map((x) => x.m);
}

// Every marker that should have fired by `ms` (atMs <= ms), in fire order. Pure
// function of (scene, ms) — the basis for both watch and skip and for a dev
// seek: firing a marker is decided by atMs alone, nothing else.
export function firedMarkersUpTo(scene, ms) {
  return orderedMarkers(scene).filter((m) => m.atMs <= ms);
}

// Markers newly crossed by advancing the clock from prevMs to curMs — the
// half-open window (prevMs, curMs]. The player calls this each frame; because
// the windows are contiguous and non-overlapping, a monotonic sweep fires each
// marker EXACTLY once. Start prevMs below 0 (e.g. -1) so an atMs:0 marker fires.
export function markersInWindow(scene, prevMs, curMs) {
  return orderedMarkers(scene).filter((m) => m.atMs > prevMs && m.atMs <= curMs);
}
