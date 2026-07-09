// The retelling's actual content: data only, per the content-meets-code seam
// (objective/beat TYPES are code in director.js/reduce.js; specific instances
// live here). A vertical slice of the fixed spine (PROPOSAL §4) — five stages,
// 2-3 variants each — proving the whole design closes, not a full quest catalog.
//
// SPINE_STAGE_NAMES is documentation/logging only; reduce.js's ADVANCE_SPINE
// gates transitions structurally (learningIdx, flags.ended) so it never needs
// to import this file — the mechanism stays content-agnostic.
export const SPINE_STAGE_NAMES = ['intro', 'learning', 'reveal', 'hollow', 'finale', 'done'];

// "The learning" (stage 1): a handful of choices that feed the player-model.
// Each option carries the axis + weight recorded via CHOOSE_OPTION.
export const CHOICE_POINTS = [
  {
    id: 'cp-shadow',
    prompt: 'A shadow moves at the edge of the light.',
    options: [
      { label: 'Chase it down.', axis: 'resolve', weight: 1 },
      { label: 'Wait and watch.', axis: 'resolve', weight: -1 },
    ],
  },
  {
    id: 'cp-name',
    prompt: 'Something in the dark asks for your name.',
    options: [
      { label: 'Give it freely.', axis: 'candor', weight: 1 },
      { label: 'Refuse to answer.', axis: 'candor', weight: -1 },
    ],
  },
  {
    id: 'cp-echo',
    prompt: 'A weaker echo of the voice begs to be let go.',
    options: [
      { label: 'Release it, gently.', axis: 'mercy', weight: 1 },
      { label: 'Silence it for good.', axis: 'mercy', weight: -1 },
    ],
  },
];

// "The hollow" (stage 3): the finale choice. Dispatched as END({choice}) — the
// same command saga.js already requires to export, so no parallel "pending
// choice" state is needed.
export const ENDINGS = [
  { id: 'listen', label: 'Let it speak.' },
  { id: 'silence', label: 'Silence it.' },
];

// Beat variants for the director (§5.3). One 0-criteria fallback per node
// guarantees selectBeat never returns null on the spine. Deliberately kept to
// single-criterion variants for this vertical slice — a later pass can widen
// to 2-criteria combos for finer selection; ties then fall to the tension/id
// tie-breaks in director.js, which is a content-tuning question, not a bug.
export const BEATS = [
  { id: 'intro-fresh', spineNode: 'intro', criteria: [{ key: 'imported', eq: false }], tension: 0.2,
    lines: ["You surface into a world that hasn't been defined yet.", "The voice says nothing. It doesn't know you. Not yet."] },
  { id: 'intro-imported', spineNode: 'intro', criteria: [{ key: 'imported', eq: true }], tension: 0.3,
    lines: ['You surface. The voice is already speaking — it remembers the shape of you from before.', 'It begins again, wearing what it learned.'] },
  { id: 'intro-default', spineNode: 'intro', criteria: [], tension: 0.2, lines: ['You surface.'] },

  { id: 'reveal-merciful', spineNode: 'reveal', criteria: [{ key: 'mercy.word', eq: 'merciful' }], tension: 0.6,
    lines: ['It shows you yourself: a hand that opens more than it closes.'] },
  { id: 'reveal-ruthless', spineNode: 'reveal', criteria: [{ key: 'mercy.word', eq: 'ruthless' }], tension: 0.6,
    lines: ['It shows you yourself: a hand that closes more than it opens.'] },
  { id: 'reveal-bold', spineNode: 'reveal', criteria: [{ key: 'resolve.word', eq: 'bold' }], tension: 0.55,
    lines: ['It shows you yourself: you moved before you understood, every time.'] },
  { id: 'reveal-default', spineNode: 'reveal', criteria: [], tension: 0.5,
    lines: ["It shows you yourself. It isn't sure yet what it's looking at."] },

  { id: 'finale-listen', spineNode: 'finale', criteria: [{ key: 'arc.choice', eq: 'listen' }], tension: 0.9,
    lines: ['You let it speak. Whatever comes next, it comes in a voice that is almost yours.'] },
  { id: 'finale-silence', spineNode: 'finale', criteria: [{ key: 'arc.choice', eq: 'silence' }], tension: 0.9,
    lines: ["You silence it. The world goes quiet in a way it hasn't been before."] },
  { id: 'finale-default', spineNode: 'finale', criteria: [], tension: 0.8, lines: ['It ends, one way or another.'] },
];
