# Dream scene engine

A scene is a React component in `src/` (`.tsx`, `.ts`, `.jsx` or `.js`) whose default export draws one frame. Dream runs it: loading, frame timing, playback, seeking, fonts, media access, 3D setup and export are handled for you. Write only the code for the video itself. Do not write renderers, loaders, frame loops, bundlers or build steps. This reference is complete: you do not need to search the workspace for engine, score or project-document formats.

## Declaring a scene

In `project.json`, add an output and place it on the timeline as `output:<id>`:

```json
{"id":"intro","path":"src/intro.tsx","kind":"scene","durationInFrames":150,"props":{"title":"Launch day"}}
```

- Size and frame rate default to the project's; set `width`, `height` or `fps` only to differ.
- `props` are passed to the component, so one component can serve many shots with different props.
- `transparent: true` gives the scene no background, for overlays placed on `attached` above footage.
- `publish_project` compiles and publishes; `check_outputs` previews drafts without publishing and also checks score files (each track's length in bars, partial bars, the total length). Writing a scene file returns a compile check.

## Timeline items (complete examples)

Change `project.json` in place: read it, then edit the parts you change (edit_file), or write back the whole document you read with your changes. Keep `format`, `version`, `baseVersionId` and `timeline.id` exactly as they are; never write the document from scratch. The `timeline` in `project.json` has `spine` (clips that play one after another and set the video's length), `attached` (overlays and sound effects placed in time), `music` and `settings`. Every item has a unique `id`; times are in seconds.

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
- Overlay `params`: `x` and `y` (0 to 1, the center), `scale`, `rotation`, `opacity`, `fit` (`"cover"` or `"contain"`).

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
| `<FitText>` | Text that fills its parent box at the largest size that fits, wrapping as needed. It cannot overflow. Props: `fontFamily`, `fontWeight`, `maxFontSize`, `minFontSize`, `lineHeight`, `align`, `verticalAlign`, `style`. |
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
