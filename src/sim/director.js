// The beat/variant selector — a salience/fuzzy-pattern matcher (Elan Ruskin,
// Valve): content is a flat list of beats, each gated by criteria over a facts
// dictionary; the most-specific eligible beat wins, ties broken by tension-fit
// then recency then id. Pure function of (facts, beats, opts) -> beatId, so it
// stays a fold over state exactly like the reducer it lives beside.
// Precedent: research-adaptive.md §2a/2c; ideas has no exact match, this is new
// territory the research brief maps directly onto our reducer shape.
//
// This module holds the MECHANISM (selectBeat); actual beat CONTENT (text,
// spine placement) is data added in a later pass — same content-meets-code
// seam as objective TYPES vs quest instances.

import { AXES } from './world.js';
import { describeModel } from './playermodel.js';

// Flatten world state into the flat facts dictionary criteria match against.
// Keys are dotted so criteria stay simple {key, op, value} triples.
export function buildFacts(world) {
  const model = describeModel(world.playerModel);
  const facts = { tick: world.tick };
  for (const axis of Object.keys(AXES)) {
    facts[`${axis}.word`] = model[axis].word;
    facts[`${axis}.lean`] = model[axis].lean;
    facts[`${axis}.n`] = model[axis].n;
    facts[`${axis}.confident`] = model[axis].confident;
  }
  for (const [k, v] of Object.entries(world.flags)) facts[`flags.${k}`] = v;
  for (const [k, v] of Object.entries(world.facets)) facts[`facets.${k}`] = v;
  return facts;
}

// One criterion: { key, eq|neq|gte|lte|gt|lt|truthy }. An unrecognized/missing
// operator fails CLOSED (never silently passes) — a typo'd criterion should
// make a beat ineligible, not accidentally universal.
function matches(facts, criterion) {
  const val = facts[criterion.key];
  if ('eq' in criterion) return val === criterion.eq;
  if ('neq' in criterion) return val !== criterion.neq;
  if ('gte' in criterion) return typeof val === 'number' && val >= criterion.gte;
  if ('lte' in criterion) return typeof val === 'number' && val <= criterion.lte;
  if ('gt' in criterion) return typeof val === 'number' && val > criterion.gt;
  if ('lt' in criterion) return typeof val === 'number' && val < criterion.lt;
  if ('truthy' in criterion) return !!val === criterion.truthy;
  return false;
}

export function eligible(facts, beat) {
  return (beat.criteria || []).every((c) => matches(facts, c));
}

// selectBeat: staged filtering, not a blended score, so "most specific wins"
// can't be silently reordered by a magic-number tension weight.
//   1. eligible only (all criteria pass)
//   2. keep the MOST criteria (most-specific-rule-wins)
//   3. among those, keep the best tension-fit to opts.targetTension (§2c)
//   4. prefer a beat NOT recently played, if any remain (LRU, avoids looping)
//   5. deterministic id tie-break (never RNG — stays a pure fn of facts+beats)
// Returns null if nothing is eligible — content is responsible for shipping a
// 0-criteria fallback beat per spine node so this stays rare.
export function selectBeat(facts, beats, opts = {}) {
  let pool = (opts.spineNode ? beats.filter((b) => b.spineNode === opts.spineNode) : beats.slice())
    .filter((b) => eligible(facts, b));
  if (pool.length === 0) return null;

  const maxCriteria = Math.max(...pool.map((b) => (b.criteria || []).length));
  pool = pool.filter((b) => (b.criteria || []).length === maxCriteria);

  const targetTension = typeof opts.targetTension === 'number' ? opts.targetTension : 0.5;
  const tensionOf = (b) => Math.abs((typeof b.tension === 'number' ? b.tension : 0.5) - targetTension);
  const minTension = Math.min(...pool.map(tensionOf));
  pool = pool.filter((b) => tensionOf(b) === minTension);

  const lastPlayed = (opts.lastPlayed) || {};
  const unseen = pool.filter((b) => !(b.id in lastPlayed));
  if (unseen.length > 0) pool = unseen;

  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool[0].id;
}
