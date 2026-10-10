import {replaceAnchors} from './remap';
import type {FootageIndex} from '@dream/footage';
import {TimelineSchema,type Anchor,type TimelineDocument} from './schema';
import {OpSchema,type Op} from './ops';
export class EditError extends Error {constructor(public code:string,message:string,public fixHint:string=''){super(message);}}
export function apply(t:TimelineDocument,ops:Op[],index:FootageIndex):TimelineDocument {
 const next=structuredClone(t);
 const clip=(id:string)=>{const c=next.spine.find(c=>c.id===id);if(!c)throw new EditError('clip_not_found',`Clip ${id} does not exist.`);return c;};
 const position=(p:number|{after:string})=>typeof p==='number'?Math.min(p,next.spine.length):next.spine.findIndex(c=>c.id===p.after)+1;
 const word=(id:string,asset:string)=>{const w=index.words.find(w=>w.id===id&&w.assetId===asset);if(!w)throw new EditError('word_not_found',`Word ${id} is not in this source.`);return w;};
 const unique=(id:string)=>{if([...next.spine,...next.attached,...next.music].some(x=>x.id===id))throw new EditError('duplicate_id',`Item ${id} already exists.`);};
 for(const raw of ops){const o=OpSchema.parse(raw);switch(o.type){
 case 'insert_clip':unique(o.clip.id);if(typeof o.position!=='number')clip(o.position.after);next.spine.splice(position(o.position),0,o.clip);break;
 case 'trim_clip':{const c=clip(o.clipId);c.srcIn=o.inWord?word(o.inWord,c.assetId).start:(o.srcIn??c.srcIn);c.srcOut=o.outWord?word(o.outWord,c.assetId).end:(o.srcOut??c.srcOut);break;}
 case 'split_clip':{const c=clip(o.clipId);unique(o.newClipId);const image=index.assets.find(a=>a.id===c.assetId)?.kind==='image';const originalDuration=c.holdSec??(c.srcOut-c.srcIn)/c.speed;const splitDuration=Math.round((o.wordId?(word(o.wordId,c.assetId).end-c.srcIn)/c.speed:(o.atSec??0))*next.settings.fps)/next.settings.fps;const totalFrames=Math.max(1,Math.round(originalDuration*next.settings.fps));if(splitDuration<=0||Math.round(splitDuration*next.settings.fps)>=totalFrames)throw new EditError('invalid_split','Split must leave at least one frame on each side.');const cut=c.srcIn+splitDuration*c.speed;const oldEnd=c.srcOut;if(image)c.holdSec=splitDuration;else c.srcOut=cut;const right={...structuredClone(c),id:o.newClipId,srcIn:image?c.srcIn:cut,srcOut:oldEnd,...(image?{holdSec:totalFrames/next.settings.fps-splitDuration}:{}),transitionIn:undefined,reason:o.reason};next.spine.splice(next.spine.indexOf(c)+1,0,right);
  const remap=(a:Anchor):Anchor=>{if(a.kind==='project'||a.clipId!==c.id)return a;if(a.kind==='word'){return word(a.wordId,c.assetId).start>=cut?{...a,clipId:right.id}:a;}if(a.at==='end')return {...a,clipId:right.id};if(typeof a.at==='number'&&a.at>=splitDuration)return {...a,clipId:right.id,at:Math.min(a.at-splitDuration,originalDuration-splitDuration)};return a;};
  next.attached=next.attached.map(i=>({...i,start:remap(i.start),end:i.end?remap(i.end):undefined}));next.music=next.music.map(m=>({...m,start:remap(m.start)}));if(next.captions)next.captions.overrides=next.captions.overrides.map(v=>v.clipId===c.id&&word(v.wordId,c.assetId).start>=cut?{...v,clipId:right.id}:v);break;}
 case 'move_clip':{const c=clip(o.clipId);if(typeof o.position!=='number'&&o.position.after===c.id)break;if(typeof o.position!=='number')clip(o.position.after);next.spine.splice(next.spine.indexOf(c),1);next.spine.splice(position(o.position),0,c);break;}
 case 'delete_clips':o.clipIds.forEach(clip);next.spine=next.spine.filter(c=>!o.clipIds.includes(c.id));break;
 case 'replace_clip_source':{const c=clip(o.clipId),old=structuredClone(c);for(const [from,to] of Object.entries(o.wordMap??{})){word(from,old.assetId);const target=word(to,o.assetId);if(target.start<o.srcIn||target.end>o.srcOut)throw new EditError('invalid_word_mapping','Replacement words must lie inside the replacement range.');}c.assetId=o.assetId;c.srcIn=o.srcIn;c.srcOut=o.srcOut;if(index.assets.find(a=>a.id===o.assetId)?.kind!=='image')c.holdSec=undefined;if(c.framing?.faceTrackId&&old.assetId!==o.assetId)c.framing={...c.framing,mode:'fit',faceTrackId:undefined};replaceAnchors(next,old,c,index,o.wordMap);break;}
 case 'set_clip_hold':{const c=clip(o.clipId);if(index.assets.find(a=>a.id===c.assetId)?.kind!=='image')throw new EditError('not_still','Only still images have a hold duration.');c.holdSec=o.holdSec;break;}
 case 'set_track_settings':next.trackSettings??={};next.trackSettings[o.trackId]={...next.trackSettings[o.trackId],...o.settings};break;
 case 'set_speed':clip(o.clipId).speed=o.speed;break;
 case 'set_framing':clip(o.clipId).framing=o.framing;break;
 case 'set_clip_audio':Object.assign(clip(o.clipId).audio,o.audio);break;
 case 'set_transition':clip(o.clipId).transitionIn=o.transition??undefined;break;
 case 'add_item':unique(o.item.id);next.attached.push(o.item);break;
 case 'update_item':{const i=next.attached.find(i=>i.id===o.itemId);if(!i)throw new EditError('item_not_found','Attached item not found.');if(o.clearEnd)delete i.end;Object.assign(i,o.changes);break;}
 case 'remove_item':if(!next.attached.some(i=>i.id===o.itemId))throw new EditError('item_not_found','Attached item not found.');next.attached=next.attached.filter(i=>i.id!==o.itemId);break;
 case 'set_captions':next.captions=o.captions??undefined;break;
 case 'update_caption_overrides':if(!next.captions)throw new EditError('captions_missing','Enable captions first.');for(const v of o.overrides){next.captions.overrides=next.captions.overrides.filter(x=>!(x.wordId===v.wordId&&x.clipId===v.clipId));next.captions.overrides.push(v);}break;
 case 'add_music':unique(o.music.id);next.music.push(o.music);break;
 case 'update_music':{const m=next.music.find(m=>m.id===o.musicId);if(!m)throw new EditError('music_not_found','Music not found.');Object.assign(m,o.changes);break;}
 case 'remove_music':next.music=next.music.filter(m=>m.id!==o.musicId);break;
 case 'set_project_settings':Object.assign(next.settings,o.settings);break;
 case 'set_story_beats':next.beats=o.beats;break;
 }}
 return TimelineSchema.parse(next);
}
