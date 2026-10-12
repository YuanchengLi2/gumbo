import {resolve,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';

/** One finding about the edit. mustFix findings block finishing until fixed or kept with a reason; notes are judgement. */
export type EditCheck={id:string;text:string};
export type EditChecks={mustFix:EditCheck[];notes:EditCheck[]};

const seconds=(n:number)=>`${Math.round(n*100)/100}s`;
const changed=<T extends {id:string}>(before:T[],after:T[])=>{const old=new Map(before.map(i=>[i.id,JSON.stringify(i)]));return after.filter(i=>old.get(i.id)!==JSON.stringify(i));};
// A cut this far inside a word clips it; a gap this long between words inside a clip is dead air.
const INSIDE=.05,SILENCE=3;

/** Facts about what an edit changed, from the timeline and the transcript only (never from a reading of the picture):
 * footage used twice, a cut that lands inside a spoken word, silence over three seconds between words inside a clip
 * (must fix, or keep with a reason); slow motion below half speed and one clip taking most of the video (notes). Only
 * clips changed between the two timelines are judged, plus the repeats they lead to. */
export function editChecks(before:TimelineDocument,after:TimelineDocument,footage:FootageIndex):EditChecks{
 const mustFix:EditCheck[]=[],notes:EditCheck[]=[],assets=new Map(footage.assets.map(a=>[a.id,a]));
 const clips=changed(before.spine,after.spine),touched=new Set(clips.map(c=>c.id));
 const words=new Map<string,{text:string;start:number;end:number}[]>();
 for(const w of footage.words){const list=words.get(w.assetId)??[];list.push(w);words.set(w.assetId,list);}
 for(const list of words.values())list.sort((a,b)=>a.start-b.start);
 const name=(assetId:string)=>assets.get(assetId)?.filename??assetId;
 for(const clip of clips){
  const asset=assets.get(clip.assetId);if(!asset||asset.scene||asset.kind==='image'||clip.audio?.mute)continue;
  const spoken=words.get(clip.assetId)??[];
  for(const [edge,at] of [['in',clip.srcIn],['out',clip.srcOut]] as const){
   const word=spoken.find(w=>w.start+INSIDE<at&&w.end-INSIDE>at);
   if(word)mustFix.push({id:`inside-word:${clip.id}:${edge}`,text:`clip ${clip.id} ${edge==='in'?'starts':'ends'} inside the word "${word.text}" (${name(clip.assetId)} ${seconds(word.start)}-${seconds(word.end)}; the cut is at ${seconds(at)}). Cut between words.`});
  }
  const inside=spoken.filter(w=>w.start>=clip.srcIn-INSIDE&&w.end<=clip.srcOut+INSIDE);
  for(let n=1;n<inside.length;n++){const gap=inside[n].start-inside[n-1].end;if(gap/(clip.speed||1)>SILENCE)mustFix.push({id:`silence:${clip.id}:${Math.round(inside[n-1].end*10)/10}`,text:`clip ${clip.id} keeps ${seconds(gap)} of silence between "${inside[n-1].text}" and "${inside[n].text}" (${name(clip.assetId)} ${seconds(inside[n-1].end)}-${seconds(inside[n].start)}).`});}
  if(clip.speed<.5)notes.push({id:`slow:${clip.id}`,text:`clip ${clip.id} plays at ${clip.speed}x: slow motion below half speed looks stretched, so use it only when asked for.`});
 }
 const spine=after.spine;
 for(let i=0;i<spine.length;i++)for(let j=i+1;j<spine.length;j++){const a=spine[i],b=spine[j],shared=Math.min(a.srcOut,b.srcOut)-Math.max(a.srcIn,b.srcIn);
  if(a.assetId===b.assetId&&shared>1&&(touched.has(a.id)||touched.has(b.id))&&!assets.get(a.assetId)?.scene&&!a.holdSec&&!b.holdSec)mustFix.push({id:`repeat:${a.id}:${b.id}`,text:`clips ${a.id} and ${b.id} show the same footage (${name(a.assetId)} ${seconds(Math.max(a.srcIn,b.srcIn))}-${seconds(Math.min(a.srcOut,b.srcOut))}).`});}
 const resolved=resolve(after,footage),total=resolved.durationSec;
 if(total>=15&&spine.length>=3)for(const clip of resolved.clips)if(touched.has(clip.id)&&(clip.end-clip.start)/total>.4)notes.push({id:`long:${clip.id}`,text:`clip ${clip.id} is ${seconds(clip.end-clip.start)} of a ${seconds(total)} video: one shot that long usually drags.`});
 return{mustFix:mustFix.slice(0,30),notes:notes.slice(0,12)};
}
