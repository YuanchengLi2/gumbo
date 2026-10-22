import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {emptyTimeline,TimelineSchema,TRANSITIONS,TRANSITION_TYPES,type TimelineDocument} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {prepare,frameAt,apply,type MediaLayer} from '@dream/compositor';

/** The style library added for CapCut parity: transitions, caption and text styles, looks and effects, as the frame model
 * draws them (the same description the preview and Export both draw), and Roux's reference listing every one. */
const footage=()=>{const f=emptyFootage();f.assets=[
 AssetSchema.parse({id:'wide',filename:'wide.mp4',kind:'video',originalPath:'wide.mp4',durationSec:20,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'w',status:'ready'}),
 AssetSchema.parse({id:'other',filename:'other.mp4',kind:'video',originalPath:'other.mp4',durationSec:20,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'o',status:'ready'})];return f;};
const clip=(id:string,assetId:string,srcIn:number,srcOut:number,extra:object={})=>({id,assetId,srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',...extra});
const edit=(spine:object[],extra:Partial<TimelineDocument>={})=>{const t=emptyTimeline('t');return TimelineSchema.parse({...t,spine,...extra});};
const media=(layers:any[])=>layers.filter((l):l is MediaLayer=>l.kind==='media');
const W=1920,H=1080;
/** Two clips of 4 s with a 1 s transition into the second: the window is 3.5-4.5 s (frames 105-134). */
const cut=(transition:object)=>prepare({timeline:edit([clip('a','wide',2,6),clip('b','other',2,6,{transitionIn:{durationSec:1,...transition}})]),footage:footage()});
const at=(p:ReturnType<typeof cut>,time:number)=>media(frameAt(p,time).layers);

it('draws every library transition inside its window and only the shots on either side of it',()=>{
 for(const t of TRANSITIONS){const p=cut({type:t.id});
  expect(at(p,3).map(m=>m.key),t.id).toEqual(['a']);expect(at(p,5).map(m=>m.key),t.id).toEqual(['b']);
  for(const time of [3.5,3.8,4,4.2,4.49]){const keys=at(p,time).map(m=>m.key);expect(keys.length,t.id+' at '+time).toBeGreaterThan(0);expect(keys.every(k=>k==='a'||k==='b')).toBe(true);}}
 expect(TRANSITION_TYPES.filter(type=>type!=='cut')).toEqual(TRANSITIONS.map(t=>t.id));
 expect(TRANSITIONS.length).toBeGreaterThanOrEqual(25);
});

it('whips with a streak along the pan, eased, and scales the strong transitions by intensity',()=>{
 const [a,b]=at(cut({type:'whip',direction:'up'}),4);expect(a.fx?.streakY).toBeLessThan(-100);expect(a.fx?.streakX).toBeCloseTo(0);expect(b.fx).toEqual(a.fx);
 expect(at(cut({type:'whip',intensity:0}),4)[0].fx?.streakX).toBeCloseTo(0);
 // Zoom in at full strength reaches 1.5x at the window's last frame; at half strength 1.25x.
 const zoom=(intensity?:number)=>at(cut({type:'zoom_through',...(intensity===undefined?{}:{intensity})}),4.46)[0].transform[0];
 expect(zoom()).toBeCloseTo(1.5,1);expect(zoom(.5)).toBeCloseTo(1.25,1);
 expect(()=>edit([clip('a','wide',2,6),clip('b','other',2,6,{transitionIn:{type:'flash',durationSec:1,intensity:1.5}})])).toThrow();
});

it('burns, leaks, blurs and pixelates hardest on the cut and not at the edges of the window',()=>{
 for(const [type,key] of [['film_burn','burn'],['light_leak','leak'],['pixelate','pixel']] as const){const p=cut({type});
  const peak=Math.max(...at(p,4).map(m=>Number(m.fx?.[key]??0))),edge=Number(at(p,3.5)[0].fx?.[key]??0);expect(peak,type).toBeGreaterThan(edge*3);}
 // Burn and leak move by a phase in seconds, so they flow from frame to frame rather than jump.
 expect(at(cut({type:'film_burn'}),4.1)[0].fx?.phase).toBeCloseTo(.6,1);
 const [out,into]=at(cut({type:'zoom_blur'}),4.3);expect(into.fx?.zoomBlur).toBeGreaterThan(0);expect(out.fx?.zoomBlur).toBeCloseTo(1);
});

it('cuts hard on the middle frame of a shake cut, knocked about but always covering the frame',()=>{
 const p=cut({type:'shake_cut'});expect(at(p,3.9).map(m=>m.key)).toEqual(['a']);expect(at(p,4.1).map(m=>m.key)).toEqual(['b']);
 for(const time of [3.7,3.9,4,4.1,4.3]){const [m]=at(p,time),corners=[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>apply(m.transform,x,y));
  // The picture's corners stay outside the frame: no black edge shows during the shake.
  expect(Math.min(...corners.map(c=>c[0]))).toBeLessThanOrEqual(.5);expect(Math.max(...corners.map(c=>c[0]))).toBeGreaterThanOrEqual(W-.5);
  expect(Math.min(...corners.map(c=>c[1]))).toBeLessThanOrEqual(.5);expect(Math.max(...corners.map(c=>c[1]))).toBeGreaterThanOrEqual(H-.5);}
});

it('wipes with clock, edge and stripe masks, splits from the middle and flips like a card',()=>{
 const k=15/29;
 expect(at(cut({type:'clock_wipe'}),4)[1].mask).toMatchObject({kind:'clock',cx:W/2,cy:H/2,sweep:expect.closeTo(k*Math.PI*2,5)});
 const soft=at(cut({type:'smooth_wipe'}),4)[1].mask as any;expect(soft).toMatchObject({kind:'edge',nx:1,ny:0});expect(soft.feather).toBeGreaterThan(100);
 const diagonal=at(cut({type:'diagonal',direction:'up'}),3.5)[1].mask as any;expect(diagonal.nx).toBeCloseTo(-Math.SQRT1_2);expect(diagonal.ny).toBeCloseTo(Math.SQRT1_2);
 // At the window's start the diagonal edge sits past every corner of the frame: nothing of the next shot shows yet.
 expect(Math.max(...[[0,0],[W,0],[0,H],[W,H]].map(([x,y])=>x*diagonal.nx+y*diagonal.ny))).toBeLessThanOrEqual(diagonal.d);
 expect(at(cut({type:'blinds',direction:'up'}),4)[1].mask).toMatchObject({kind:'stripes',period:H/8,vertical:false});
 const split=at(cut({type:'split'}),4)[1].mask as any;expect(split.rect.x+split.rect.w/2).toBeCloseTo(W/2);expect(split.rect.h).toBe(H);
 // A flip narrows this shot toward its middle, then the next one opens from it.
 const [before]=at(cut({type:'flip'}),3.9),[after]=at(cut({type:'flip'}),4.3);expect(before.key).toBe('a');expect(after.key).toBe('b');
 expect(Math.abs(before.transform[0])).toBeLessThan(.5);expect(apply(before.transform,W/2,H/2)[0]).toBeCloseTo(W/2);
 const [cover,over]=at(cut({type:'cover'}),4);expect(cover.transform[4]).toBeCloseTo(0);expect(over.transform[4]).toBeGreaterThan(0);
});

it('lists every library piece in Roux\'s engine reference, so a request can name any of them',()=>{
 const reference=readFileSync('packages/scene-engine/reference/api.md','utf8');
 for(const t of TRANSITION_TYPES)expect(reference,t).toContain('`'+t+'`');
});

it('masks coded scenes in the preview with the same edges, clock sweeps and stripes the compositor draws',async()=>{
 const {maskPath}=await import('../../apps/desktop/src/renderer/engine/scenes');
 const box={transform:[1,0,0,1,0,0] as [number,number,number,number,number,number],rect:{x:0,y:0,w:200,h:100}};
 const points=(path:string)=>path.slice(8,-1).split(',').map(p=>p.trim().split(' ').map(v=>parseFloat(v)));
 // The right side of x = 100: every corner of the kept polygon is at x >= 100.
 const edge=points(maskPath({...box,mask:{kind:'edge',nx:1,ny:0,d:100,feather:0}}));expect(edge.length).toBe(4);expect(Math.min(...edge.map(p=>p[0]))).toBeCloseTo(100);
 // Half a sweep: the fan runs from straight up round the right to straight down.
 const fan=points(maskPath({...box,mask:{kind:'clock',cx:100,cy:50,sweep:Math.PI}}));expect(fan[0]).toEqual([100,50]);expect(fan[1][1]).toBeLessThan(-1000);expect(fan.at(-1)![1]).toBeGreaterThan(1000);expect(Math.min(...fan.map(p=>p[0]))).toBeGreaterThan(99);
 expect(maskPath({...box,mask:{kind:'clock',cx:100,cy:50,sweep:7}})).toBe('');
 // Stripes 50 px apart open by half: four stripes over the 200 px box, 25 px wide.
 const stripes=points(maskPath({...box,mask:{kind:'stripes',period:50,open:.5,vertical:true}}));expect(stripes.length).toBe(16);expect(stripes.slice(0,4).map(p=>p[0])).toEqual([0,0,25,25]);
 // A scene's edge mask comes without a feather, as the clip-path can only draw a hard edge.
 const t=prepare({timeline:edit([clip('a','wide',2,6),clip('b','scene',0,4,{transitionIn:{type:'smooth_wipe',durationSec:1}})]),footage:{...footage(),assets:[...footage().assets,AssetSchema.parse({id:'scene',filename:'intro',kind:'video',originalPath:'intro',durationSec:4,width:1920,height:1080,fps:30,hasAudio:false,fingerprint:'s',status:'ready',scene:{format:'engine',revisionId:'a'.repeat(64),durationInFrames:120}})]}});
 expect((at(t,4)[1].mask as any).feather).toBe(0);
});
