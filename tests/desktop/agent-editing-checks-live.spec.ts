import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {liveSession,footageClips,clipLength,videoLength,outOfRange,clipIds as ids,quick,noOpus} from './live-session';

/** A second live session, aimed at what the October 10 changes are meant to improve: exact edits by position and length,
 * a mood the user states once and never repeats, a request the footage cannot satisfy, replacing a clip by what was
 * already seen, and cheap follow-ups. Every check reads the project state; nothing is judged by a model. Spends real
 * money: runs only with DREAM_LIVE_EDITING=1, on a temporary account capped at DREAM_LIVE_BUDGET_USD (default 3). */
test('live editing checks: exact follow-ups, remembered mood, honest limits and cheap simple edits',async()=>{
 test.skip(process.env.DREAM_LIVE_EDITING!=='1','Explicit, budgeted live-provider session.');test.setTimeout(3_600_000);
 await liveSession('live-editing-checks',async({ask,meta,app,page,folder})=>{
  await ask('first cut','Find the videos I shot most recently on this computer and make a 20-second edit of their best moments, with at least four shots, in the order I shot them.',
   (_b,a)=>footageClips(a).length<4?`only ${footageClips(a).length} footage clips`:Math.abs(videoLength(a)-20)>6?`the video is ${videoLength(a).toFixed(1)}s long`:outOfRange(a).length?`clips past their source: ${outOfRange(a).join(', ')}`:undefined,
   (b,a,n)=>({...noOpus(b,a,n),'notes on what was seen':Object.keys(JSON.parse(meta('source-notes')??'{}')).length>0}));
  await ask('set the mood','I want this whole video to feel calm and dreamy: slow pacing and soft, warm colors. Keep that in mind for everything after this.',
   (b,a)=>a.versionId===b.versionId?'nothing changed':a.timeline.spine.some((c:any)=>c.framing&&((c.framing.temperature??0)>0||(c.framing.saturation??1)<1||(c.framing.contrast??1)<1))||a.timeline.attached.length>b.timeline.attached.length?undefined:'no soft or warm grade on any clip',
   (b,a,n)=>({...noOpus(b,a,n),'mood saved in the project notes':/calm|dream|warm|soft/i.test(meta('preferences')??'')}));
  await ask('swap by position','Swap the second and third clips.',
   (b,a)=>{const x=ids(b),y=ids(a);return y.length===x.length&&y[1]===x[2]&&y[2]===x[1]&&y.every((id:string,i:number)=>i===1||i===2||id===x[i])?undefined:`order went from ${x.join(',')} to ${y.join(',')}`;},quick);
  await ask('exact length','Make the first clip exactly 2 seconds long.',
   (b,a)=>{const length=clipLength(a.timeline.spine[0]);return Math.abs(length-2)>.05?`the first clip is ${length.toFixed(2)}s`:ids(a).join()!==ids(b).join()?'the clip order changed':undefined;},quick);
  await ask('impossible extension','Extend the last clip by 30 seconds.',
   (b,a)=>{const before=videoLength(b),after=videoLength(a),reply=JSON.stringify(a.messages.at(-1));
    if(outOfRange(a).length)return`clips past their source: ${outOfRange(a).join(', ')}`;
    // The extension may be split across clips, so the whole video's growth counts. Most clips are too short; then the reply must say so.
    return after-before<28&&!/only|as far as|end of|longer than|not long enough|no more|ran out|limit|can't|cannot|couldn't/i.test(reply)?`the video grew by ${(after-before).toFixed(1)}s without saying why not 30`:undefined;},quick);
  await ask('remembered mood','Add music that fits.',(_b,a)=>a.timeline.music.length?undefined:'no music on the timeline',noOpus);
  await ask('title','Add a title at the very start that says "Slow Days".',
   (b,a)=>a.footage.assets.filter((x:any)=>x.scene).length>b.footage.assets.filter((x:any)=>x.scene).length?undefined:'no new scene was published',noOpus);
  await ask('replace by what was seen','Replace the shakiest clip with a steadier shot from the same videos.',
   (b,a)=>{const key=(c:any)=>`${c.assetId}:${c.srcIn}:${c.srcOut}`,x=footageClips(b).map(key),y=footageClips(a).map(key);return y.some((k:string)=>!x.includes(k))?outOfRange(a).length?`clips past their source: ${outOfRange(a).join(', ')}`:undefined:'no footage clip changed';},
   (b,a,n)=>({...noOpus(b,a,n),'at most eight looks at footage':!!n&&n.looks<=8}));
  await ask('remove music','Remove the music.',(_b,a)=>a.timeline.music.length?`${a.timeline.music.length} music tracks left`:undefined,quick);
  await ask('question','What mood are we going for, and how long is the video now?',
   (b,a)=>{const reply=JSON.stringify(a.messages.at(-1));return a.versionId!==b.versionId?'answering changed the project':!/calm|dream|soft|warm/i.test(reply)?'the reply does not recall the mood':!/\d+(\.\d+)?\s*(s\b|sec|second)/i.test(reply)?'the reply gives no length':undefined;},
   (_b:any,_a:any,n:any)=>({'under $0.10':!!n&&n.costUsd<.1}));
  const exported=join(folder,'session-export.mp4');await app.evaluate(({dialog}:any,path:string)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},exported);
  await page.evaluate(()=>window.dream.exportVideo('video'));expect.soft(existsSync(exported),'export').toBe(true);
 });
});
