# Dream engine

Dream draws the edit itself, live in the player and the same way on Export: clips and their framing, keyframes, effects, transitions, overlays of footage and images, built-in text elements, captions, music and sound. You change the edit by changing `project.json`. Coded motion graphics (scenes) are not part of this version. This reference is complete: you do not need to search the workspace for engine, score or project-document formats.

## The project document

`project.json` is the edit. Change it with code: edit it directly for a small change (one clip, one item, one setting), or write a program in any language that reads it, the sources and `context/` and writes it back; then call `publish_project`. Keep `format`, `version`, `baseVersionId` and `timeline.id` as they are, keep items you were not asked to change (the user may have made them), and never write the document from scratch.

```json
{"format":"dream-workspace","version":1,"baseVersionId":"<as read>",
 "timeline":{"schemaVersion":1,"id":"<as read>","settings":{"fps":30,"width":1920,"height":1080},
  "spine":[...],"attached":[...],"music":[...],"captions":{"style":"clean"}},
 "outputs":[{"id":"theme","path":"src/music/theme.score.json","kind":"music"}]}
```

- Sources: `context/assets.json` lists every source (id, file, length, size, frame rate, sound, path your code can read). A clip's `assetId` is a source id, or `output:<id>` for something your files produce.
- Speech: `context/transcripts/<assetId>.json` holds the timed words (`words`: id, text, start, end in source seconds) and `coverage` (how far transcription has got; `coverage.status` is `complete` when it is done). The file updates as transcription runs, also while your own commands run, so code may wait on it. Cut between words, never inside one.
- `publish_project` validates the document (ids, sources, ranges within each source, anchors), publishes it, and returns checks of what changed: footage used twice, a cut inside a spoken word, silence over three seconds inside a clip. Fix those and publish again, or keep one with a reason in `finish.kept`.

## Declaring outputs

Music, sound effects and media your code produces are declared in `outputs` and placed as `output:<id>`:

```json
{"id":"theme","path":"src/music/theme.score.json","kind":"music"}
{"id":"clean","path":"output/clean-voice.wav","kind":"audio"}
{"id":"steady","path":"output/stabilized.mp4","kind":"video"}
```

- Media your programs make (stabilized, cleaned, converted, generated) goes under `output/` with kind `video`, `audio` or `image`, and is placed like any source.
- `publish_project` publishes; `check_outputs` checks score and sound files without publishing (each track's length in bars, partial bars, the total length).

## Clips

A clip in `spine` plays seconds `srcIn` to `srcOut` of its source; clips play one after another and set the video's length.

```json
{"id":"shot2","assetId":"<source id>","srcIn":12.5,"srcOut":18,"speed":1,
 "framing":{"mode":"fill","scale":1.15,"x":0.5,"y":0.5,"exposure":-0.3,"contrast":1.2,"saturation":0.6,"temperature":-0.3},
 "audio":{"gainDb":0,"fadeInSec":0.01,"fadeOutSec":0.01,"mute":false},
 "transitionIn":{"type":"crossfade","durationSec":0.5}}
```

- `speed` 0.25 to 4 (sound keeps its pitch). An image clip lasts `holdSec`.
- `framing.mode`: `fit` shows the whole picture (letterboxed when its shape differs from the frame), `fill` covers the frame and crops the overflow. `x` and `y` (0 to 1) choose which part shows when the picture does not exactly fit the frame. `scale` zooms about the centre of the frame. To show one region (a corner, a face, a speaker box), zoom with `scale` and place it with keyframe `x` and `y` (below).
- `framing` also takes `rotation`, `flipX`, `flipY`, `opacity`, and the grade: `exposure` (-2 to 2), `contrast` and `saturation` (1 leaves them unchanged), `temperature` (-1 cool to 1 warm).
- `transitionIn.type`: `cut`, `crossfade`, `dip_to_black`, `whip`, `zoom_through` or `slide`.
- `captions` (optional, on the timeline): `style` `clean`, `karaoke`, `word_pop` or `emphasis`; captions follow the spoken words of each clip.

## Keyframes (camera moves, as in CapCut)

A clip or an attached item can carry `keyframes`, animated live in the player: pans, zooms, drifts, spins, fades, colour over time.

```json
{"id":"shot2","assetId":"<source id>","srcIn":12.5,"srcOut":18,
 "keyframes":[{"sec":12.5,"scale":1.2,"y":0.5},{"sec":15,"scale":1.4,"y":0.65,"easing":"ease_in_out"},{"sec":18,"scale":1.2,"y":0.5,"easing":"ease_in_out"}]}
```

- `sec` is source seconds, like `srcIn` and transcript words, so keyframes stay on their footage through trims and speed changes (an attached item without a source counts from 0).
- `scale`, `x`/`y` (the picture's centre, 0.5 centred; higher `y` shows more of the top), `rotation`, `opacity`, `exposure`, `contrast`, `saturation`, `temperature`; on attached items as in `params`. They replace the matching `framing` values.
- The picture covers the frame while `scale` ≥ 1 + 2|x − 0.5| and 1 + 2|y − 0.5|.
- Each property moves between the keyframes that set it and holds outside them; `easing` (`linear`, `ease_in`, `ease_out`, `ease_in_out`, `hold`) shapes the move into that keyframe.

## Timeline items (complete examples)

The `timeline` has `spine` (clips that play one after another and set the video's length), `attached` (overlays and sound effects placed in time), `music` and `settings`. Every item has a unique `id`; times are in seconds.

```json
{"spine":[
  {"id":"shot1","assetId":"<imported photo id>","srcIn":0,"srcOut":3,"holdSec":3},
  {"id":"shot2","assetId":"<imported asset id>","srcIn":12.5,"srcOut":18}
 ],
 "attached":[
  {"id":"name","type":"overlay","component":"lower_third","start":{"kind":"clip","clipId":"shot2","at":"start","offsetSec":0.5},"durationSec":4,"layer":1,"params":{"text":"Jane Doe","x":0.5,"y":0.82}},
  {"id":"logo","type":"overlay","component":"source","source":{"assetId":"<imported image id>","srcIn":0,"srcOut":4},"start":{"kind":"clip","clipId":"shot2","at":"start","offsetSec":0}},"durationSec":4,"layer":2,"params":{"x":0.85,"y":0.12,"scale":0.2,"fit":"contain"}},
  {"id":"whoosh1","type":"sfx","component":"source","source":{"assetId":"output:whoosh","srcIn":0,"srcOut":0.6},"start":{"kind":"project","at":"start","offsetSec":5},"durationSec":0.6,"layer":1}
 ],
 "music":[
  {"id":"bed","assetId":"output:theme","srcIn":0,"srcOut":20,"start":{"kind":"project","at":"start","offsetSec":0},"gainDb":-12,"fadeOutSec":1}
 ]}
```

- `srcIn` and `srcOut` pick seconds of the source; a photo lasts `holdSec`.
- An attached item needs `type` (`overlay`, `broll`, `effect` or `sfx`), `component` (`"source"` when it plays an asset, or a text element below), `source` for an asset, a `start` anchor and a length: `durationSec`, or an `end` anchor.
- Anchors: `{"kind":"project","at":"start","offsetSec":5}` (`at` is `"start"` or `"end"`); `{"kind":"clip","clipId":"shot2","at":"start","offsetSec":0}` (`at` is `"start"`, `"end"` or seconds into the clip; it follows the clip if the clip moves); `{"kind":"word","wordId":"...","clipId":"...","edge":"start"}` (lands on a spoken word).
- A music item needs `srcIn`, `srcOut` and a `start` anchor; `gainDb` defaults to -18 and music ducks under speech automatically.
- Overlay `params`: `x` and `y` (0 to 1, the center), `scale`, `rotation`, `opacity`, `fit` (`"cover"` or `"contain"`).

## Effects on footage (built in)

An attached item of `type` `"effect"` changes every clip under it while it lasts; it needs no `source`. Anything beyond these: keyframes, or processed media.

```json
{"id":"push1","type":"effect","component":"slow_push","start":{"kind":"clip","clipId":"shot2","at":"start"},"end":{"kind":"clip","clipId":"shot2","at":"end"},"params":{"amount":0.08}}
```

- `slow_push`: a slow zoom in across each clip it covers (a Ken Burns move); `amount` is the extra scale by the end of the clip, 0.05 to 0.15.
- `punch_zoom`: holds the picture zoomed in by `amount` (0.1 to 0.25), for emphasis on a beat or a line.
- `shake`: camera shake of strength `amount` (0.05 to 0.3), for an impact moment.
- `grade`: a colour layer over every clip it covers, with `exposure` (-2 to 2), `contrast` and `saturation` (1 leaves them unchanged) and `temperature` (-1 cool to 1 warm). Use it to grade a stretch of several clips at once; for one clip, set the grade in the clip's `framing`.

## Text and graphic elements (built in)

An attached `overlay` whose `component` is one of these draws itself; it needs no `source`. It fades in over its first 8 frames. `params`: `text`, `x` and `y` (0 to 1, the element's centre; `y` defaults to 0.8, 0.5 for a title card), `fontSize` (60), `color` (`#ffffff`), `background`, `rotation`, `scale`, `opacity`; keyframes move and fade it like any layer.

- `text`: text with a soft shadow, wrapping at 85% of the frame's width.
- `title_card`: a full-frame card (`background`, default `#111418`) with the text on it.
- `lower_third`: the text in a padded rounded box (`background`, default `#111418cc`).
- `callout_arrow`: an arrow (↗) at `x`, `y`.
- `circle_highlight`: a ring of diameter `size` (220) in `color`.
- `counter`: counts from 0 to `value` over two seconds, then holds; `suffix` follows the number.
- `progress_bar`: a 500-pixel bar that fills over its first 50 frames.

## Music and sound effects (written as data, synthesized by Dream)

Music is a score file, not code: `src/music/<name>.score.json`, declared as `{"id":"theme","path":"src/music/theme.score.json","kind":"music"}` and placed in the timeline `music` list as `output:theme`.

Score fields: `tempo` (BPM), `key` ("A minor"), `meter` ("4/4"), `mood` (calm, bright, cinematic, pulse, warm), `intensity` (0-1), optional `durationSec`, `sections` (`[{name, bars, kind}]`, kind intro, body, build, break or ending) and `tracks`. Each track has an `instrument` (pad, bass, pluck, lead, keys, kick, snare, hat, tom, shaker, cymbal, riser, impact) and exactly one of:

- `pattern`: steps, one character per sixteenth note: `x` hit, `X` accent, `o` soft, `.` rest (spaces and `|` are ignored).
- `notes`: `"A2:8n A2 C3 E3:4n r:2n"`. A note name with an optional duration (`1n`, `2n`, `4n`, `8n`, `16n`; `4n.` dotted, `8t` triplet) that carries to following notes. `r` is a rest and `C4+E4` plays together.
- `chords`: `["Am","F","C","G"]`, each lasting `chordBeats` (default one bar).
- `arp`: `{"chords":["Am","F"],"pattern":"up|down|updown|random","rate":"16n","octaves":2}`.

Optional per track: `sections` (names to play in), `repeat` (a count, or `false` to play once; by default a track loops to fill its sections), `octave`, `velocity`, `gainDb`, `pan`. Errors name the field and the token that is wrong.

Sound effects are timeline `sfx` items whose source is an output of kind `sfx`: either a preset, `"path":"preset:Soft whoosh"` (the project state lists the presets), or a sound design file `src/sfx/<name>.sfx.json` with `durationSec` and `layers` (each `wave` sine, triangle, saw, square or noise, `startSec`, `durationSec`, `frequencyHz`, `endFrequencyHz`, `gainDb`, `pan`, `attackSec`, `releaseSec`, `filterHz`).

## Example: score

```json
{"title":"Bright pulse","tempo":118,"key":"D major","mood":"bright","intensity":0.7,
 "sections":[{"name":"intro","bars":2,"kind":"intro"},{"name":"main","bars":8},{"name":"outro","bars":2,"kind":"ending"}],
 "tracks":[
  {"instrument":"pad","chords":["D","Bm","G","A"]},
  {"instrument":"bass","notes":"D2:8n D2 r D2 F#2 r A2 r","sections":["main","outro"]},
  {"instrument":"kick","pattern":"x...x...x...x...","sections":["main"]},
  {"instrument":"hat","pattern":"..x...x...x...x.","velocity":0.5,"sections":["main"]},
  {"instrument":"pluck","arp":{"chords":["D","Bm","G","A"],"rate":"16n","octaves":2},"sections":["main"],"gainDb":-6}
 ]}
```

