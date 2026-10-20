/** Well-known YouTube creators' editing styles, as recipes in Gumbo's own terms: the composer's @ menu offers them, and
 * the agent's study_creator tool returns the matching recipe beside what YouTube says about the channel. Each recipe is a
 * public, general description of how the creator's videos are cut and look: it guides the edit and never copies their
 * footage, logos or music. Caption styles, transitions, filters and sound presets are named as the editor knows them. */
export type CreatorStyle={handle:string;name:string;aliases:string[];look:string;recipe:string[]};

export const creatorStyles:CreatorStyle[]=[
 {handle:'MrBeast',name:'MrBeast',aliases:['mr beast','jimmy donaldson'],look:'High-energy challenges: nonstop cuts, big captions, punch-ins',recipe:[
  'Hook: the first 3-5 seconds show the stakes or the payoff ("I gave away $100,000"), never a slow intro or a logo.',
  'Pace: a cut every 1-2 seconds; remove every pause, breath and filler word so speech runs back to back.',
  'Punch-ins: alternate framing scale 1.0 and 1.15-1.3 between cuts on the same shot, and zoom in on key lines and reactions.',
  'Captions: word_pop, very large bold white text with a heavy dark outline, one to three words at a time; numbers, money and key words in yellow or green.',
  'Text: stakes, counters and countdowns as big overlays ("$10,000", "Day 3", timers); short and readable in a second.',
  'Sound: a sound effect on almost every cut and text (Bright whoosh on cuts, Short pop on text, Bright riser before reveals, a hit on impacts); upbeat music kept low under speech and dropped out for big reveals.',
  'Color: bright and saturated (vivid filter, or saturation about 1.25 and contrast about 1.1); clean, punchy, never moody.',
  'Structure: escalate the stakes every minute or so and keep re-hooking ("but then..."); end on the biggest moment.']},
 {handle:'Vox',name:'Vox',aliases:['vox media','vox explainer'],look:'Explainer documentary: maps, highlighted text, calm narration',recipe:[
  'Pace: narration-led and calm; shots of 3-6 seconds, cut on the end of a sentence; let a graphic sit while the point lands.',
  'Graphics: motion-graphics scenes carry the explanation: maps that zoom to a place, simple bar and line charts that build, quotes and headlines on paper or newspaper textures with a yellow highlighter sweep over the key words.',
  'Archival and stills: slow push-ins and pans on photos (keyframes from scale 1.0 to 1.1 over the shot).',
  'Text: clean sans-serif, labels and lower thirds that name people, places and dates; chapter title cards between sections.',
  'Captions: none or clean; the narration and graphics do the work.',
  'Color: muted and slightly matte (matte or faded filter, saturation about 0.9); warm paper tones in graphics.',
  'Sound: an ambient, unobtrusive music bed that swells at chapter changes; subtle paper and click sounds on graphics.',
  'Transitions: mostly cuts; a slide or wipe between chapters; dip_to_black before the conclusion.']},
 {handle:'MarkRober',name:'Mark Rober',aliases:['mark rober'],look:'Engineering storytelling: build, test, slow-motion payoff',recipe:[
  'Structure: a clear question up front, then the build, the test and the payoff; tease the payoff in the first seconds.',
  'Annotations: arrows, circles and short labels drawn over the footage to explain parts and forces.',
  'Slow motion: impacts and launches at speed 0.25-0.5, often shown twice (real time, then slow).',
  'Countdowns before every test ("3, 2, 1") as text with a beep.',
  'Captions: clean or emphasis; diagrams as simple animated scenes.',
  'Color: bright, natural and clean (light vivid, saturation about 1.1).',
  'Sound: upbeat, playful music; a riser into each test and a hit on the result.']},
 {handle:'mkbhd',name:'Marques Brownlee',aliases:['mkbhd','marques brownlee'],look:'Clean tech reviews: slow precise moves, deep blacks, minimal text',recipe:[
  'Pace: measured; product shots of 2-4 seconds cut on the beat of ambient electronic music.',
  'Camera: slow, smooth push-ins and slides on products (keyframed scale 1.0 to 1.08, small x moves); no shaky footage.',
  'Color: clean and slightly cinematic with deep blacks and controlled highlights (cinematic or matte filter, contrast about 1.15, saturation about 0.95); a red accent color in graphics.',
  'Text: minimal, clean sans-serif spec callouts beside the product; no busy overlays.',
  'Captions: none, or clean and small.',
  'Transitions: cuts only; no flashy effects.',
  'Sound: low ambient music; crisp product sounds kept.']},
 {handle:'kurzgesagt',name:'Kurzgesagt',aliases:['in a nutshell','kurzgesagt in a nutshell'],look:'Animated explainers: flat vector art, vibrant gradients',recipe:[
  'Visuals: fully animated scenes in flat vector style: simple shapes, soft gradients, glowing highlights, small cute characters; no live footage.',
  'Color: vibrant, saturated palettes on dark blue or purple backgrounds.',
  'Motion: everything gently moves (floating, drifting, parallax layers); scenes transition by zooming into or out of an element.',
  'Pace: narration-led, steady; a new visual idea every 4-6 seconds.',
  'Text: rare, clean rounded sans-serif labels.',
  'Sound: a calm, spacious electronic score; soft sound effects on movements.']},
 {handle:'CaseyNeistat',name:'Casey Neistat',aliases:['casey neistat'],look:'Energetic vlogs: fast montages, timelapses, music-driven',recipe:[
  'Pace: quick, music-driven montages between talking moments; jump cuts within speech.',
  'Timelapses and fast motion: travel and city shots at speed 2-4.',
  'Variety: mix wide establishing shots, handheld talking to camera and close details.',
  'Text: bold, simple titles in white with a slight drop shadow, often stamped on with a pop.',
  'Color: warm and contrasty (warm filter, contrast about 1.15).',
  'Transitions: hard cuts on the beat; the occasional whip.',
  'Sound: music carries the story; let it play loud in montages and duck it under speech.']},
 {handle:'aliabdaal',name:'Ali Abdaal',aliases:['ali abdaal'],look:'Talking-head productivity: clean, bright, on-screen lists',recipe:[
  'Pace: talking head with jump cuts removing pauses; a B-roll or graphic every 5-10 seconds.',
  'Graphics: numbered points and key phrases appear on screen as he says them; simple icons and screenshots.',
  'Captions: emphasis, highlighting key words in an accent color.',
  'Punch-ins: gentle zoom (scale about 1.1) on important lines.',
  'Color: bright, warm and clean (warm filter, light exposure lift).',
  'Sound: soft lo-fi music under speech; small pops on text.']},
 {handle:'johnnyharris',name:'Johnny Harris',aliases:['johnny harris'],look:'Investigative explainers: maps, paper textures, film grain',recipe:[
  'Graphics: maps with routes and borders that draw on, documents and photos on paper and cardboard textures, red annotation lines connecting ideas.',
  'Look: film-like, slightly faded with grain (vintage or faded filter), warm tones.',
  'Mix: on-location talking to camera alternating with dense graphic explanations.',
  'Pace: builds tension; music swells into reveals, then quiet moments.',
  'Text: typewriter or bold serif headlines; place names on maps.',
  'Transitions: cuts and zooms into map locations.']},
 {handle:'emmachamberlain',name:'Emma Chamberlain',aliases:['emma chamberlain'],look:'Playful vlogs: comedic zooms, quirky text, freeze frames',recipe:[
  'Comedy timing: sudden punch-in zooms (scale 1.4-2.0) on reactions, freeze frames on awkward moments, deliberate pauses left in.',
  'Jump cuts: frequent, keeping the rambling, candid feel.',
  'Text: handwritten or doodle-style captions and side comments placed off-center.',
  'Color: warm and vintage (vintage or warm filter).',
  'Sound: quirky music, abrupt music cuts for comedy, occasional silly sound effects.']},
 {handle:'DudePerfect',name:'Dude Perfect',aliases:['dude perfect'],look:'Trick shots and sports: replays, slow motion, hype',recipe:[
  'Replays: every big shot shown again from another angle and in slow motion (speed 0.3-0.5).',
  'Graphics: scoreboards, brackets and player name cards.',
  'Pace: hype; quick cuts building up to each attempt, a beat of silence before it lands.',
  'Color: bright and saturated (vivid filter).',
  'Sound: big celebratory hits and crowd cheers on makes; energetic rock or pop music.']},
 {handle:'PeterMcKinnon',name:'Peter McKinnon',aliases:['peter mckinnon'],look:'Cinematic B-roll: speed ramps, whip transitions, moody grade',recipe:[
  'B-roll: tight, cinematic detail shots with smooth camera moves.',
  'Speed ramps: shots that slow down (speed 0.5) and snap back to normal on the beat.',
  'Transitions: whip, zoom_through and spin on the beat, used deliberately between sequences.',
  'Color: moody, teal and orange (teal_orange or moody filter), slightly crushed blacks.',
  'Sound: heavy sound design: whooshes on transitions, clicks, risers and hits matching cuts; cinematic music.']},
 {handle:'veritasium',name:'Veritasium',aliases:['derek muller'],look:'Science explainers: a question, demonstrations, clear diagrams',recipe:[
  'Hook: a surprising question or result in the first seconds.',
  'Demonstrations: real experiments filmed clearly, often in slow motion.',
  'Diagrams: clean animated scenes for forces, graphs and equations, built step by step.',
  'Pace: thoughtful; hold on an idea long enough to understand it.',
  'Color: natural and clean.',
  'Sound: understated music; let real sounds of experiments come through.']},
];

/** Creators in the library whose name, handle or alias matches the typed text (the @ menu and study_creator). */
export function matchCreators(query:string,limit=6):CreatorStyle[]{
 const q=query.trim().replace(/^@/,'').toLowerCase().replace(/\s+/g,' ');
 if(!q)return creatorStyles.slice(0,limit);
 const words=(c:CreatorStyle)=>[c.handle,c.name,...c.aliases].map(s=>s.toLowerCase());
 const starts=creatorStyles.filter(c=>words(c).some(w=>w.startsWith(q)||w.replace(/\s+/g,'').startsWith(q.replace(/\s+/g,''))));
 const contains=creatorStyles.filter(c=>!starts.includes(c)&&words(c).some(w=>w.includes(q)));
 return[...starts,...contains].slice(0,limit);
}
export const creatorStyle=(handle:string)=>creatorStyles.find(c=>c.handle.toLowerCase()===handle.replace(/^@/,'').toLowerCase())??matchCreators(handle,1).find(c=>[c.name,...c.aliases].some(a=>a.toLowerCase()===handle.replace(/^@/,'').toLowerCase()));
