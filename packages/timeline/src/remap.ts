import type {FootageIndex} from '@dream/footage';
import type {Anchor,SpineClip,TimelineDocument} from './schema';

export function mapAnchors(timeline:TimelineDocument,map:(anchor:Anchor)=>Anchor){
  timeline.attached=timeline.attached.map(item=>({...item,start:map(item.start),end:item.end?map(item.end):undefined}));
  timeline.music=timeline.music.map(item=>({...item,start:map(item.start)}));
}

/** Source words are identities, not labels. A replacement without an explicit word
 * correspondence retains placement as a clip anchor instead of inventing dialogue. */
export function replaceAnchors(timeline:TimelineDocument,old:SpineClip,next:SpineClip,index:FootageIndex,wordMap:Record<string,string>={}){
  const oldDuration=old.holdSec??(old.srcOut-old.srcIn)/old.speed;
  const newDuration=next.holdSec??(next.srcOut-next.srcIn)/next.speed;
  const scale=(seconds:number)=>Math.max(0,Math.min(newDuration,seconds/oldDuration*newDuration));
  mapAnchors(timeline,anchor=>{
    if(anchor.kind==='project'||anchor.clipId!==old.id)return anchor;
    if(anchor.kind==='clip')return typeof anchor.at==='number'?{...anchor,at:scale(anchor.at)}:anchor;
    const mapped=wordMap[anchor.wordId];
    if(mapped)return {...anchor,wordId:mapped};
    const source=index.words.find(word=>word.id===anchor.wordId&&word.assetId===old.assetId);
    if(!source)throw new Error(`Cannot remap missing source word ${anchor.wordId}.`);
    const at=scale(((anchor.edge==='start'?source.start:source.end)-old.srcIn)/old.speed);
    return {kind:'clip',clipId:old.id,at,offsetSec:anchor.offsetSec};
  });
  if(timeline.captions)timeline.captions.overrides=timeline.captions.overrides.flatMap(override=>{
    if(override.clipId!==old.id)return [override];
    const wordId=wordMap[override.wordId];
    return wordId?[{...override,wordId}]:[];
  });
}
