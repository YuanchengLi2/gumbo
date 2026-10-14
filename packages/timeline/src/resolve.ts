import type {FootageIndex} from '@dream/footage';
import type {Anchor,AttachedItem,MusicClip,SpineClip,TimelineDocument} from './schema';
export type ResolvedClip=SpineClip&{start:number;end:number;from:number;durationInFrames:number};
export type ResolvedItem=AttachedItem&{timelineStart:number;timelineEnd:number};
export type ResolvedMusic=MusicClip&{timelineStart:number;timelineEnd:number};
export type ResolvedWord={id:string;wordId:string;clipId:string;text:string;start:number;end:number;emphasis:boolean};
export type TimelineWarning={code:string;message:string;itemId?:string;severity:'warning'|'error'};
export type ResolvedTimeline={clips:ResolvedClip[];items:ResolvedItem[];music:ResolvedMusic[];words:ResolvedWord[];durationSec:number;durationInFrames:number;warnings:TimelineWarning[]};
export function resolve(t:TimelineDocument,index:FootageIndex):ResolvedTimeline {
 const fps=t.settings.fps;let cursor=0;const warnings:TimelineWarning[]=[];
 const clips=t.spine.map(c=>{const n=Math.max(1,Math.round((c.holdSec??(c.srcOut-c.srcIn)/c.speed)*fps));const start=cursor/fps;const from=cursor;cursor+=n;return {...c,start,end:cursor/fps,from,durationInFrames:n};});
 const byClip=new Map(clips.map(c=>[c.id,c]));const sourceWords=new Map(index.words.map(w=>[w.id,w]));
 let durationSec=Math.max(cursor/fps,t.settings.durationSec??0);
 function anchor(a:Anchor):number|undefined {
  if(a.kind==='project')return(a.at==='start'?0:durationSec)+a.offsetSec;
  const c=byClip.get(a.clipId);if(!c)return undefined;
  if(a.kind==='clip')return (a.at==='start'?c.start:a.at==='end'?c.end:c.start+a.at)+a.offsetSec;
  const w=sourceWords.get(a.wordId);if(!w||w.assetId!==c.assetId||w.start<c.srcIn-.001||w.end>c.srcOut+.001)return undefined;
  return c.start+((a.edge==='start'?w.start:w.end)-c.srcIn)/c.speed+a.offsetSec;
 }
 // Free manual layers contribute their fixed end times; project-end anchors follow
 // the resulting duration instead of recursively extending it.
 if(t.settings.autoDuration!==false){const followsEnd=(a:Anchor)=>a.kind==='project'&&a.at==='end';for(const item of t.attached){if(followsEnd(item.start)||item.end&&followsEnd(item.end))continue;const start=anchor(item.start),end=item.end?anchor(item.end):start===undefined?undefined:start+(item.durationSec??0);if(end!==undefined)durationSec=Math.max(durationSec,end);}for(const music of t.music){if(followsEnd(music.start))continue;const start=anchor(music.start);if(start!==undefined)durationSec=Math.max(durationSec,start+music.srcOut-music.srcIn);}}
 const items:ResolvedItem[]=[];
 for(const item of t.attached){const start=anchor(item.start);const end=item.end?anchor(item.end):start===undefined?undefined:start+(item.durationSec??0);if(start===undefined||end===undefined||end<=start){warnings.push({code:'anchor_removed',message:'Attached item lost its content anchor.',itemId:item.id,severity:'warning'});continue;}items.push({...item,timelineStart:Math.max(0,start),timelineEnd:Math.min(durationSec,end)});}
 const music:ResolvedMusic[]=[];
 for(const m of t.music){const start=anchor(m.start);if(start===undefined){warnings.push({code:'anchor_removed',message:'Music lost its content anchor.',itemId:m.id,severity:'warning'});continue;}music.push({...m,timelineStart:Math.max(0,start),timelineEnd:Math.min(durationSec,start+m.srcOut-m.srcIn)});}
 const words:ResolvedWord[]=[];
 const byAsset=new Map<string,typeof index.words>();
 for(const w of index.words){const list=byAsset.get(w.assetId)??[];list.push(w);byAsset.set(w.assetId,list);}
 for(const list of byAsset.values())list.sort((a,b)=>a.start-b.start);
 const overrides=new Map<string,NonNullable<TimelineDocument['captions']>['overrides'][number]>();
 for(const override of t.captions?.overrides??[])overrides.set(`${override.clipId??'*'}:${override.wordId}`,override);
 // Captions read the speech you hear: main-track clips that are not muted, and speech on other tracks, such as narration
 // recorded separately and laid on the music track at foreground level (gain -10 dB or louder; quiet beds, generated scores
 // and sound effects are left out). The vlog's narration sat on the music track and got no captions at all.
 // captions.params.sources (a list of clip and music ids) chooses the sources exactly instead.
 const chosen=Array.isArray(t.captions?.params?.sources)?new Set((t.captions!.params.sources as unknown[]).map(String)):undefined,assets=new Map(index.assets.map(a=>[a.id,a]));
 const spoken=[...clips.filter(c=>chosen?chosen.has(c.id):!c.audio.mute).map(c=>({id:c.id,assetId:c.assetId,srcIn:c.srcIn,srcOut:c.srcOut,start:c.start,end:c.end,speed:c.speed})),
  ...music.filter(m=>chosen?chosen.has(m.id):m.gainDb>=-10&&!assets.get(m.assetId)?.generated&&!m.scoreId).map(m=>({id:m.id,assetId:m.assetId,srcIn:m.srcIn,srcOut:m.srcOut,start:m.timelineStart,end:m.timelineEnd,speed:1}))];
 for(const c of spoken){const source=byAsset.get(c.assetId)??[];let lo=0,hi=source.length;while(lo<hi){const mid=(lo+hi)>>>1;if(source[mid].start<c.srcIn-.001)lo=mid+1;else hi=mid;}for(let n=lo;n<source.length&&source[n].start<c.srcOut;n++){const w=source[n];if(w.end>c.srcOut+.001)continue;const o={...overrides.get(`*:${w.id}`),...overrides.get(`${c.id}:${w.id}`)};if(o.hidden)continue;words.push({id:`${c.id}:${w.id}`,wordId:w.id,clipId:c.id,text:o.text??w.text,start:c.start+(w.start-c.srcIn)/c.speed,end:Math.min(c.end,c.start+(w.end-c.srcIn)/c.speed),emphasis:o.emphasis??false});}}
 // The same words heard twice (a camera's own sound under a separate microphone recording) are captioned once.
 words.sort((a,b)=>a.start-b.start);for(let n=words.length-1;n>0;n--){const w=words[n];for(let m=n-1;m>=0&&words[m].start>w.start-.35;m--)if(words[m].clipId!==w.clipId&&words[m].text.toLowerCase()===w.text.toLowerCase()){words.splice(n,1);break;}}
 return {clips,items,music,words,durationSec,durationInFrames:Math.max(cursor,Math.round(durationSec*fps)),warnings};
}
