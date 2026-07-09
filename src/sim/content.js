// The retelling's content: data only, per the content-meets-code seam (beat/
// objective TYPES are code in director.js/reduce.js; instances live here). The
// fixed spine stays constant (PROPOSAL §4); only these variants vary, selected
// by the director from the live player-model, so two players who became
// different people see a different telling of the same story.
//
// SPINE_STAGE_NAMES is documentation/logging only; reduce.js gates transitions
// structurally so the mechanism never imports this file.
export const SPINE_STAGE_NAMES = ['intro', 'learning', 'reveal', 'hollow', 'finale', 'done'];

// "The learning": six choice points scattered across the map (the four interior
// slots plus two more floor tiles), feeding four axes — with mercy and resolve
// asked twice so a consistent player builds a lean the reveal can actually name.
// Reached by walking; picking an option records its signed weight (CHOOSE_OPTION).
export const CHOICE_POINTS = [
  {
    id: 'cp-shadow',
    prompt: 'A shape moves at the edge of the light — low, quiet, keeping pace with you.',
    options: [
      { label: 'Go to it. Whatever it is, meet it.', axis: 'resolve', weight: 1 },
      { label: 'Hold still. Let it show itself first.', axis: 'resolve', weight: -1 },
    ],
  },
  {
    id: 'cp-name',
    prompt: 'The dark forms a question in your own voice: it wants your name.',
    options: [
      { label: 'Give it, plainly. Names are only sounds.', axis: 'candor', weight: 1 },
      { label: 'Give it a false one. Keep the true one back.', axis: 'candor', weight: -1 },
    ],
  },
  {
    id: 'cp-echo',
    prompt: 'A smaller echo is caught in the stone, thinning, asking to be let go.',
    options: [
      { label: 'Loosen the stone. Let it come apart in peace.', axis: 'mercy', weight: 1 },
      { label: 'Take what it knows first. It owes you that.', axis: 'mercy', weight: -1 },
    ],
  },
  {
    id: 'cp-deeper',
    prompt: 'The floor opens on a longer dark below — the way down, or the way on.',
    options: [
      { label: 'Down. You want to see how far this goes.', axis: 'inquiry', weight: 1 },
      { label: 'On. You came for one thing, not every thing.', axis: 'inquiry', weight: -1 },
    ],
  },
  // Two axes recur (mercy, resolve) so a consistent player builds a real lean the
  // reveal can name — how you treat the drowning, and how you meet the unknown,
  // are the chapter's load-bearing questions, asked twice.
  {
    id: 'cp-drowned',
    prompt: 'Another echo, further gone, mistakes you for someone it loved.',
    options: [
      { label: 'Let it. Be that person for the moment it has left.', axis: 'mercy', weight: 1 },
      { label: 'Correct it. It should know what it is talking to.', axis: 'mercy', weight: -1 },
    ],
  },
  {
    id: 'cp-door',
    prompt: 'A shut door, and something patient breathing on the far side of it.',
    options: [
      { label: 'Open it. You did not come this far to knock.', axis: 'resolve', weight: 1 },
      { label: 'Leave it shut. Not every door is yours to open.', axis: 'resolve', weight: -1 },
    ],
  },
];

// "The hollow": the finale choice. Dispatched as END({choice}); the finale
// cutscene and its beats key on which one you took, and the saga.v5 code carries
// it forward as this game's fate.
export const ENDINGS = [
  { id: 'listen', label: 'Let it speak. Hear the voice out, even in your shape.' },
  { id: 'answer', label: 'Answer it. Meet it with a voice of your own.' },
  { id: 'silence', label: 'Silence it. Take back what it stole and go.' },
];

// Beat variants. One 0-criteria fallback per spine node guarantees selectBeat
// never returns null on the spine. Intro keys on whether a prior run was
// imported; reveal on the DOMINANT trait (a reliable single pick, from
// director.buildFacts); finale on the ending taken.
export const BEATS = [
  // --- intro: does the voice already know you? ---
  { id: 'intro-imported', spineNode: 'intro', criteria: [{ key: 'imported', eq: true }], tension: 0.35,
    lines: ['You surface, and the voice is already speaking — it kept the shape of you from before.',
      'It says your name the way you used to say it. Then it waits to see what you are this time.'] },
  { id: 'intro-fresh', spineNode: 'intro', criteria: [{ key: 'imported', eq: false }], tension: 0.2,
    lines: ["You surface into a world that hasn't been defined yet.",
      "The voice is quiet. It doesn't know you. Not yet — but it is listening."] },
  { id: 'intro-default', spineNode: 'intro', criteria: [], tension: 0.2, lines: ['You surface. The deep lets you go, this once.'] },

  // --- reveal: the voice shows you the shape it has learned ---
  { id: 'reveal-bold', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'resolve' }, { key: 'dominantWord', eq: 'bold' }], tension: 0.6,
    lines: ['It shows you yourself: a figure already moving, already committed, before the light has finished arriving.'] },
  { id: 'reveal-cautious', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'resolve' }, { key: 'dominantWord', eq: 'cautious' }], tension: 0.55,
    lines: ['It shows you yourself: a figure held very still, letting the dark declare itself first, giving nothing away.'] },
  { id: 'reveal-merciful', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'mercy' }, { key: 'dominantWord', eq: 'merciful' }], tension: 0.6,
    lines: ['It shows you yourself: a hand that opened more often than it closed, down here where nothing else would have.'] },
  { id: 'reveal-ruthless', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'mercy' }, { key: 'dominantWord', eq: 'ruthless' }], tension: 0.65,
    lines: ['It shows you yourself: a hand that took what it needed and did not stay to watch the cost.'] },
  { id: 'reveal-curious', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'inquiry' }, { key: 'dominantWord', eq: 'curious' }], tension: 0.55,
    lines: ['It shows you yourself: someone who always chose the longer dark, who had to know how far down it went.'] },
  { id: 'reveal-direct', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'inquiry' }, { key: 'dominantWord', eq: 'direct' }], tension: 0.5,
    lines: ['It shows you yourself: someone who came for one thing and refused every other door, and left.'] },
  { id: 'reveal-candid', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'candor' }, { key: 'dominantWord', eq: 'candid' }], tension: 0.5,
    lines: ['It shows you yourself: someone who answered plainly even to the dark, who spent the truth like it was cheap.'] },
  { id: 'reveal-guarded', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'candor' }, { key: 'dominantWord', eq: 'guarded' }], tension: 0.55,
    lines: ['It shows you yourself: someone who kept the true name back, who let it hold only the shell of you.'] },
  { id: 'reveal-unsure', spineNode: 'reveal', criteria: [], tension: 0.5,
    lines: ["It shows you yourself, and holds it there a moment.", "It isn't sure yet what it's looking at. Neither, quite, are you."] },

  // --- finale: shaped by the ending taken ---
  { id: 'finale-listen', spineNode: 'finale', criteria: [{ key: 'arc.choice', eq: 'listen' }], tension: 0.9,
    lines: ['You let it speak. Whatever comes next comes in a voice that is almost yours — close enough to trust, close enough to fear.',
      'The two of you go up together. Only one of you casts a shadow.'] },
  { id: 'finale-answer', spineNode: 'finale', criteria: [{ key: 'arc.choice', eq: 'answer' }], tension: 0.95,
    lines: ['You answer it — not its words, your own. For the first time the deep hears a voice it did not make.',
      'Something in it settles, or breaks. From here you cannot tell the difference, and you climb anyway.'] },
  { id: 'finale-silence', spineNode: 'finale', criteria: [{ key: 'arc.choice', eq: 'silence' }], tension: 0.9,
    lines: ["You silence it. The quiet that follows is a kind you haven't heard since before it learned to answer.",
      'You take back the sound of your own name and carry it up, alone, the way you came.'] },
  { id: 'finale-default', spineNode: 'finale', criteria: [], tension: 0.8, lines: ['It ends, one way or another, and the surface is still up there waiting.'] },
];
