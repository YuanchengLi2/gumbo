import {ScoreSchema,ScoreOptionsSchema,type ScoreDocument,type ScoreOptions,type Instrument} from './schema';

/** Presets expand into explicit editable notes. Rendering never improvises a different arrangement. */
export function arrangeScore(input:ScoreOptions):ScoreDocument{
 const o=ScoreOptionsSchema.parse(input),beatSec=60/o.tempo,total=o.durationSec/beatSec,bar=4,minor=o.mood==='cinematic'||o.mood==='pulse';
 const parts=total<8?[{kind:'body' as const,from:0,to:total}]:[{kind:'intro' as const,from:0,to:Math.min(bar,total*.2)},{kind:'body' as const,from:Math.min(bar,total*.2),to:total*.65},{kind:'build' as const,from:total*.65,to:Math.max(total*.65,total-bar)},{kind:'ending' as const,from:Math.max(total*.65,total-bar),to:total}].filter(p=>p.to>p.from);
 const sections=parts.map((p,i)=>({id:`section-${i}`,name:p.kind[0].toUpperCase()+p.kind.slice(1),kind:p.kind,startBeat:p.from,durationBeats:p.to-p.from,intensity:p.kind==='intro'?o.intensity*.5:p.kind==='build'?Math.min(1,o.intensity+.2):o.intensity}));
 const instruments:Instrument[]=o.instruments.flatMap(i=>i==='drums'?['kick','snare','hat'] as Instrument[]:[i]);
 if(o.mood==='cinematic'&&total>=16)instruments.push('riser','impact');
 const progression=[[0,5,9,7],[0,9,5,7],[0,7,5,9],[9,5,0,7],[0,5,7,0]][Math.abs(o.seed)%5];
 const tracks=[...new Set(instruments)].map((instrument,trackIndex)=>{
  const notes:ScoreDocument['tracks'][number]['notes']=[];
  const add=(beat:number,length:number,pitch:number,velocity:number)=>{const section=sections.find(s=>beat>=s.startBeat&&beat<s.startBeat+s.durationBeats)??sections.at(-1)!;notes.push({id:`n-${trackIndex}-${notes.length}`,beat,durationBeats:length,pitch,velocity:Math.min(1,velocity*(.45+section.intensity*.55)),sectionId:section.id});};
  for(let b=0;b<total;b+=.5){
   const section=sections.find(s=>b>=s.startBeat&&b<s.startBeat+s.durationBeats)!;const root=48+o.key+progression[Math.floor(b/8)%4],triad=[0,minor?3:4,7],ending=section.kind==='ending';
   if(instrument==='pad'&&b%4===0)for(const interval of triad)add(b,Math.min(4.1,total-b),root+interval,.7);
   if(instrument==='bass'&&b%1===0&&(!ending||b%2===0))add(b,.8,root-12,.75);
   if((instrument==='pluck'||instrument==='keys')&&b%1===0)add(b,.85,root+12+[0,triad[1],7,12][(b+Math.abs(o.seed))%4],.6);
   if(instrument==='lead'&&b%2===0&&section.kind!=='intro')add(b,1.4,root+24+[0,7,triad[1],2][Math.floor(b/2)%4],.4);
   if(instrument==='kick'&&b%2===0)add(b,.4,36,.75);
   if(instrument==='snare'&&b%2===1&&section.kind!=='intro')add(b,.35,38,.5);
   if(instrument==='hat'&&(o.intensity>.5||b%1===0)&&section.kind!=='ending')add(b,.15,42,.3);
  }
  for(const section of sections){if(instrument==='riser'&&section.kind==='build')add(section.startBeat,section.durationBeats,60,.5);if(instrument==='impact'&&section.kind==='ending')add(section.startBeat,1,36,.65);}
  return{id:`track-${instrument}`,name:instrument[0].toUpperCase()+instrument.slice(1),instrument,gainDb:0,pan:instrument==='pluck'?-.18:instrument==='keys'?.18:0,mute:false,notes,automation:[]};
 });
 return ScoreSchema.parse({...o,schemaVersion:2,meter:{beatsPerBar:4,beatUnit:4},mode:minor?'minor':'major',sections,tracks,bindings:[]});
}

export function bindScore(input:ScoreDocument,beats:{id:string;startSec:number;durationSec:number}[]){
 const score=structuredClone(ScoreSchema.parse(input)),secondsPerBeat=60/score.tempo,changes:string[]=[];
 for(const binding of score.bindings){const beat=beats.find(b=>b.id===binding.beatId),section=score.sections.find(s=>s.id===binding.sectionId)!;if(!beat)continue;
  const start=Math.max(0,(beat.startSec+binding.offsetSec)/secondsPerBeat),length=binding.followDuration?Math.max(1/16,beat.durationSec/secondsPerBeat):section.durationBeats;
  if(Math.abs(start-section.startBeat)<1e-8&&Math.abs(length-section.durationBeats)<1e-8)continue;
  for(const track of score.tracks)for(const note of track.notes.filter(n=>n.sectionId===section.id)){note.beat=start+(note.beat-section.startBeat)*length/section.durationBeats;note.durationBeats*=length/section.durationBeats;}
  section.startBeat=start;section.durationBeats=length;changes.push(section.id);
 }
 if(changes.length)score.durationSec=Math.max(...score.sections.map(s=>(s.startBeat+s.durationBeats)*secondsPerBeat));
 return{score:ScoreSchema.parse(score),changedSections:changes,unresolved:score.bindings.filter(b=>!beats.some(t=>t.id===b.beatId)).map(b=>b.beatId)};
}
