import {it,expect} from 'vitest';
import {emptyTimeline,TimelineSchema,type TimelineDocument} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {prepare,frameAt,fitInBox,apply,type MediaLayer,type TextLayer,type FillLayer} from '@dream/compositor';

const footage=()=>{const f=emptyFootage();f.assets=[
 AssetSchema.parse({id:'wide',filename:'wide.mp4',kind:'video',originalPath:'wide.mp4',durationSec:20,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'w',status:'ready'}),
 AssetSchema.parse({id:'tall',filename:'tall.mp4',kind:'video',originalPath:'tall.mp4',durationSec:20,width:1080,height:1920,fps:30,hasAudio:true,fingerprint:'t',status:'ready'}),
 AssetSchema.parse({id:'logo',filename:'logo.png',kind:'image',originalPath:'logo.png',durationSec:5,width:400,height:400,fps:30,hasAudio:false,fingerprint:'l',status:'ready'})];
 f.words=[{id:'w1',assetId:'tall',text:'Hello',start:1,end:1.5},{id:'w2',assetId:'tall',text:'there',start:1.5,end:2},{id:'w3',assetId:'tall',text:'friend',start:2,end:2.5}] as any;return f;};
const clip=(id:string,assetId:string,srcIn:number,srcOut:number,extra:object={})=>({id,assetId,srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',...extra});
const vertical=(spine:object[],extra:Partial<TimelineDocument>={})=>{const t=emptyTimeline('t');return TimelineSchema.parse({...t,settings:{...t.settings,width:1080,height:1920},spine,...extra});};
const media=(layers:any[])=>layers.filter((l):l is MediaLayer=>l.kind==='media');
const centre=(m:MediaLayer)=>apply(m.transform,540,960);

it('places a source in its box as object-fit does: contained with bars, or covering and cropped where object-position says',()=>{
 expect(fitInBox(1920,1080,{x:0,y:0,w:1080,h:1920},'contain')).toEqual({rect:{x:0,y:656.25,w:1080,h:607.5},uv:{x:0,y:0,w:1,h:1}});
 const cover=fitInBox(1920,1080,{x:0,y:0,w:1080,h:1920},'cover',0);expect(cover.rect).toEqual({x:0,y:0,w:1080,h:1920});expect(cover.uv.x).toBe(0);expect(cover.uv.w).toBeCloseTo(1080/(1920*1920/1080));
});

it('draws a clip at its source time with its framing, keyframes, effects and grade',()=>{
 const t=vertical([clip('a','tall',2,8,{framing:{mode:'fill',scale:1,x:.5,y:.5,exposure:.5},keyframes:[{sec:2,scale:1.2,y:.5},{sec:6,scale:1.6,y:.7}]})],{attached:[{id:'g',type:'effect',component:'grade',start:{kind:'clip',clipId:'a',at:'start',offsetSec:0},durationSec:6,params:{saturation:1.4},layer:0,reason:''}] as any});
 const p=prepare({timeline:t,footage:footage()}),frame=frameAt(p,2),[m]=media(frame.layers);
 expect(frame.layers[0]).toMatchObject({kind:'fill',color:'#0b0c0e'});
 // Source second 4 is halfway between the keyframes: scale 1.4, centre moved down 0.1 of the frame.
 expect(m).toMatchObject({assetId:'tall',time:4,opacity:1,grades:[{exposure:.5,contrast:1,saturation:1,temperature:0},{exposure:0,contrast:1,saturation:1.4,temperature:0}]});
 expect(m.transform[0]).toBeCloseTo(1.4);const [x,y]=centre(m);expect(x).toBeCloseTo(540);expect(y).toBeCloseTo(960+.1*1920);
});

it('crossfades over black between two video clips and fades a dip in from the composition background',()=>{
 const t=vertical([clip('a','tall',0,4),clip('b','wide',0,4,{transitionIn:{type:'crossfade',durationSec:1}}),clip('c','tall',5,8,{transitionIn:{type:'dip_to_black',durationSec:1}})]);
 const p=prepare({timeline:t,footage:footage()});
 // The window runs from 3.5 s to 4.5 s; at 4 s the incoming clip is about half in, on black.
 const mid=frameAt(p,4);expect(mid.layers[0]).toMatchObject({kind:'fill',color:'#000000'});
 const [out,into]=media(mid.layers);expect(out).toMatchObject({assetId:'tall',opacity:1});expect(into.assetId).toBe('wide');expect(into.opacity).toBeGreaterThan(.45);expect(into.opacity).toBeLessThan(.55);
 // The incoming clip starts at its in point (it cannot start before 0) and the outgoing one runs past its out point.
 expect(into.time).toBeCloseTo(.5);expect(out.time).toBeCloseTo(4);
 const dip=frameAt(p,8+1/30*3);expect(media(dip.layers)[0].opacity).toBeCloseTo(3/15);expect((dip.layers[0] as FillLayer).opacity).toBeCloseTo(3/15);
 expect(frameAt(p,8.6).layers.every(l=>(l as any).opacity===1)).toBe(true);
});

it('draws overlays by layer, elements fading in, and captions as word pop or a highlighted line, hiding hidden tracks',()=>{
 const items=[{id:'logo',type:'overlay',component:'source',source:{assetId:'logo',srcIn:0,srcOut:5},start:{kind:'project',at:'start',offsetSec:0},durationSec:5,layer:2,params:{x:.8,y:.2,scale:.3},reason:''},
  {id:'title',type:'overlay',component:'lower_third',start:{kind:'project',at:'start',offsetSec:1},durationSec:3,layer:1,params:{text:'Jane'},reason:''}];
 const t=vertical([clip('a','tall',0,6)],{attached:items as any,captions:{style:'karaoke',params:{},overrides:[{wordId:'w3',clipId:'a',emphasis:true}]}});
 const p=prepare({timeline:t,footage:footage()}),frame=frameAt(p,1+4/30);
 const kinds=frame.layers.map(l=>l.kind==='text'?(l as TextLayer).component:l.kind==='media'?(l as MediaLayer).assetId:l.kind);
 expect(kinds).toEqual(['fill','tall','lower_third','logo','caption']);
 const title=frame.layers.find(l=>l.kind==='text'&&l.component==='lower_third') as TextLayer;expect(title).toMatchObject({text:'Jane',x:.5,y:.8});expect(title.opacity).toBeCloseTo(.5);
 const logo=media(frame.layers).find(m=>m.assetId==='logo')!;const [lx,ly]=centre(logo);expect(lx).toBeCloseTo(.8*1080);expect(ly).toBeCloseTo(.2*1920);
 const caption=frame.layers.at(-1) as TextLayer;expect(caption.words).toEqual([{text:'Hello',highlight:true},{text:'there',highlight:false},{text:'friend',highlight:true}]);
 const pop=frameAt(prepare({timeline:{...t,captions:{style:'word_pop',params:{},overrides:[]}},footage:footage()}),1.6);expect((pop.layers.at(-1) as TextLayer).text).toBe('there');
 const hidden=frameAt(prepare({timeline:{...t,trackSettings:{'visual:2':{hidden:true},captions:{hidden:true},video:{hidden:true}}},footage:footage()}),1.2);
 expect(hidden.layers.map(l=>l.kind==='text'?(l as TextLayer).component:l.kind)).toEqual(['lower_third']);
});

it('always fills the project frame on the main track: no letterbox, no zoom out, no move past the edge',()=>{
 // A wide clip in a vertical project, framed "fit", zoomed out to half and pushed far right: it still covers the frame.
 const p=prepare({timeline:vertical([clip('c','wide',0,4,{framing:{mode:'fit',scale:.5,x:.5,y:.5},keyframes:[{sec:0,x:.95}]})]),footage:footage()});
 const media=frameAt(p,1).layers.find(l=>l.kind==='media') as MediaLayer;
 // Covering: the picture's rectangle is the whole frame, cropped from the wide source.
 expect(media.rect).toEqual({x:0,y:0,w:1080,h:1920});expect(media.uv.w).toBeLessThan(1);
 // No zoom below 1 and no shift: at scale 1 there is no room to move.
 expect(media.transform).toEqual([1,0,0,1,0,0]);
});
