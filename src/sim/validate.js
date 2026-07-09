// The authoritative validation ladder. Data-driven AND generated content opts
// out of compile-time safety: a typo'd id or a bad-gen map ships an uncompletable
// quest with NO error, moving failure from the compiler to the player (test#E1).
// So every content/gen change must clear, in order:
//   1. schema        — shape is well-formed
//   2. refint         — every id resolves; every objective type is reachable;
//                       generated maps are flood-fill reachable to exit + all
//                       required slots (P3 adds the map walkers)
//   3. smoke          — headless scripted playthrough + golden fingerprint (smoke.mjs)
// This module holds 1 and 2 as pure functions returning a list of problems
// (empty = pass). The reducer/content define the vocabularies; this only checks.

// Objective types the reducer knows how to complete. Adding a new mechanic adds
// a case in reduce.js AND an entry here — the two are meant to move together.
export const OBJECTIVE_TYPES = new Set(['reach', 'talk', 'collect', 'defeat', 'restore', 'choose']);

// Validate the static content table (quests, etc.). Returns string[] of problems.
export function validateContent(content) {
  const problems = [];
  const quests = (content && content.quests) || {};
  const ids = new Set(Object.keys(quests));

  for (const [qid, q] of Object.entries(quests)) {
    if (!q || typeof q !== 'object') { problems.push(`quest ${qid}: not an object`); continue; }
    if (!Array.isArray(q.objectives) || q.objectives.length === 0) {
      problems.push(`quest ${qid}: needs at least one objective`);
    }
    for (const [i, o] of (q.objectives || []).entries()) {
      if (!OBJECTIVE_TYPES.has(o && o.type)) {
        problems.push(`quest ${qid} objective ${i}: unknown type ${o && o.type}`);
      }
    }
    // Prereq edges (AND: requires / OR: requiresAny) must reference real quests.
    for (const edge of ['requires', 'requiresAny']) {
      for (const dep of (q[edge] || [])) {
        if (!ids.has(dep)) problems.push(`quest ${qid}: ${edge} -> unknown quest ${dep}`);
      }
    }
  }
  return problems;
}

// Assert helper for the smoke harness: throw if any problems.
export function assertValid(label, problems) {
  if (problems.length) {
    throw new Error(`${label} failed validation:\n  - ${problems.join('\n  - ')}`);
  }
}
