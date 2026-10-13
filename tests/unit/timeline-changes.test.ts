import {describe,it,expect} from 'vitest';
import {emptyTimeline,apply,timelineChangeList,type SpineClip,type TimelineDocument} from '@dream/timeline';
import {AssetSchema,emptyFootage} from '@dream/footage';

const asset=AssetSchema.parse({id:'a',filename:'source.mp4',kind:'video',durationSec:30,originalPath:'source.mp4',fingerprint:'fixture'});
const footage={...emptyFootage(),assets:[asset]};
const clip=(id:string,srcIn=0,srcOut=5):SpineClip=>({id,assetId:'a',srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'fixture'});
const name=()=>'source.mp4';
const before:TimelineDocument={...emptyTimeline('p'),spine:[clip('one'),clip('two',5,10),clip('three',10,15)],
 attached:[{id:'title',type:'overlay',component:'title_card',params:{text:'Hello'},start:{kind:'project',at:'start',offsetSec:0},durationSec:2,layer:0,reason:'fixture'},
  {id:'gone',type:'overlay',component:'lower_third',params:{text:'Name'},start:{kind:'project',at:'start',offsetSec:1},durationSec:2,layer:1,reason:'fixture'}],music:[]};
// A request trims and speeds up one clip, adds a transition, removes a clip, adds a clip, retitles, and removes an element.
const after:TimelineDocument={...before,
 spine:[{...clip('one',1,4),speed:1.5},{...clip('two',5,10),transitionIn:{type:'crossfade',durationSec:.5}},clip('four',20,24)],
 attached:[{...before.attached[0],params:{text:'Welcome'}},{id:'arrow',type:'overlay',component:'callout_arrow',params:{},start:{kind:'project',at:'start',offsetSec:3},durationSec:1,layer:2,reason:'fixture'}]};

describe('change cards',()=>{
 const changes=timelineChangeList(before,after,{name,footage});
 it('lists each change with where it is and what it did',()=>{
  const by=(key:string)=>changes.find(c=>c.key===key)!;
  expect(by('clip~one')).toMatchObject({kind:'changed',target:'clip',title:'Edited source.mp4'});expect(by('clip~one').details.join(' ')).toContain('Speed 1× → 1.5×');expect(by('clip~one').start).toBe(0);
  expect(by('clip~two').details).toEqual(['Transition cut → cross dissolve']);
  expect(by('clip-three')).toMatchObject({kind:'removed'});expect(by('clip+four')).toMatchObject({kind:'added',title:'Added source.mp4'});
  expect(by('item~title').title).toBe('Edited title card “Welcome”');expect(by('item~title').details).toContain('text');
  expect(by('item+arrow').title).toBe('Added arrow');expect(by('item-gone').title).toBe('Removed lower third “Name”');
 });
 it('undoes each change alone',()=>{
  for(const change of changes){
   const restored=apply(after,change.restore!,footage);
   if(change.target==='clip'&&change.kind!=='added'){const was=before.spine.find(c=>c.id===change.id)!,now=restored.spine.find(c=>c.id===change.id)!;expect({...now,reason:''}).toEqual({...was,reason:''});}
   if(change.kind==='added')expect([...restored.spine,...restored.attached,...restored.music].some(i=>i.id===change.id)).toBe(false);
   if(change.target==='element'&&change.kind!=='added'){const was=before.attached.find(i=>i.id===change.id)!,now=restored.attached.find(i=>i.id===change.id)!;expect({...now,reason:''}).toEqual({...was,reason:''});}
   // Everything else is left as the request made it.
   for(const other of changes.filter(c=>c!==change&&c.id&&c.kind==='changed'&&c.id!==change.id)){const a=[...after.spine,...after.attached].find(i=>i.id===other.id),b=[...restored.spine,...restored.attached].find(i=>i.id===other.id);expect(b).toEqual(a);}
  }
 });
});
