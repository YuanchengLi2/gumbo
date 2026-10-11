import {test,expect} from '@playwright/test';
import {liveSession,footageClips,clipLength,videoLength,outOfRange,clipIds as ids,quick,noOpus} from './live-session';
import {sessionReport} from '../../scripts/session-report';

/** A long video and a long session: a two-minute recap of a week of footage, a dozen follow-ups by clip position on that
 * timeline, and cutting the longest source down to its best 45 seconds. Checks read the project state. The session also
 * checks that later requests cost about the same as early ones: the largest context of the last follow-up may be at
 * most 30 percent above the first. Spends real money: runs only with DREAM_LIVE_LONG=1, capped like the others. */
test('live long video: a two-minute recap, a dozen positional follow-ups and a long source cut down',async()=>{
 test.skip(process.env.DREAM_LIVE_LONG!=='1','Explicit, budgeted live-provider session.');test.setTimeout(3_600_000);
 await liveSession('live-long-video',async({ask,folder,record})=>{
  const at=(s:any,n:number)=>s.timeline.spine.at(n);
  const unchangedExcept=(b:any,a:any,changed:number[])=>{const x=ids(b),y=ids(a);return y.length===x.length&&y.every((id:string,i:number)=>id===x[i])?changed.every(i=>JSON.stringify(at(b,i))!==JSON.stringify(at(a,i)))?undefined:'the clip did not change':`the clip order changed from ${x.join(',')} to ${y.join(',')}`;};
  const first=await ask('two-minute recap','Find everything I shot in the last 7 days on this computer and make a 2-minute recap of it in the order I shot it, with at least twelve shots.',
   (_b,a)=>{const available=a.footage.assets.filter((x:any)=>x.kind==='video'&&!x.scene).reduce((n:number,x:any)=>n+x.durationSec,0);
    if(footageClips(a).length<10)return`only ${footageClips(a).length} footage clips`;if(outOfRange(a).length)return`clips past their source: ${outOfRange(a).join(', ')}`;
    // Two minutes only when the week holds at least two and a half minutes of footage.
    return available>=150&&Math.abs(videoLength(a)-120)>20?`the video is ${videoLength(a).toFixed(0)}s long with ${available.toFixed(0)}s of footage`:undefined;},
   (b,a,n)=>({...noOpus(b,a,n),'under $0.50':!!n&&n.costUsd<.5}));
  if(first.timeline.spine.length<10){console.log('Not enough clips for the positional follow-ups.');return;}
  await ask('speed up the fifth','Speed up the fifth clip to 1.5x.',(b,a)=>Math.abs((at(a,4).speed??1)-1.5)>.01?`speed is ${at(a,4).speed}`:unchangedExcept(b,a,[4]),quick);
  await ask('remove the eighth','Remove the eighth clip.',(b,a)=>{const x=ids(b),y=ids(a);return JSON.stringify(y)===JSON.stringify([...x.slice(0,7),...x.slice(8)])?undefined:`order went from ${x.join(',')} to ${y.join(',')}`;},quick);
  await ask('last to first','Move the last clip to the start.',(b,a)=>{const x=ids(b),y=ids(a);return JSON.stringify(y)===JSON.stringify([x.at(-1),...x.slice(0,-1)])?undefined:`order went from ${x.join(',')} to ${y.join(',')}`;},quick);
  await ask('crossfade before the tenth','Add a crossfade before the tenth clip.',(b,a)=>at(a,9)?.transitionIn?.type==='crossfade'?ids(a).join()===ids(b).join()?undefined:'the clip order changed':'no crossfade on the tenth clip',quick);
  await ask('black and white','Make the third clip black and white.',(b,a)=>(at(a,2).framing?.saturation??1)>.05?'the third clip still has color':unchangedExcept(b,a,[2]),quick);
  await ask('mute the second','Mute the second clip.',(b,a)=>at(a,1).audio?.mute?unchangedExcept(b,a,[1]):'the second clip is not muted',quick);
  await ask('first is 3 seconds','Make the first clip 3 seconds long.',(b,a)=>Math.abs(clipLength(at(a,0))-3)>.05?`the first clip is ${clipLength(at(a,0)).toFixed(2)}s`:unchangedExcept(b,a,[0]),quick);
  await ask('swap fourth and sixth','Swap the fourth and sixth clips.',(b,a)=>{const x=ids(b),y=ids(a);return y[3]===x[5]&&y[5]===x[3]&&y.every((id:string,i:number)=>i===3||i===5||id===x[i])?undefined:`order went from ${x.join(',')} to ${y.join(',')}`;},quick);
  await ask('last at half speed','Slow the last clip down to half speed.',(b,a)=>Math.abs((at(a,-1).speed??1)-.5)>.01?`speed is ${at(a,-1).speed}`:unchangedExcept(b,a,[a.timeline.spine.length-1]),quick);
  await ask('no transitions','Remove all transitions.',(_b,a)=>a.timeline.spine.some((c:any)=>c.transitionIn&&c.transitionIn.type!=='cut')?'transitions remain':undefined,quick);
  await ask('count and length','How many clips are there now, and how long is the video?',(b,a)=>{const reply=JSON.stringify(a.messages.at(-1));return a.versionId!==b.versionId?'answering changed the project':!new RegExp(`\\b${a.timeline.spine.length}\\b`).test(reply)?`the reply does not say ${a.timeline.spine.length} clips`:undefined;},(_b:any,_a:any,n:any)=>({'under $0.02':!!n&&n.costUsd<.02}));
  // Later requests should cost about what early ones did: compare the largest context sent in the first and last follow-up.
  const rows=sessionReport(folder),follow=rows.slice(1,-1),growth=follow.length>1?follow.at(-1)!.maxContextTokens/Math.max(1,follow[0].maxContextTokens):1;
  record({name:'context growth',request:'(session)',status:'complete',targets:{'last follow-up within 30% of the first':growth<=1.3},seconds:0,growth,first:follow[0]?.maxContextTokens,last:follow.at(-1)?.maxContextTokens});
  console.log(`context of the follow-ups: ${follow.map(r=>Math.round(r.maxContextTokens/1000)+'K').join(', ')}`);expect.soft(growth,'context growth across follow-ups').toBeLessThanOrEqual(1.3);
  await ask('longest source, best 45 seconds','Now replace everything with the best 45 seconds of the longest video I have on this computer.',
   (_b,a)=>{const clips=footageClips(a),sources=new Set(clips.map((c:any)=>c.assetId)),longest=a.footage.assets.filter((x:any)=>x.kind==='video'&&!x.scene).sort((x:any,y:any)=>y.durationSec-x.durationSec)[0];
    if(!clips.length)return'no footage on the timeline';if(sources.size!==1)return`clips come from ${sources.size} sources`;if(longest&&!sources.has(longest.id))return`the source is not the longest video (${longest.filename}, ${longest.durationSec.toFixed(0)}s)`;
    return Math.abs(videoLength(a)-45)>10?`the video is ${videoLength(a).toFixed(0)}s long`:outOfRange(a).length?`clips past their source: ${outOfRange(a).join(', ')}`:undefined;},noOpus);
 });
});
