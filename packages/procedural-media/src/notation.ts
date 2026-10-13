import {z} from 'zod';
import {InstrumentSchema,ScoreSchema,describeIssues,type ScoreDocument,type Instrument} from './schema';

/** Music written as data. A score file is either a full ScoreDocument (schemaVersion 2) or this compact notation, which
 * Dream expands into one: drum step patterns, note strings, chord progressions and arpeggios. No authored code runs. */
const TrackNotation=z.object({
 id:z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).optional(),name:z.string().max(80).optional(),instrument:InstrumentSchema,
 gainDb:z.number().min(-60).max(12).optional(),pan:z.number().min(-1).max(1).optional(),mute:z.boolean().optional(),
 sections:z.array(z.string()).max(100).optional(),repeat:z.union([z.boolean(),z.number().int().min(1).max(512)]).optional(),octave:z.number().int().min(0).max(8).optional(),velocity:z.number().min(0).max(1).optional(),
 pattern:z.string().max(4096).optional(),stepsPerBeat:z.number().int().min(1).max(8).optional(),pitch:z.string().max(8).optional(),
 notes:z.string().max(20000).optional(),
 chords:z.array(z.string().max(16)).max(256).optional(),chordBeats:z.number().positive().max(64).optional(),
 arp:z.object({chords:z.array(z.string().max(16)).min(1).max(256),pattern:z.enum(['up','down','updown','random']).default('up'),rate:z.string().default('16n'),octaves:z.number().int().min(1).max(4).default(1),chordBeats:z.number().positive().max(64).optional()}).optional(),
});
export const ScoreNotationSchema=z.object({
 title:z.string().min(1).max(120).default('Original score'),seed:z.number().int().default(1),tempo:z.number().min(40).max(200),
 meter:z.string().regex(/^\d{1,2}\/(4|8)$/).default('4/4'),key:z.string().max(16).default('C major'),
 mood:z.enum(['calm','bright','cinematic','pulse','warm']).default('bright'),intensity:z.number().min(0).max(1).default(.6),
 durationSec:z.number().positive().max(600).optional(),
 sections:z.array(z.object({name:z.string().min(1).max(80),bars:z.number().positive().max(512),kind:z.enum(['intro','body','build','break','ending']).default('body'),intensity:z.number().min(0).max(1).optional()})).max(100).optional(),
 tracks:z.array(TrackNotation).min(1).max(16),
});
export type ScoreNotation=z.input<typeof ScoreNotationSchema>;

const NAMES:Record<string,number>={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
const DRUM_PITCH:Partial<Record<Instrument,number>>={kick:36,snare:38,hat:42,tom:45,shaker:70,cymbal:49,riser:60,impact:36};
const DRUMS=new Set(Object.keys(DRUM_PITCH));
export class NotationError extends Error{constructor(public field:string,message:string){super(`${field}: ${message}`);this.name='NotationError';}}

/** C4 = 60. Accepts sharps (#) and flats (b). */
export function noteNumber(token:string,field='note'):number{
 const match=/^([A-Ga-g])(#|b)?(-?\d)$/.exec(token);if(!match)throw new NotationError(field,`"${token}" is not a note (use names like C4, F#3, Bb2).`);
 const value=(Number(match[3])+1)*12+NAMES[match[1].toLowerCase()]+(match[2]==='#'?1:match[2]==='b'?-1:0);
 if(value<0||value>127)throw new NotationError(field,`"${token}" is outside the playable range.`);return value;
}
/** Length in beats of the meter's beat unit: 1n whole, 2n, 4n, 8n, 16n, 32n; a dot adds half, t makes a triplet. */
export function durationBeats(token:string,beatUnit:number,field='duration'):number{
 const match=/^(1|2|4|8|16|32)(n|t)(\.)?$/.exec(token);if(!match)throw new NotationError(field,`"${token}" is not a duration (use 1n, 2n, 4n, 8n, 16n, 32n, with . for dotted or t for triplets).`);
 let beats=4/Number(match[1])*(beatUnit/4);if(match[2]==='t')beats*=2/3;if(match[3])beats*=1.5;return beats;
}
const QUALITIES:Record<string,number[]>={'':[0,4,7],m:[0,3,7],min:[0,3,7],dim:[0,3,6],aug:[0,4,8],sus2:[0,2,7],sus4:[0,5,7],'7':[0,4,7,10],maj7:[0,4,7,11],m7:[0,3,7,10],min7:[0,3,7,10],dim7:[0,3,6,9],m7b5:[0,3,6,10],'6':[0,4,7,9],m6:[0,3,7,9],add9:[0,4,7,14],'9':[0,4,7,10,14],m9:[0,3,7,10,14],'5':[0,7]};
/** Chord symbols such as Am, F, Cmaj7, G7, Dsus4, C/E, as MIDI notes voiced around the given octave. */
export function chordNotes(symbol:string,octave:number,field='chord'):number[]{
 const [main,bass]=symbol.split('/'),match=/^([A-Ga-g])(#|b)?(.*)$/.exec(main??'');
 if(!match||!(match[3] in QUALITIES))throw new NotationError(field,`"${symbol}" is not a chord (use symbols like Am, F, Cmaj7, G7, Dsus4, C/E).`);
 const root=noteNumber(match[1].toUpperCase()+(match[2]??'')+octave,field),notes=QUALITIES[match[3]].map(step=>root+step);
 if(bass)notes.unshift(noteNumber(bass.toUpperCase().replace(/^([A-G])B/,'$1b')+(octave-1),field));
 return notes.filter(n=>n>=0&&n<=127);
}
function parseKey(text:string):{key:number;mode:'major'|'minor'}{
 const match=/^([A-Ga-g])(#|b)?\s*(major|minor|maj|min|m)?$/i.exec(text.trim());if(!match)throw new NotationError('key',`"${text}" is not a key (use names like C major or A minor).`);
 const key=(NAMES[match[1].toLowerCase()]+(match[2]==='#'?1:match[2]==='b'?-1:0)+12)%12;return{key,mode:/^(minor|min|m)$/i.test(match[3]??'')?'minor':'major'};
}

type Event={beat:number;durationBeats:number;pitch:number;velocity:number};
/** One loop of a track as events relative to its start, plus the loop length in beats. */
function trackLoop(track:z.output<typeof TrackNotation>,index:number,beatUnit:number,beatsPerBar:number):{events:Event[];length:number}{
 const field=`tracks[${index}]`,velocity=track.velocity??.8,octave=track.octave;
 const sources=[track.pattern,track.notes,track.chords,track.arp].filter(v=>v!==undefined).length;
 if(sources!==1)throw new NotationError(field,'give exactly one of pattern, notes, chords or arp.');
 if(track.pattern!==undefined){
  const steps=track.pattern.replace(/[\s|]/g,''),perBeat=track.stepsPerBeat??4,step=1/perBeat;if(!steps.length)throw new NotationError(field+'.pattern','is empty.');
  const pitch=track.pitch?noteNumber(track.pitch,field+'.pitch'):DRUM_PITCH[track.instrument]??noteNumber('C'+(octave??3),field);
  const events:Event[]=[];[...steps].forEach((c,n)=>{if(c==='.'||c==='-')return;const v=c==='X'?1:c==='x'?velocity:c==='o'?velocity*.55:NaN;if(Number.isNaN(v))throw new NotationError(field+'.pattern',`"${c}" at step ${n+1} is not a step (use x for a hit, X for an accent, o for a soft hit and . for a rest).`);events.push({beat:n*step,durationBeats:DRUMS.has(track.instrument)?step:step*.9,pitch,velocity:v});});
  return{events,length:steps.length*step};
 }
 if(track.notes!==undefined){
  let beat=0,length=durationBeats('4n',beatUnit);const events:Event[]=[];
  track.notes.trim().split(/\s+/).filter(Boolean).forEach((token,n)=>{
   const [name,dur]=token.split(':');if(dur)length=durationBeats(dur,beatUnit,`${field}.notes token ${n+1}`);
   if(name!=='r'&&name!=='R'){const pitches=name.split('+').map(part=>noteNumber(part,`${field}.notes token ${n+1}`));for(const pitch of pitches)events.push({beat,durationBeats:length*.95,pitch,velocity});}
   beat+=length;
  });
  return{events,length:beat};
 }
 const chordList=track.chords??track.arp!.chords,chordBeats=track.chordBeats??track.arp?.chordBeats??beatsPerBar;
 const voiced=chordList.map((symbol,n)=>chordNotes(symbol,octave??(track.instrument==='bass'?2:3),`${field}.${track.chords?'chords':'arp.chords'}[${n}]`));
 if(track.chords){const events=voiced.flatMap((notes,n)=>(track.instrument==='bass'?[notes[0]]:notes).map(pitch=>({beat:n*chordBeats,durationBeats:chordBeats*.98,pitch,velocity})));return{events,length:voiced.length*chordBeats};}
 const arp=track.arp!,rate=durationBeats(arp.rate,beatUnit,`${field}.arp.rate`),events:Event[]=[];
 voiced.forEach((notes,n)=>{let ladder=Array.from({length:arp.octaves},(_,o)=>notes.map(p=>p+12*o)).flat().filter(p=>p<=127);if(arp.pattern==='down')ladder=ladder.reverse();if(arp.pattern==='updown')ladder=[...ladder,...ladder.slice(1,-1).reverse()];
  for(let k=0;k*rate<chordBeats-1e-9;k++){const pick=arp.pattern==='random'?ladder[(n*7919+k*104729)%ladder.length]:ladder[k%ladder.length];events.push({beat:n*chordBeats+k*rate,durationBeats:rate*.9,pitch:pick,velocity});}});
 return{events,length:voiced.length*chordBeats};
}

/** Expands notation (or validates a full document) into a ScoreDocument. Errors name the field that is wrong. */
export function scoreFromNotation(input:unknown,id='score'):ScoreDocument{
 if(input&&typeof input==='object'&&(input as any).schemaVersion===2){const full=ScoreSchema.safeParse({...(input as object),id:(input as any).id??id});if(!full.success)throw new NotationError('score',describeIssues(full.error,'score'));return full.data;}
 const parsed=ScoreNotationSchema.safeParse(input);
 if(!parsed.success)throw new NotationError('score',describeIssues(parsed.error,'score'));
 const notation=parsed.data,[beatsPerBar,beatUnit]=notation.meter.split('/').map(Number) as [number,4|8],{key,mode}=parseKey(notation.key);
 const barBeats=beatsPerBar,beatSec=60/notation.tempo;
 const loops=notation.tracks.map((track,n)=>trackLoop(track,n,beatUnit,beatsPerBar));
 // Sections: as written, or one body section long enough for the longest track (or the requested duration).
 const longest=Math.max(...loops.map(l=>l.length),barBeats),totalFromDuration=notation.durationSec?Math.round(notation.durationSec/beatSec*1000)/1000:undefined;
 let start=0;const sections=(notation.sections?.length?notation.sections:[{name:'main',bars:Math.ceil((totalFromDuration??longest)/barBeats),kind:'body' as const,intensity:undefined}]).map((section,n)=>{const value={id:'s'+n,name:section.name,kind:section.kind,startBeat:start,durationBeats:section.bars*barBeats,intensity:section.intensity??notation.intensity};start+=value.durationBeats;return value;});
 const total=totalFromDuration??start,durationSec=Math.min(600,total*beatSec);
 const names=new Map(sections.map(s=>[s.name,s]));
 const tracks=notation.tracks.map((track,n)=>{
  const loop=loops[n],targets=track.sections?.length?track.sections.map(name=>{const section=names.get(name);if(!section)throw new NotationError(`tracks[${n}].sections`,`"${name}" is not a section (sections: ${[...names.keys()].join(', ')}).`);return section;}):sections;
  const notes:ScoreDocument['tracks'][number]['notes']=[];let counter=0;
  for(const section of targets){
   const end=Math.min(section.startBeat+section.durationBeats,total),times=track.repeat===false?1:typeof track.repeat==='number'?track.repeat:Infinity;
   for(let r=0;r<times&&loop.length>0;r++){const offset=section.startBeat+r*loop.length;if(offset>=end-1e-9)break;
    for(const event of loop.events){const beat=offset+event.beat;if(beat>=end-1e-9)continue;notes.push({id:`${n}-${counter++}`,beat:Math.round(beat*1e6)/1e6,durationBeats:Math.max(.01,Math.min(event.durationBeats,end-beat)),pitch:event.pitch,velocity:event.velocity,sectionId:section.id});}}
  }
  return{id:track.id??`t${n}`,name:track.name??track.instrument,instrument:track.instrument,gainDb:track.gainDb??0,pan:track.pan??0,mute:track.mute??false,notes,automation:[]};
 });
 const document={schemaVersion:2 as const,id,title:notation.title,seed:notation.seed,tempo:notation.tempo,meter:{beatsPerBar,beatUnit},key,mode,durationSec,mood:notation.mood,intensity:notation.intensity,sections,tracks,bindings:[]};
 const checked=ScoreSchema.safeParse(document);if(!checked.success)throw new NotationError('score',describeIssues(checked.error,'score'));
 return checked.data;
}

const round=(value:number,places=2)=>Math.round(value*10**places)/10**places;
/** What a score file will play, for checking before publishing: length in bars and seconds, sections, and each track's
 * loop length. A track whose loop is not a whole number of bars drifts against the bar line, which is reported. */
export function describeScore(input:unknown,id='score'){
 const score=scoreFromNotation(input,id),barBeats=score.meter.beatsPerBar,warnings:string[]=[];
 const notation=input&&typeof input==='object'&&(input as any).schemaVersion!==2?ScoreNotationSchema.parse(input):undefined;
 const tracks=score.tracks.map((track,n)=>{
  const end=track.notes.reduce((max,note)=>Math.max(max,note.beat+note.durationBeats),0),loop=notation?trackLoop(notation.tracks[n],n,score.meter.beatUnit,barBeats).length/barBeats:undefined;
  if(!track.notes.length)warnings.push(`tracks[${n}] (${track.instrument}) plays no notes.`);
  if(loop!==undefined&&Math.abs(loop-Math.round(loop))>1e-6)warnings.push(`tracks[${n}] (${track.instrument}) loops every ${round(loop,3)} bars, so it drifts against the bar line; make its pattern or notes fill whole bars.`);
  return{track:n,instrument:track.instrument,notes:track.notes.length,...(loop!==undefined?{loopBars:round(loop,3)}:{}),endsAtBar:round(end/barBeats)};
 });
 return{tempo:score.tempo,meter:`${score.meter.beatsPerBar}/${score.meter.beatUnit}`,durationSec:round(score.durationSec),bars:round(score.durationSec/(60/score.tempo)/barBeats),sections:score.sections.map(section=>({name:section.name,startBar:round(section.startBeat/barBeats),bars:round(section.durationBeats/barBeats)})),tracks,warnings};
}
