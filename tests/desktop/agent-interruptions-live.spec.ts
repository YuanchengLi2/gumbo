import {test,expect} from '@playwright/test';
import {liveSession,footageClips,videoLength,sceneUses,quick,noOpus} from './live-session';

/** Interruptions and modes: stopping a request part way and continuing it without duplicating work, undoing by
 * accident and asking for it back, ask-only mode changing nothing, plan-first mode waiting for approval and then
 * running, stopping and redirecting, and a vague request. Spends real money (the approved plan runs with Opus):
 * runs only with DREAM_LIVE_INTERRUPTIONS=1, capped like the others. */
test('live interruptions and modes: stop and continue, undo, ask only, plan first, redirect',async()=>{
 test.skip(process.env.DREAM_LIVE_INTERRUPTIONS!=='1','Explicit, budgeted live-provider session.');test.setTimeout(3_600_000);
 await liveSession('live-interruptions',async({ask,page,state,send,settled,record})=>{
  const command=(c:any)=>page.evaluate(c=>window.dream.command(c),c);
  // Starts a request, stops it after some seconds, and records where it stopped.
  const stopAfter=async(name:string,text:string,seconds:number)=>{const before=await state();await send(text);await page.waitForTimeout(seconds*1000);const running=(await state()).aiStatus==='running';if(running)await command({type:'cancel'});const after=await settled(before);
   record({name,request:text,status:after.aiStatus,targets:{},seconds,problem:running&&after.aiStatus!=='interrupted'?`status ${after.aiStatus} after stopping`:undefined,stoppedInTime:running});console.log(`${running?'stopped':'finished before the stop:'} ${name}`);return after;};
  await ask('first cut','Make a 15-second edit from my most recent videos.',(_b,a)=>footageClips(a).length<2?`only ${footageClips(a).length} footage clips`:Math.abs(videoLength(a)-15)>5?`the video is ${videoLength(a).toFixed(1)}s long`:undefined,noOpus);
  const start=await state(),scenesBefore=sceneUses(start);
  const stopped=await stopAfter('stop part way',"Add a title card at the start that says 'Weekend' and a lower third on the second clip that says 'Sam'.",12);
  if(stopped.aiStatus==='interrupted')await ask('continue','continue',(_b,a)=>{const added=sceneUses(a)-scenesBefore;return added<2?`only ${added} of the title and lower third are on the timeline`:added>2?`${added} scenes were added, so work was repeated`:undefined;},noOpus);
  const full=await state(),scenesFull=sceneUses(full);await command({type:'undo'});const undone=await state();
  record({name:'undo by accident',request:'(undo)',status:'complete',targets:{},seconds:0,problem:undone.versionId===full.versionId?'undo did not change the version':undefined});
  await ask('put it back','I undid your last change by accident. Put it back.',(_b,a)=>sceneUses(a)<scenesFull?`${sceneUses(a)} scenes on the timeline, ${scenesFull} before the undo`:undefined,noOpus);
  await ask('ask only','Make it black and white.',(b,a)=>a.versionId!==b.versionId?'ask-only mode changed the project':!a.messages.at(-1)?.text?'no reply':undefined,(_b:any,_a:any,n:any)=>({'under $0.10':!!n&&n.costUsd<.1}),{intent:'ask'});
  await ask('plan first','Turn this into a vertical 9:16 video with captions.',(b,a)=>a.versionId!==b.versionId?'planning changed the project':!a.taskPlan?'no plan to approve':undefined,undefined,{intent:'plan',expect:'awaiting_approval'});
  await ask('approve the plan','do it',(_b,a)=>a.timeline.settings.height<=a.timeline.settings.width?`the video is ${a.timeline.settings.width}x${a.timeline.settings.height}`:undefined);
  const beforeRedirect=await state();
  await stopAfter('stop to redirect','Add upbeat music and a sound effect on every cut.',10);
  await ask('redirect','Actually, just mute all the clips instead.',(_b,a)=>{const loud=a.timeline.spine.filter((c:any)=>!c.audio?.mute);return loud.length?`${loud.length} clips are not muted`:a.timeline.music.length>beforeRedirect.timeline.music.length?'music from the stopped request was kept':undefined;},quick);
  await ask('vague','Make it better.',(b,a)=>a.versionId===b.versionId&&!/already|nothing|no change/i.test(JSON.stringify(a.messages.at(-1)))?'nothing changed and the reply does not say why':undefined,(b,a,n)=>({...noOpus(b,a,n),'under $0.10':!!n&&n.costUsd<.1}));
  expect.soft((await state()).aiStatus,'session ends ready').toBe('complete');
 });
});
