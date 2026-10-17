import {it,expect} from 'vitest';
import {emptyTimeline,TimelineSchema} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {prepare,frameAt,type MediaLayer} from '@dream/compositor';
import {upcoming,continues,pickVideo,LOOKAHEAD_SEC} from '../../apps/desktop/src/renderer/engine/lookahead';
import {keyframeGap} from '../../apps/project-service/src/media-io';

const footage=()=>{const f=emptyFootage();f.assets=['a','b','c'].map(id=>AssetSchema.parse({id,filename:id+'.mp4',kind:'video',originalPath:id+'.mp4',durationSec:30,width:1920,height:1080,fps:30,hasAudio:false,fingerprint:id,status:'ready'}));return f;};
const clip=(id:string,assetId:string,srcIn:number,srcOut:number)=>({id,assetId,srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''});
const timeline=(spine:object[])=>{const t=emptyTimeline('t');return TimelineSchema.parse({...t,spine});};
const fps=30;
const layers=(spine:object[])=>{const p=prepare({timeline:timeline(spine),footage:footage()});return(frame:number)=>frameAt(p,frame/fps).layers.filter((l):l is MediaLayer=>l.kind==='media');};

it('gets every clip that starts within the window ready, however short, each from its first frame',()=>{
 // A two-second shot, then a montage of five 0.2 s cuts: 2.0, 2.2, 2.4, 2.6 and 2.8 s into the edit.
 const at=layers([clip('open','a',0,2),clip('m1','b',4,4.2),clip('m2','c',9,9.2),clip('m3','b',12,12.2),clip('m4','a',20,20.2),clip('m5','c',1,1.2)]);
 const now=1.9,arrivals=upcoming(at,Math.round(now*fps),Math.round((now+LOOKAHEAD_SEC)*fps));
 expect(arrivals.map(a=>a.layer.key)).toEqual(['m1','m2','m3','m4','m5']);
 expect(arrivals.map(a=>a.frame)).toEqual([60,66,72,78,84]);
 expect(arrivals.map(a=>a.layer.time)).toEqual([4,9,12,20,1]);
 // A single look half a second ahead (what the player did before) sees one of the five.
 expect(at(Math.round((now+.5)*fps)).map(l=>l.key)).toEqual(['m3']);
 // What shows on the frame before each cut and on the cut itself.
 expect([...arrivals[0].before]).toEqual(['open']);expect([...arrivals[0].during]).toEqual(['m1']);expect([...arrivals[1].before]).toEqual(['m1']);
 // Nothing already showing arrives, and an empty window has nothing.
 expect(upcoming(at,60,60)).toEqual([]);expect(upcoming(at,61,65)).toEqual([]);
});

it('lets the playing video carry on into a cut only when the next clip picks up the same source where it will be',()=>{
 const at=layers([clip('one','a',3,4),clip('two','a',4.03,5),clip('jump','a',8,9),clip('other','b',9,10),clip('back','b',11.5,12)]);
 const playing=(frame:number)=>at(frame)[0],arrival=(from:number)=>upcoming(at,from,from+30)[0];
 // Half a second before the cut, 'one' shows source 3.5 and will reach 4.0 at the cut; 'two' starts at 4.03, a frame on.
 expect(continues(playing(15),arrival(15),.5,fps)).toBe(true);
 // A jump cut in the same source, a cut to another source and a jump within that one each need their own parked video.
 expect(continues(playing(45),arrival(45),1.5,fps)).toBe(false);
 expect(continues(playing(75),arrival(75),2.5,fps)).toBe(false);
 expect(continues(playing(105),arrival(105),3.5,fps)).toBe(false);
 // A held still is not playing and carries nothing on.
 expect(continues({...playing(15),rate:0},arrival(15),.5,fps)).toBe(false);
 // The playing clip must leave on the cut: a clip that starts while it still shows needs its own video.
 const overlap=arrival(15);expect(continues(playing(15),{...overlap,during:new Set([...overlap.during,'one'])},.5,fps)).toBe(false);
});

it('reuses a video element of the same source that nothing needs, nearest first, and never one in use',()=>{
 const v=(key:string,assetId:string,currentTime:number)=>({key,assetId,el:{currentTime}});
 const playing=v('one','a',4),parked=v('jump','a',8),idle=v('old','a',20),other=v('x','b',4.1),videos=[playing,parked,idle,other];
 const layer=(key:string,assetId:string,time:number)=>({key,assetId,time});
 // A clip's own element first.
 expect(pickVideo(videos,layer('jump','a',8),new Set(),new Set(['one','jump']))).toBe(parked);
 // At a continuing cut 'one' has left: its element, playing right where 'two' starts, takes over.
 expect(pickVideo(videos,layer('two','a',4.03),new Set(),new Set(['two','jump']))).toBe(playing);
 // While 'one' still shows its element is needed, so the idle one of the same source is taken and only seeked.
 expect(pickVideo(videos,layer('two','a',4.03),new Set(),new Set(['one','two','jump']))).toBe(idle);
 // Elements already taken this moment are not taken twice; another source's element never.
 expect(pickVideo(videos,layer('two','a',4.03),new Set([idle]),new Set(['one','two','jump']))).toBeUndefined();
 expect(pickVideo([other],layer('two','a',4.1),new Set(),new Set())).toBeUndefined();
});

it('measures the longest stretch between keyframes, to tell footage that seeks slowly',()=>{
 // A phone video with a keyframe every 4.2 s, and a preview copy with one every half second.
 expect(keyframeGap([0,4.2,8.4,12.6],14)).toBeCloseTo(4.2);
 expect(keyframeGap(Array.from({length:120},(_,n)=>n*.5),60)).toBeCloseTo(.5);
 // One keyframe at the start of a six-second clip; none read at all; and order does not matter.
 expect(keyframeGap([0],6)).toBe(6);expect(keyframeGap([],10)).toBe(10);expect(keyframeGap([3,0,1.5],4)).toBe(1.5);
});
