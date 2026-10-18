# Dream scene engine

A scene is a React component in `src/` (`.tsx`, `.ts`, `.jsx` or `.js`) whose default export draws one frame. Dream runs it: loading, frame timing, playback, seeking, fonts, media access, 3D setup and export are handled for you. You do not need to write renderers, loaders, frame loops or build steps for scenes; anything else a scene needs, install it. This reference is complete: you do not need to search the workspace for engine, score or project-document formats.

## The project document

`project.json` is the edit. Change it with code: edit it directly for a small change (one clip, one item, one setting), or write a program in any language that reads it, the sources and `context/` and writes it back; then call `publish_project`. Keep `format`, `version`, `baseVersionId` and `timeline.id` as they are, keep items you were not asked to change (the user may have made them), and never write the document from scratch.

```json
{"format":"dream-workspace","version":1,"baseVersionId":"<as read>",
 "timeline":{"schemaVersion":1,"id":"<as read>","settings":{"fps":30,"width":1920,"height":1080},
  "spine":[...],"attached":[...],"music":[...],"captions":{"style":"clean"}},
 "outputs":[{"id":"intro","path":"src/intro.tsx","kind":"scene","durationInFrames":150}]}
```

- Sources: `context/assets.json` lists every source (id, file, length, size, frame rate, sound, path your code can read). A clip's `assetId` is a source id, or `output:<id>` for something your files produce.
- Speech: `context/transcripts/<assetId>.json` holds the timed words (`words`: id, text, start, end in source seconds) and `coverage` (how far transcription has got; `coverage.status` is `complete` when it is done). The file updates as transcription runs, also while your own commands run, so code may wait on it. Cut between words, never inside one.
- `publish_project` validates the document (ids, sources, ranges within each source, anchors), publishes it, and returns checks of what changed: footage used twice, a cut inside a spoken word, silence over three seconds inside a clip. Fix those and publish again, or keep one with a reason in `finish.kept`.

## Declaring outputs

Scenes, music, sound effects and media your code produces are declared in `outputs` and placed as `output:<id>`:

```json
{"id":"intro","path":"src/intro.tsx","kind":"scene","durationInFrames":150,"props":{"title":"Launch day"}}
{"id":"clean","path":"output/clean-voice.wav","kind":"audio"}
{"id":"steady","path":"output/stabilized.mp4","kind":"video"}
```

- Size and frame rate default to the project's; set `width`, `height` or `fps` only to differ.
- `props` are passed to the component, so one component can serve many shots with different props.
- `transparent: true` gives the scene no background, for overlays placed on `attached` above footage.
- Media your programs make (stabilized, cleaned, converted, generated) goes under `output/` with kind `video`, `audio` or `image`, and is placed like any source.
- `publish_project` compiles and publishes; `check_outputs` previews drafts without publishing and also checks score files (each track's length in bars, partial bars, the total length). Writing a scene file returns a compile check.

## Clips

A clip in `spine` plays seconds `srcIn` to `srcOut` of its source; clips play one after another and set the video's length.

```json
{"id":"shot2","assetId":"<source id>","srcIn":12.5,"srcOut":18,"speed":1,
 "framing":{"mode":"fill","scale":1.15,"x":0.5,"y":0.5,"exposure":-0.3,"contrast":1.2,"saturation":0.6,"temperature":-0.3},
 "audio":{"gainDb":0,"fadeInSec":0.01,"fadeOutSec":0.01,"mute":false},
 "transitionIn":{"type":"crossfade","durationSec":0.5}}
```

- `speed` 0.25 to 4 (sound keeps its pitch). An image clip lasts `holdSec`.
- `framing.mode`: `fit` shows the whole picture (letterboxed when its shape differs from the frame), `fill` covers the frame and crops the overflow. `x` and `y` (0 to 1) choose which part shows when the picture does not exactly fit the frame. `scale` zooms about the centre of the frame. To show one region (a corner, a face, a speaker box), zoom with `scale` and place it with keyframe `x` and `y` (below), or write a scene that shows the asset at the size and place you want.
- `framing` also takes `rotation`, `flipX`, `flipY`, `opacity`, and the grade: `exposure` (-2 to 2), `contrast` and `saturation` (1 leaves them unchanged), `temperature` (-1 cool to 1 warm), `tint` (-1 green to 1 magenta), `fade` (0 to 1, lifted blacks), and a `filter` preset (below) with `filterIntensity` (0 to 1), applied before the rest of the grade.
- `transitionIn` leads into the clip, centred on the cut (`durationSec` up to 3): `crossfade`, `dip_to_black`, `dip_to_white`, `flash`, `wipe`, `slide`, `whip`, `zoom_through` (zoom in), `zoom_out`, `blur`, `spin`, `iris` (circle reveal), `glitch`, or `cut`. `wipe`, `slide` and `whip` take `direction` (`left`, `right`, `up`, `down`; default `left`). Video on both sides needs `durationSec / 2` of footage past each side of the cut; photos and scenes hold their picture.
- `captions` (optional, on the timeline): `style` `clean`, `karaoke`, `word_pop` or `emphasis`; captions follow the speech heard: unmuted clips and music items at -10 dB or louder; `params.sources` (ids) picks exactly.

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
  {"id":"shot1","assetId":"output:intro","srcIn":0,"srcOut":5,"speed":1,"audio":{"mute":true}},
  {"id":"shot2","assetId":"<imported asset id>","srcIn":12.5,"srcOut":18}
 ],
 "attached":[
  {"id":"name","type":"overlay","component":"source","source":{"assetId":"output:lowerthird","srcIn":0,"srcOut":4},"start":{"kind":"clip","clipId":"shot2","at":"start","offsetSec":0.5},"durationSec":4,"layer":1,"params":{"x":0.5,"y":0.5,"scale":1}},
  {"id":"whoosh1","type":"sfx","component":"source","source":{"assetId":"output:whoosh","srcIn":0,"srcOut":0.6},"start":{"kind":"project","at":"start","offsetSec":5},"durationSec":0.6,"layer":1}
 ],
 "music":[
  {"id":"bed","assetId":"output:theme","srcIn":0,"srcOut":20,"start":{"kind":"project","at":"start","offsetSec":0},"gainDb":-12,"fadeOutSec":1}
 ]}
```

- `srcIn` and `srcOut` pick seconds of the source; a scene output lasts `durationInFrames / fps` seconds.
- An attached item needs `type` (`overlay`, `broll`, `effect` or `sfx`), `component` (`"source"` when it plays an asset), `source`, a `start` anchor and a length: `durationSec`, or an `end` anchor.
- Anchors: `{"kind":"project","at":"start","offsetSec":5}` (`at` is `"start"` or `"end"`); `{"kind":"clip","clipId":"shot2","at":"start","offsetSec":0}` (`at` is `"start"`, `"end"` or seconds into the clip; it follows the clip if the clip moves); `{"kind":"word","wordId":"...","clipId":"...","edge":"start"}` (lands on a spoken word).
- A music item needs `srcIn`, `srcOut` and a `start` anchor; `gainDb` defaults to -18 and music ducks under speech automatically.
- Overlay `params`: `x` and `y` (0 to 1, the center), `scale`, `rotation`, `opacity`, `fit` (`"cover"` or `"contain"`), and a `filter` with `filterIntensity`.

## Effects on footage (built in)

An attached item of `type` `"effect"` changes the main-track clips under it while it lasts (`"apply":"all"` in `params` also changes overlay footage and photos); it needs no scene code and no `source`. Anything beyond these: keyframes, or a scene. Every `amount` is 0 to 1 unless given.

```json
{"id":"push1","type":"effect","component":"slow_push","start":{"kind":"clip","clipId":"shot2","at":"start"},"end":{"kind":"clip","clipId":"shot2","at":"end"},"params":{"amount":0.08}}
```

- Motion: `slow_push` (a slow zoom in across each clip, a Ken Burns move; `amount` is the extra scale by the clip's end, 0.05 to 0.15), `pull_out` (the same, zooming out), `punch_zoom` (holds the picture zoomed in by `amount`, 0.1 to 0.25), `zoom_pulse` (pulses in and out by `amount` at `rate` beats a second, for music), `shake` (camera shake, 0.05 to 0.3).
- Looks: `blur`, `vignette`, `glow`, `grain`, `vhs`, `glitch`, `rgb_split`, `pixelate`, `letterbox` (cinema bars).
- `grade`: a colour layer over every clip it covers: a `preset` filter with `intensity` (0 to 1), and/or `exposure`, `contrast`, `saturation`, `temperature`, `tint`, `fade`. Use it to grade a stretch of several clips at once; for one clip, set the grade in the clip's `framing`.
- Filter presets (for `framing.filter`, an overlay's `params.filter` or a grade's `preset`): `warm`, `cool`, `vivid`, `cinematic`, `teal_orange`, `golden`, `vintage`, `faded`, `matte`, `moody`, `pastel`, `neon`, `retro`, `mono`, `noir`, `sepia`.

## Text and stickers (built in)

Text is an `overlay` with `component` `"text"` and `params.text`; a sticker is an `overlay` with `component` `"sticker"` and `params.sticker`. Neither needs a scene; use a scene for anything they cannot do.

```json
{"id":"title1","type":"overlay","component":"text","start":{"kind":"project","at":"start","offsetSec":1},"durationSec":3,"layer":0,"params":{"text":"Day one","style":"bold_title","y":0.3}}
```

- `style` is a ready look; the text's own `params` override it: `basic`, `bold_title`, `outline`, `neon`, `label`, `highlight`, `subtitle`, `typewriter`, `pop`, `retro`, `elegant`, `handwritten`, `comic`.
- Text `params`: `x`, `y` (0 to 1, the centre; text defaults to 0.8), `scale`, `rotation`, `opacity`, `fontFamily` (`Arial`, `Arial Black`, `Segoe UI`, `Impact`, `Georgia`, `Times New Roman`, `Courier New`, `Trebuchet MS`, `Verdana`, `Segoe Script`, `Comic Sans MS`), `fontSize` (px of a 1080p frame), `fontWeight`, `italic`, `uppercase`, `letterSpacing`, `color`, `stroke` and `strokeWidth` (an outline), `shadow`, `shadowBlur`, `shadowX`, `shadowY`, `glow` and `glowSize`, `background` with `padding` and `radius` (a box).
- Animations (text and stickers): `animation` in (`none`, `fade`, `pop`, `slide_up`, `slide_down`, `zoom`, `typewriter`), `animationSec` (0.4), `animationOut` (`none`, `fade`, `pop`, `slide_down`, `zoom`), `loop` while it shows (`none`, `pulse`, `wiggle`, `float`, `bounce`, `spin`).
- Stickers: `star`, `heart`, `sparkle`, `burst`, `ring`, `lightning`, `fire`, `sun`, `cloud`, `music`, `confetti`, `crown`, `smile`, `laugh`, `love`, `wow`, `cool`, `wink`, `sad`, `angry`, `arrow`, `check`, `cross`, `pin`, `play`, `speech` (with `text` inside), `new`. Sticker `params`: `x`, `y` (0.5), `size` (px; 30% of the frame's short side), `scale`, `rotation`, `color`, `accent`, and the animations (default: pop in).

## Available imports (no install needed)

- `react`; `remotion`: `useCurrentFrame`, `useVideoConfig`, `interpolate`, `spring`, `Easing`, `Sequence`, `Series`, `AbsoluteFill`, `Img`, `random(seed)`, `interpolateColors`, `Loop`, `Freeze`.
- `@remotion/transitions` (`TransitionSeries`, with `fade`, `slide`, `wipe`, `flip`, `clockWipe`, `iris` and others from `@remotion/transitions/<name>`), `@remotion/shapes`, `@remotion/paths` (`evolvePath` for line drawing), `@remotion/layout-utils` (`measureText`, `fitText`), `@remotion/noise`.
- `three` and `three/addons/...`; `@react-three/fiber`; `@react-three/drei` (`Text`, `Text3D`, `RoundedBox`, `Center`, `Float`, `Billboard`, `Line`, `Sparkles`, `Stars`, `Sky`, `Environment`+`Lightformer`, `ContactShadows`, `Edges`, `Outlines`, `Grid`, `Instances`/`Instance`, `MeshDistortMaterial`, `MeshTransmissionMaterial`, cameras, primitive shapes, `Svg`, `Html`). Drei helpers that download files (environment presets) are unavailable; nothing in a scene can reach the network.
- `d3` (and any `d3-*` module); `lucide-react` icons; `simplex-noise`.
- `@dream/engine` (below).
- Anything else: install it with `run_command` (`npm install <package>`); installed packages are bundled into the scene automatically. Never install another copy of React, Remotion or three; the engine's copies are always used.

## @dream/engine

| Helper | Use |
|---|---|
| `asset(id)` / `useAsset(id)` | URL of an imported project asset (image, video, audio) by asset ID. |
| `resource(path)` / `staticFile(path)` | URL of a file in the workspace `resources/` folder, e.g. `resource('logos/brand.svg')`. Importing a file (`import logo from './logo.png'`) also gives its URL. |
| `useJson(path)`, `useText(path)` | Read a JSON or text file from `resources/` (the frame waits for it). |
| `<SourceVideo src={asset(id)} startFrom={frames} />` | Video showing exactly the frame for the scene's time (Remotion's `Video`/`OffthreadVideo` map to this). Silent: sound belongs on the timeline. |
| `<FitText>` | Text that fills its parent box at the largest size that fits, wrapping as needed. It cannot overflow. Props: `fontFamily`, `fontWeight`, `maxFontSize`, `minFontSize`, `lineHeight`, `align`, `verticalAlign`, how the text looks (`color`, `textShadow`, `WebkitTextStroke`, `letterSpacing`, `textTransform`, `fontStyle`, `textDecoration`), and `style` for any other CSS. A prop it does not take comes back as a scene error. |
| `<SafeArea inset={0.05}>` | Full-frame flex column inset from the edges; keeps content clear of crops. |
| `fonts`, `loadFont(family, weight)` | Bundled families: Inter, Roboto, Montserrat, Poppins, Oswald, Bebas Neue, Playfair Display, Lora, Space Grotesk, JetBrains Mono, Press Start 2P. Use them by name in CSS. |
| `<Scene3D>` | A 3D canvas the size of the scene with a camera aimed at the origin, key and fill lights and studio reflections. Props: `camera` (`{position:[x,y,z],fov}`), `background` (a CSS colour; leave it out for a see-through canvas over the scene's own background), `lights={false}`, `environment={false}`, `shadows`, `orthographic`. Children are React Three Fiber elements. |
| `useTexture(url, {filter, repeat})` | Load an image as a texture (suspends until ready). `filter:'nearest'` keeps hard pixel edges when magnified; `repeat:[x,y]` tiles it. |
| `useBeats(musicOutputId)` | Beat times of a music output listed in the scene's `music`: `beats`, `index`, `sinceBeat`, `pulse(decay)`, `isOnBeat(frames)`. |

## Rules that keep frames correct

- Drive everything from `useCurrentFrame()` (and `fps` from `useVideoConfig()`). Never use timers, `Date`, `requestAnimationFrame` or CSS animations that run on their own. `Math.random()` is seeded per scene; prefer `random('label')` from remotion.
- Size and place things relative to `width` and `height`; use `FitText` for any text whose length can vary, and flex or grid layout so elements cannot overlap.
- In 3D, animate from the frame (`rotation={[0, frame * 0.02, 0]}`), not from `useFrame` clocks.
- Scenes are silent. Put music, voice and sound effects on the timeline (`music`, `sfx` items).
- Errors from a scene playing in the player or a preview come back to you with the file and line.

## Music and sound effects (written as data, synthesized by Dream)

Music is a score file, not code: `src/music/<name>.score.json`, declared as `{"id":"theme","path":"src/music/theme.score.json","kind":"music"}` and placed in the timeline `music` list as `output:theme`. Dream synthesizes it and records its beat times; a scene output that lists `"music":["theme"]` can follow them with `useBeats('theme')`.

Score fields: `tempo` (BPM), `key` ("A minor"), `meter` ("4/4"), `mood` (calm, bright, cinematic, pulse, warm), `intensity` (0-1), optional `durationSec`, `sections` (`[{name, bars, kind}]`, kind intro, body, build, break or ending) and `tracks`. Each track has an `instrument` (pad, bass, pluck, lead, keys, kick, snare, hat, tom, shaker, cymbal, riser, impact) and exactly one of:

- `pattern`: steps, one character per sixteenth note: `x` hit, `X` accent, `o` soft, `.` rest (spaces and `|` are ignored).
- `notes`: `"A2:8n A2 C3 E3:4n r:2n"`. A note name with an optional duration (`1n`, `2n`, `4n`, `8n`, `16n`; `4n.` dotted, `8t` triplet) that carries to following notes. `r` is a rest and `C4+E4` plays together.
- `chords`: `["Am","F","C","G"]`, each lasting `chordBeats` (default one bar).
- `arp`: `{"chords":["Am","F"],"pattern":"up|down|updown|random","rate":"16n","octaves":2}`.

Optional per track: `sections` (names to play in), `repeat` (a count, or `false` to play once; by default a track loops to fill its sections), `octave`, `velocity`, `gainDb`, `pan`. Errors name the field and the token that is wrong.

Sound effects are timeline `sfx` items whose source is an output of kind `sfx`: either a preset, `"path":"preset:Soft whoosh"` (the project state lists the presets), or a sound design file `src/sfx/<name>.sfx.json`: `durationSec` (up to 30) and `layers` (1 to 32). Each layer needs `wave` (sine, triangle, saw, square or noise), `durationSec` and `frequencyHz` (20 to 20000); it may set `id` (unique within the sound; layer-1, layer-2... by default), `startSec` (0), `endFrequencyHz` (a pitch sweep; no sweep by default), `gainDb` (-60 to 6; -6), `pan` (-1 left to 1 right; 0), `attackSec` (0.01), `releaseSec` (0.1) and `filterHz` (low-pass, 20 to 20000; open). Two rules: every layer ends within the sound (`startSec + durationSec <= durationSec`), and its fades fit inside it (`attackSec + releaseSec <= durationSec` of the layer). Writing the file returns a check listing every problem at once.

```json
{"durationSec":0.7,"layers":[
 {"id":"air","wave":"noise","durationSec":0.6,"frequencyHz":600,"endFrequencyHz":2400,"filterHz":3000,"gainDb":-10,"attackSec":0.2,"releaseSec":0.3},
 {"id":"tone","wave":"sine","startSec":0.05,"durationSec":0.65,"frequencyHz":880,"gainDb":-16,"attackSec":0.005,"releaseSec":0.5}
]}
```

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

## Example: kinetic title

```tsx
import {AbsoluteFill,spring,useCurrentFrame,useVideoConfig,interpolate} from 'remotion';
import {FitText,SafeArea} from '@dream/engine';

export default function Title({title,subtitle}:{title:string;subtitle:string}){
  const frame=useCurrentFrame(),{fps}=useVideoConfig();
  const enter=spring({frame,fps,config:{damping:18}});
  const underline=interpolate(frame,[12,32],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  return <AbsoluteFill style={{background:'#0f1115',color:'#fff'}}>
    <SafeArea style={{justifyContent:'center',gap:'3%'}}>
      <div style={{height:'34%',transform:`translateY(${(1-enter)*40}px)`,opacity:enter}}>
        <FitText fontFamily="Montserrat" fontWeight={900}>{title}</FitText>
      </div>
      <div style={{height:6,width:`${underline*40}%`,background:'#ffb000',alignSelf:'center'}}/>
      <div style={{height:'10%',opacity:underline}}><FitText fontFamily="Inter" fontWeight={400}>{subtitle}</FitText></div>
    </SafeArea>
  </AbsoluteFill>;
}
```

## Example: animated bar chart

```tsx
import {AbsoluteFill,useCurrentFrame,useVideoConfig,spring} from 'remotion';
import {scaleBand,scaleLinear} from 'd3';
import {FitText} from '@dream/engine';

const data=[{label:'2021',value:12},{label:'2022',value:19},{label:'2023',value:31},{label:'2024',value:44}];
export default function Chart(){
  const frame=useCurrentFrame(),{fps,width,height}=useVideoConfig();
  const top=height*.18,bottom=height*.88,x=scaleBand<string>().domain(data.map(d=>d.label)).range([width*.12,width*.88]).padding(.25);
  const y=scaleLinear().domain([0,50]).range([bottom,top]);
  return <AbsoluteFill style={{background:'#fafafa'}}>
    <div style={{position:'absolute',left:'8%',right:'8%',top:'4%',height:'10%'}}><FitText fontFamily="Space Grotesk" style={{color:'#111'}}>Revenue by year</FitText></div>
    <svg width={width} height={height}>{data.map((d,i)=>{const grow=spring({frame:frame-i*6,fps,config:{damping:200}}),h=(bottom-y(d.value))*grow;
      return <g key={d.label}><rect x={x(d.label)} width={x.bandwidth()} y={bottom-h} height={h} rx={8} fill="#2f6fed"/>
        <text x={x(d.label)!+x.bandwidth()/2} y={bottom+height*.05} textAnchor="middle" fontFamily="Inter" fontSize={height*.035} fill="#333">{d.label}</text></g>;})}</svg>
  </AbsoluteFill>;
}
```

## Example: 3D object

```tsx
import {useCurrentFrame,interpolate} from 'remotion';
import {Scene3D} from '@dream/engine';
import {RoundedBox,ContactShadows,Text} from '@react-three/drei';

function Device(){
  const frame=useCurrentFrame(),turn=interpolate(frame,[0,120],[-0.6,0.6]);
  return <group rotation={[0.15,turn,0]}>
    <RoundedBox args={[2.2,1.4,0.12]} radius={0.06}><meshStandardMaterial color="#1d1f24" metalness={0.6} roughness={0.25}/></RoundedBox>
    <mesh position={[0,0,0.065]}><planeGeometry args={[2,1.2]}/><meshStandardMaterial color="#5aa9ff" emissive="#1b4d8a"/></mesh>
    <Text position={[0,-1.1,0]} fontSize={0.18} color="#222">Ships in March</Text>
  </group>;
}
export default function Product(){
  return <Scene3D background="#eef1f5" camera={{position:[0,0.4,4.2],fov:40}}><Device/><ContactShadows position={[0,-0.9,0]} opacity={0.4} blur={2.5}/></Scene3D>;
}
```

## Example: overlay on footage

Declared with `"transparent": true` and placed in `attached` above a clip:

```tsx
import {AbsoluteFill,useCurrentFrame,interpolate} from 'remotion';
import {FitText} from '@dream/engine';

export default function LowerThird({name,role}:{name:string;role:string}){
  const frame=useCurrentFrame(),slide=interpolate(frame,[0,12],[-100,0],{extrapolateRight:'clamp'}),fade=interpolate(frame,[0,8],[0,1],{extrapolateRight:'clamp'});
  return <AbsoluteFill>
    <div style={{position:'absolute',left:'6%',bottom:'10%',width:'38%',height:'14%',transform:`translateX(${slide}%)`,opacity:fade,background:'rgba(10,12,16,.82)',borderLeft:'8px solid #ffb000',padding:'1% 2%',display:'flex',flexDirection:'column'}}>
      <div style={{flex:3}}><FitText fontFamily="Inter" fontWeight={700} align="left" style={{color:'#fff'}}>{name}</FitText></div>
      <div style={{flex:2}}><FitText fontFamily="Inter" fontWeight={400} align="left" style={{color:'#cfd3da'}}>{role}</FitText></div>
    </div>
  </AbsoluteFill>;
}
```
