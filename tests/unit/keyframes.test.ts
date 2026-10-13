import {it,expect} from 'vitest';
import {emptyTimeline,apply,resolve,keyframeValues,clipClock,clipTimeAt,ClipSchema,type TimelineDocument} from '@dream/timeline';
import {clipStyleAt,keyedParams,whiteBalances,whiteBalanceId} from '../../packages/composition/src/visual-style';

const footage={assets:[{id:'a',filename:'a.mp4',kind:'video',durationSec:30,fps:30,width:1080,height:1920,hasAudio:false}],words:[],shots:[],faces:[],revision:0} as any;

it('animates each property between the keyframes that set it, eases into a keyframe and holds outside them',()=>{
 const keys=[{sec:2,easing:'linear' as const,scale:1,y:.5},{sec:4,easing:'ease_in_out' as const,scale:1.4},{sec:6,easing:'linear' as const,y:.3},{sec:8,easing:'hold' as const,scale:2}];
 expect(keyframeValues(keys,0)).toEqual({scale:1,y:.5});
 expect(keyframeValues(keys,3).scale).toBeCloseTo(1.2);expect(keyframeValues(keys,2.5).scale).toBeCloseTo(1+.4*.125);
 // y moves straight from its first keyframe to its next one, ignoring keyframes that only set scale.
 expect(keyframeValues(keys,4).y).toBeCloseTo(.5-.2*.5);
 expect(keyframeValues(keys,7.9).scale).toBeCloseTo(1.4);expect(keyframeValues(keys,8).scale).toBe(2);expect(keyframeValues(keys,20)).toEqual({scale:2,y:.3});
 expect(keyframeValues(undefined,3)).toEqual({});
});

it('keeps keyframes on the same footage when a clip is trimmed or sped up, and draws them in the player',()=>{
 const t:TimelineDocument={...emptyTimeline('p'),settings:{...emptyTimeline('p').settings,width:1080,height:1920}};
 t.spine=[ClipSchema.parse({id:'c',assetId:'a',srcIn:10,srcOut:20,keyframes:[{sec:10,scale:1,y:.5},{sec:20,scale:2,y:.25,rotation:90}]})];
 let clip=resolve(t,footage).clips[0];expect(clipClock(clip,5)).toBe(15);expect(clipTimeAt(clip,15)).toBe(5);
 // Rotation is set by one keyframe only, so it holds there.
 const style=clipStyleAt(clip,t,[],5);expect(style.transform).toContain('translate(0%,-12.5%)');expect(style.transform).toContain('rotate(90deg)');expect(style.transform).toContain('scale(1.5)');
 // Trimming 4 s off the head and doubling the speed leaves source second 15 at timeline 0.5.
 const trimmed=apply(t,[{type:'trim_clip',clipId:'c',srcIn:14,srcOut:20,reason:'r'} as any],footage);trimmed.spine[0].speed=2;
 clip=resolve(trimmed,footage).clips[0];expect(clipTimeAt(clip,15)).toBe(.5);expect(clipStyleAt(clip,trimmed,[],.5).transform).toContain('scale(1.5)');
});

it('sets and clears keyframes on a clip or layer, animates a layer\'s own params and defines keyframed white balance',()=>{
 const t:TimelineDocument={...emptyTimeline('p'),spine:[ClipSchema.parse({id:'c',assetId:'a',srcIn:0,srcOut:10})]};
 const keyed=apply(t,[{type:'set_keyframes',id:'c',keyframes:[{sec:0,easing:'linear',temperature:-.02},{sec:5,easing:'linear',temperature:.03}],reason:'Warm up'}],footage);
 expect(keyed.spine[0].keyframes).toHaveLength(2);expect(whiteBalances(keyed)).toEqual(expect.arrayContaining([-.02,-.01,.01,.02,.03]));
 expect(String(clipStyleAt(resolve(keyed,footage).clips[0],keyed,[],5).filter)).toContain(`url(#${whiteBalanceId(.03)})`);
 expect(apply(keyed,[{type:'set_keyframes',id:'c',keyframes:[],reason:'Clear'}],footage).spine[0].keyframes).toBeUndefined();
 expect(()=>apply(t,[{type:'set_keyframes',id:'missing',keyframes:[],reason:'r'}],footage)).toThrow();
 const layer={id:'l',type:'overlay',component:'source',params:{x:.2,scale:.5},layer:0,timelineStart:3,timelineEnd:9,source:{assetId:'a',srcIn:1,srcOut:7},keyframes:[{sec:1,easing:'linear',x:.2},{sec:3,easing:'linear',x:.8}]} as any;
 expect(keyedParams(layer,1)).toMatchObject({x:expect.closeTo(.5),scale:.5});expect(keyedParams({...layer,keyframes:undefined},1)).toEqual(layer.params);
});

it('refuses commands that render scenes or the edit, including through a script they run, and lets media processing run',async()=>{
 const {mkdtempSync,writeFileSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {rendersTheEdit}=await import('../../apps/project-service/src/render-guard');
 const root=mkdtempSync(join(tmpdir(),'dream-render-'));writeFileSync(join(root,'make.mjs'),"import {renderMedia} from '@remotion/renderer';await renderMedia({});");writeFileSync(join(root,'clean.py'),'import subprocess');
 expect(rendersTheEdit('npx remotion render src/index.ts Dream out.mp4',root)).toBe(true);expect(rendersTheEdit('npx remotion still intro',root)).toBe(true);
 expect(rendersTheEdit('node make.mjs',root)).toBe(true);expect(rendersTheEdit('python clean.py && ffmpeg -i in.wav -af afftdn output/clean.wav',root)).toBe(false);
 expect(rendersTheEdit('node ../outside.mjs',root)).toBe(false);
});
