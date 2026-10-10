import {it,expect} from 'vitest';
import {apply,emptyTimeline,resolve,ClipSchema,ItemSchema} from '@dream/timeline';
import {AssetSchema,emptyFootage} from '@dream/footage';

it('splits an image hold without doubling its duration or moving an attachment',()=>{
 const image=AssetSchema.parse({id:'image',kind:'image',filename:'still.png',durationSec:5,originalPath:'still.png',fingerprint:'fixture'});
 const index={...emptyFootage(),assets:[image]};
 const timeline={...emptyTimeline('p'),spine:[ClipSchema.parse({id:'still',assetId:'image',srcIn:0,srcOut:5,holdSec:10,reason:'fixture'})],attached:[ItemSchema.parse({id:'title',type:'overlay',component:'title_card',start:{kind:'clip',clipId:'still',at:7},durationSec:1,reason:'fixture'})]};
 const split=apply(timeline,[{type:'split_clip',clipId:'still',newClipId:'right',atSec:4,reason:'fixture'}],index);
 expect(split.spine.map(c=>c.holdSec)).toEqual([4,6]);
 expect(resolve(split,index).durationInFrames).toBe(300);
 expect(resolve(split,index).items[0].timelineStart).toBe(7);
});

it('replaces source-word anchors with occurrence-specific placement without inventing word identities',()=>{
 const assets=['a','b'].map(id=>AssetSchema.parse({id,kind:'video',filename:id+'.mp4',durationSec:20,originalPath:id+'.mp4',fingerprint:id}));
 const index={...emptyFootage(),assets,words:[{id:'word',assetId:'a',text:'hello',start:4,end:5,confidence:1,speaker:'unknown',pauseBefore:0}]};
 const clip=(id:string)=>ClipSchema.parse({id,assetId:'a',srcIn:0,srcOut:10,reason:'fixture'});
 const item=(id:string,clipId:string)=>ItemSchema.parse({id,type:'overlay',component:'title_card',start:{kind:'word',clipId,wordId:'word',edge:'start'},durationSec:1,reason:'fixture'});
 const timeline={...emptyTimeline('p'),spine:[clip('first'),clip('second')],attached:[item('one','first'),item('two','second')]};
 const result=apply(timeline,[{type:'replace_clip_source',clipId:'first',assetId:'b',srcIn:0,srcOut:20,reason:'new take'}],index);
 expect(result.attached[0].start).toMatchObject({kind:'clip',clipId:'first',at:8});
 expect(result.attached[1].start).toMatchObject({kind:'word',clipId:'second',wordId:'word'});
 expect(resolve(result,index).items.map(i=>i.timelineStart)).toEqual([8,24]);
});
