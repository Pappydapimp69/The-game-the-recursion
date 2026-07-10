// The retelling's content: data only, per the content-meets-code seam (beat/
// objective TYPES are code in director.js/reduce.js; instances live here). The
// fixed spine stays constant (PROPOSAL §4); only these variants vary, selected
// by the director from the live player-model, so two players who became
// different people see a different telling of the same story.
//
// SPINE_STAGE_NAMES is documentation/logging only; reduce.js gates transitions
// structurally so the mechanism never imports this file.
export const SPINE_STAGE_NAMES = ['intro', 'learning', 'reveal', 'hollow', 'finale', 'done'];

// How many descent levels deep 'learning' goes. Each is its own procedurally
// generated floor (main.js sizes its mission-spec by depth), with its own
// enemies and its own slice of CHOICE_POINTS below. Kept small deliberately
// (research: escalate via a new mechanic per level, not a longer grind) — four
// floors, each introducing exactly one new pressure.
export const MAX_DEPTH = 4;

// The encounter-echo's quest: how many lost voices are scattered to be found
// and delivered, spread across all four floors (roughly two per floor).
export const ECHO_COUNT = 8;

// Which player ability unlocks on ARRIVING at a given depth (i.e. right after
// ADVANCE_DEPTH lands on it), and the input it's bound to during exploration.
// Depth 1 has no ability yet — you meet the hollow's reach with nothing but
// your legs, same as the original single-floor game; each floor after that
// hands you exactly one new tool; the last, hardest floor asks you to use
// all three at once.
export const ABILITIES = [
  { id: 'pulse', unlockDepth: 2, press: 'action',
    name: 'pulse', verb: 'pulse',
    blurb: 'A push of light that startles anything close and buys you a moment.' },
  { id: 'dash', unlockDepth: 3, press: 'confirm',
    name: 'dash', verb: 'dash',
    blurb: 'A burst of speed in the direction you’re already facing.' },
  { id: 'ward', unlockDepth: 4, press: 'cancel',
    name: 'ward', verb: 'ward',
    blurb: 'A held breath of safety around you, for as long as it lasts.' },
];

// "The learning": choice points scattered across the four floors, feeding all
// five axes — mercy and resolve recur on floor 1 so a consistent player builds
// a lean the reveal can actually name; the three deeper floors each add a pair
// so attachment (previously never fed by any choice — a real gap, closed here)
// gets the same weight as everything else. Reached by walking; picking an
// option records its signed weight (CHOOSE_OPTION).
export const CHOICE_POINTS = [
  // --- depth 1: the original six, unchanged ---
  {
    id: 'cp-shadow', depth: 1,
    prompt: 'A shape moves at the edge of the light — low, quiet, keeping pace with you.',
    options: [
      { label: 'Go to it. Whatever it is, meet it.', axis: 'resolve', weight: 1 },
      { label: 'Hold still. Let it show itself first.', axis: 'resolve', weight: -1 },
    ],
  },
  {
    id: 'cp-name', depth: 1,
    prompt: 'The dark forms a question in your own voice: it wants your name.',
    options: [
      { label: 'Give it, plainly. Names are only sounds.', axis: 'candor', weight: 1 },
      { label: 'Give it a false one. Keep the true one back.', axis: 'candor', weight: -1 },
    ],
  },
  {
    id: 'cp-echo', depth: 1,
    prompt: 'A smaller echo is caught in the stone, thinning, asking to be let go.',
    options: [
      { label: 'Loosen the stone. Let it come apart in peace.', axis: 'mercy', weight: 1 },
      { label: 'Take what it knows first. It owes you that.', axis: 'mercy', weight: -1 },
    ],
  },
  {
    id: 'cp-deeper', depth: 1,
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
    id: 'cp-drowned', depth: 1,
    prompt: 'Another echo, further gone, mistakes you for someone it loved.',
    options: [
      { label: 'Let it. Be that person for the moment it has left.', axis: 'mercy', weight: 1 },
      { label: 'Correct it. It should know what it is talking to.', axis: 'mercy', weight: -1 },
    ],
  },
  {
    id: 'cp-door', depth: 1,
    prompt: 'A shut door, and something patient breathing on the far side of it.',
    options: [
      { label: 'Open it. You did not come this far to knock.', axis: 'resolve', weight: 1 },
      { label: 'Leave it shut. Not every door is yours to open.', axis: 'resolve', weight: -1 },
    ],
  },

  // --- depth 2: the pull of things you could carry ---
  {
    id: 'cp-tether', depth: 2,
    prompt: 'Something down here remembers being held. It reaches for your hand the way something small does.',
    options: [
      { label: 'Take it. Let it walk beside you a while.', axis: 'attachment', weight: 1 },
      { label: "Don't. You can't carry every drowned thing.", axis: 'attachment', weight: -1 },
    ],
  },
  {
    id: 'cp-mirror', depth: 2,
    prompt: 'The dark shows you a version of yourself that already gave up. It asks which of you is true.',
    options: [
      { label: 'Tell it plainly: neither, yet.', axis: 'candor', weight: 1 },
      { label: 'Say nothing. Let it wonder.', axis: 'candor', weight: -1 },
    ],
  },

  // --- depth 3: the tension sharpens — something else is listening now ---
  {
    id: 'cp-warning', depth: 3,
    prompt: "Something shrieks in the middle distance — not at you, at whatever's behind you.",
    options: [
      { label: 'Move toward the sound. Better to know.', axis: 'resolve', weight: 1 },
      { label: 'Move away from it. Some doors stay shut.', axis: 'resolve', weight: -1 },
    ],
  },
  {
    id: 'cp-keep', depth: 3,
    prompt: "A locket-shaped stone, warm despite the cold. It isn't yours, and it doesn't want to be found.",
    options: [
      { label: 'Keep it anyway. Something should be kept.', axis: 'attachment', weight: 1 },
      { label: 'Leave it where it lay.', axis: 'attachment', weight: -1 },
    ],
  },

  // --- depth 4: the last floor, one door from the hollow ---
  {
    id: 'cp-last-mercy', depth: 4,
    prompt: "The last echo before the hollow's door isn't scattered like the rest — it's whole, and afraid, and asks you to wait with it.",
    options: [
      { label: "Wait. There's time enough for that.", axis: 'mercy', weight: 1 },
      { label: "There isn't. Go.", axis: 'mercy', weight: -1 },
    ],
  },
  {
    id: 'cp-threshold', depth: 4,
    prompt: "The door to the hollow doesn't need opening — it's already open, and has been the whole time.",
    options: [
      { label: 'Go through without stopping to wonder why.', axis: 'inquiry', weight: -1 },
      { label: 'Stop. Wonder why, first.', axis: 'inquiry', weight: 1 },
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
// director.buildFacts); finale on the ending taken; depth-transition on which
// floor was just reached.
export const BEATS = [
  // --- intro: does the voice already know you? ---
  { id: 'intro-imported', spineNode: 'intro', criteria: [{ key: 'imported', eq: true }], tension: 0.35,
    lines: ['You surface, and the voice is already speaking — it kept the shape of you from before.',
      'It says your name the way you used to say it. Then it waits to see what you are this time.'] },
  { id: 'intro-fresh', spineNode: 'intro', criteria: [{ key: 'imported', eq: false }], tension: 0.2,
    lines: ["You surface into a world that hasn't been defined yet.",
      "The voice is quiet. It doesn't know you. Not yet — but it is listening."] },
  { id: 'intro-default', spineNode: 'intro', criteria: [], tension: 0.2, lines: ['You surface. The deep lets you go, this once.'] },

  // --- depth-transition: short beats between floors, keyed on the depth just
  // reached. Purely atmospheric — no mechanical asides (main.js shows an
  // "ability unlocked" note on its own UI layer, never baked into the prose). ---
  { id: 'descend-2', spineNode: 'depth-transition', criteria: [{ key: 'depth', eq: 2 }], tension: 0.4,
    lines: ['The floor drops away and you go with it, the fall no longer feeling like falling.',
      'Something down here notices you differently now — like a held breath, deciding whether to let go.'] },
  { id: 'descend-3', spineNode: 'depth-transition', criteria: [{ key: 'depth', eq: 3 }], tension: 0.5,
    lines: ["Deeper, the dark stops being empty. You can feel it arranging itself around you, patient and particular.",
      "Somewhere close, something that isn't the voice is listening too."] },
  { id: 'descend-4', spineNode: 'depth-transition', criteria: [{ key: 'depth', eq: 4 }], tension: 0.65,
    lines: ["This is the last floor before whatever's wearing your shape. You can feel it through the stone, the way you'd feel a held door.",
      "Everything you've carried this far comes down to this one last distance."] },
  { id: 'descend-default', spineNode: 'depth-transition', criteria: [], tension: 0.4,
    lines: ['You descend further. The dark reorganizes itself around the shape of you.'] },

  // --- reveal: the voice shows you the shape it has learned ---
  { id: 'reveal-bold', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'resolve' }, { key: 'dominantWord', eq: 'bold' }], tension: 0.6,
    lines: ['It shows you yourself: a figure already moving, already committed, before the light has finished arriving.',
      'It does not show you afraid, even once. You wonder if that means you never were, or only never let it see.'] },
  { id: 'reveal-cautious', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'resolve' }, { key: 'dominantWord', eq: 'cautious' }], tension: 0.55,
    lines: ['It shows you yourself: a figure held very still, letting the dark declare itself first, giving nothing away.',
      "That stillness kept you alive down here more than once. It doesn't say so, but it knows, and so do you."] },
  { id: 'reveal-merciful', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'mercy' }, { key: 'dominantWord', eq: 'merciful' }], tension: 0.6,
    lines: ['It shows you yourself: a hand that opened more often than it closed, down here where nothing else would have.',
      'Every drowned thing you touched, it remembers you touching gently. It has never seen that before.'] },
  { id: 'reveal-ruthless', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'mercy' }, { key: 'dominantWord', eq: 'ruthless' }], tension: 0.65,
    lines: ['It shows you yourself: a hand that took what it needed and did not stay to watch the cost.',
      "It doesn't judge you for that. Down here, judgment is a luxury nothing can afford."] },
  { id: 'reveal-curious', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'inquiry' }, { key: 'dominantWord', eq: 'curious' }], tension: 0.55,
    lines: ['It shows you yourself: someone who always chose the longer dark, who had to know how far down it went.',
      'It has never had anyone ask it a question back. It is still deciding how that feels.'] },
  { id: 'reveal-direct', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'inquiry' }, { key: 'dominantWord', eq: 'direct' }], tension: 0.5,
    lines: ['It shows you yourself: someone who came for one thing and refused every other door, and left.',
      'It respects that more than it expected to. Down here, wanting one thing cleanly is its own kind of rare.'] },
  { id: 'reveal-candid', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'candor' }, { key: 'dominantWord', eq: 'candid' }], tension: 0.5,
    lines: ['It shows you yourself: someone who answered plainly even to the dark, who spent the truth like it was cheap.',
      'Nothing you told it was ever tested twice. It never needed to.'] },
  { id: 'reveal-guarded', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'candor' }, { key: 'dominantWord', eq: 'guarded' }], tension: 0.55,
    lines: ['It shows you yourself: someone who kept the true name back, who let it hold only the shell of you.',
      'It learned the shell well. It still doesn’t know what the shell was protecting.'] },
  { id: 'reveal-attached', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'attachment' }, { key: 'dominantWord', eq: 'attached' }], tension: 0.6,
    lines: ['It shows you yourself: someone who kept picking things up down here, and could not make themselves stop.',
      'Your hands, in its memory of you, are never quite empty.'] },
  { id: 'reveal-detached', spineNode: 'reveal', criteria: [{ key: 'dominant', eq: 'attachment' }, { key: 'dominantWord', eq: 'detached' }], tension: 0.55,
    lines: ['It shows you yourself: someone who came down empty-handed and meant to leave the same way.',
      "It isn't sure yet whether that's discipline or its opposite. Neither, quite, are you."] },
  { id: 'reveal-unsure', spineNode: 'reveal', criteria: [], tension: 0.5,
    lines: ["It shows you yourself, and holds it there a moment.", "It isn't sure yet what it's looking at. Neither, quite, are you."] },

  // --- finale: shaped by the ending taken, deepened by the voices you saved ---
  { id: 'finale-listen-saved', spineNode: 'finale', criteria: [{ key: 'arc.choice', eq: 'listen' }, { key: 'quest.savedAll', eq: true }], tension: 0.95,
    lines: ['You let it speak — and it speaks in more than its own voice now, for you carried the drowned ones up with you.',
      'A chorus goes to the surface where one figure went down. None of them casts a shadow but yours.'] },
  { id: 'finale-silence-saved', spineNode: 'finale', criteria: [{ key: 'arc.choice', eq: 'silence' }, { key: 'quest.savedAll', eq: true }], tension: 0.9,
    lines: ['You silence the one that wore you, but the lost voices you gathered you do not silence — you carry them out yourself.',
      'The deep goes quiet behind you. What you brought up with you does not.'] },
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
