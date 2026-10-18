import {it,expect} from 'vitest';
import {AssetSchema,emptyFootage} from '@dream/footage';
import {emptyTimeline,ClipSchema,apply,resolve} from '@dream/timeline';
import {setKeyframe,splitRemove,selectableIds,libraryOps} from '../../apps/desktop/src/renderer/manual/model';

const footage=emptyFootage();footage.assets=[AssetSchema.parse({id:'v',filename:'Video',kind:'video',originalPath:'v.mp4',durationSec:20,hasAudio:true,fingerprint:'v'})];
const timeline=()=>{const t=emptyTimeline('t');t.spine=['a','b'].map(id=>ClipSchema.parse({id,assetId:'v',srcIn:0,srcOut:4,reason:'Fixture'}));return t;};

it('sets a keyframe at the playhead, updates the one within half a frame, and removes a value without leaving empty keyframes',()=>{
 let keys=setKeyframe(undefined,2,'scale',1.2,30);expect(keys).toEqual([{sec:2,easing:'linear',scale:1.2}]);
 keys=setKeyframe(keys,1,'scale',1,30);expect(keys.map(k=>k.sec)).toEqual([1,2]);
 keys=setKeyframe(keys,2+.01,'opacity',.5,30);expect(keys[1]).toEqual({sec:2,easing:'linear',scale:1.2,opacity:.5});
 keys=setKeyframe(keys,2,'scale',undefined,30);expect(keys[1]).toEqual({sec:2,easing:'linear',opacity:.5});
 keys=setKeyframe(keys,2,'opacity',undefined,30);expect(keys).toEqual([{sec:1,easing:'linear',scale:1}]);
});

it('splits at the playhead and removes the left or right part, as OpenCut does with Q and W',()=>{
 const t=timeline();
 const left=apply(t,splitRemove(t,footage,[],1,'left'),footage),right=apply(t,splitRemove(t,footage,[],1,'right'),footage);
 expect(resolve(left,footage).clips.map(c=>[c.srcIn,c.srcOut])).toEqual([[1,4],[0,4]]);
 expect(resolve(right,footage).clips.map(c=>[c.srcIn,c.srcOut])).toEqual([[0,1],[0,4]]);
 // Only the selected block is cut when something is selected; the playhead must cross it.
 expect(splitRemove(t,footage,['b'],1,'left')).toEqual([]);
 expect(selectableIds(t,footage)).toEqual(['a','b']);
});

it('puts library pieces on the timeline as CapCut does: text and stickers at the playhead, effects and filters over a clip',()=>{
 const t=timeline();
 const [, text]=libraryOps(t,footage,{kind:'text',id:'subtitle'},1.5) as any[];
 expect(text.item).toMatchObject({type:'overlay',component:'text',start:{kind:'project',offsetSec:1.5},durationSec:3,params:{text:'A line of dialogue',style:'subtitle',x:.5,y:.86}});
 const sticker=libraryOps(t,footage,{kind:'sticker',id:'heart'},0).find(o=>o.type==='add_item') as any;expect(sticker.item).toMatchObject({component:'sticker',params:{sticker:'heart'}});
 // An effect dropped on a clip follows that clip; a filter dropped on a clip grades the clip's own picture.
 const effect=libraryOps(t,footage,{kind:'effect',id:'vignette'},5,{clipId:'b'}).find(o=>o.type==='add_item') as any;
 expect(effect.item).toMatchObject({type:'effect',component:'vignette',start:{kind:'clip',clipId:'b',at:'start'},end:{kind:'clip',clipId:'b',at:'end'},params:{amount:.5}});
 expect(libraryOps(t,footage,{kind:'filter',id:'warm'},5,{clipId:'b',onClip:true})).toEqual([expect.objectContaining({type:'set_framing',clipId:'b',framing:expect.objectContaining({filter:'warm',filterIntensity:1})})]);
 // A second piece over the same time goes on the next row.
 const once=apply(t,libraryOps(t,footage,{kind:'text',id:'basic'},0),footage),twice=libraryOps(once,footage,{kind:'text',id:'basic'},1).find(o=>o.type==='add_item') as any;expect(twice.item.layer).toBe(1);
 expect(()=>libraryOps(t,footage,{kind:'sticker',id:'nope'},0)).toThrow('Unknown sticker');
});
