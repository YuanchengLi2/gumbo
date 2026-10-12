import {test,expect} from '@playwright/test';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {liveSession,footageClips,videoLength,outOfRange,sceneUses,noOpus,oneModel} from './live-session';

/** A creator editing long-form: the raw recording of a 40-minute talk (a Creative Commons FOSDEM 2024 talk, "Where did all
 * the fun go, and how to bring it back with FOSS", downloaded to artifacts/footage-cache/fun-with-foss-talk.mp4) cut into a
 * 12-15 minute upload, then refined with the requests a creator makes. Checks read the project state and the transcript;
 * the export is watched by a person afterwards. Spends real money: runs only with DREAM_LIVE_LONGFORM=1. */
const talk=resolve(process.env.DREAM_LONGFORM_SOURCE??'artifacts/footage-cache/fun-with-foss-talk.mp4');
test('live long-form edit of a raw talk recording, as a creator would make it',async()=>{
 test.skip(process.env.DREAM_LIVE_LONGFORM!=='1'||!existsSync(talk),'Explicit, budgeted live-provider session with the raw talk downloaded.');test.setTimeout(4*3_600_000);
 await liveSession('live-longform',async({ask,importFiles,words,page,app,folder})=>{
  const imported=await importFiles([talk]),source=imported.footage.assets.find((a:any)=>a.filename===talk.split(/[\\/]/).pop())!;
  const fromTalk=(s:any)=>s.timeline.spine.filter((c:any)=>c.assetId===source.id);
  // Pauses left inside the cut: gaps of over 2.5 seconds between consecutive spoken words within a clip.
  const pauses=(s:any)=>{const spoken=words(source.id);let n=0;for(const c of fromTalk(s)){const inside=spoken.filter(w=>w.start>=c.srcIn&&w.end<=c.srcOut);for(let i=1;i<inside.length;i++)if((inside[i].start-inside[i-1].end)/(c.speed||1)>2.5)n++;}return n;};
  await ask('long-form cut','This is the raw recording of my talk. Edit it into a tight 12 to 15 minute video for YouTube: cut the intro chatter, pauses, filler and the weaker or repeated parts, keep the main argument in order, and open with a strong hook taken from the best moment.',
   (_b,a)=>{const length=videoLength(a);if(length<600||length>960)return`the video is ${(length/60).toFixed(1)} minutes long`;if(fromTalk(a).length<8)return`only ${fromTalk(a).length} cuts from the talk`;if(outOfRange(a).length)return`clips past their source: ${outOfRange(a).join(', ')}`;const left=pauses(a);return left>4?`${left} pauses of over 2.5 seconds remain inside the cuts`:undefined;},
   // A first cut of a long recording is a big edit: the router gives it to Sonnet, within one request's $3 limit.
   (b,a,n)=>({...noOpus(b,a,n),'one model makes the cut':oneModel(n),'opens with a hook from later in the talk':(fromTalk(a)[0]?.srcIn??0)>60,'under $3':!!n&&n.costUsd<3}));
  await ask('faster middle','The middle drags. Make it faster.',(b,a)=>{const before=videoLength(b),after=videoLength(a);if(fromTalk(a).some((c:any)=>(c.speed??1)>1.25))return'speech was sped up beyond 1.25x';return after>before*.97&&fromTalk(a).length<=fromTalk(b).length?'neither shorter nor more tightly cut':undefined;},noOpus);
  await ask('chapter titles','Add chapter titles at the start of each main section.',(b,a)=>sceneUses(a)-sceneUses(b)<3?`only ${sceneUses(a)-sceneUses(b)} chapter titles were added`:undefined,noOpus);
  await ask('motion graphic at a time','At 4:30, add a motion graphic that sums up the point being made there.',(b,a)=>{const before=new Set(b.timeline.attached.map((i:any)=>i.id)),added=a.timeline.attached.filter((i:any)=>!before.has(i.id));return added.length?undefined:'no motion graphic was added';},noOpus);
  await ask('punch-ins','Punch in on me whenever I make a key point.',(b,a)=>{const effects=(s:any)=>s.timeline.attached.filter((i:any)=>i.type==='effect'&&['punch_zoom','slow_push'].includes(i.component)).length,zoomed=(s:any)=>fromTalk(s).filter((c:any)=>(c.framing?.scale??1)>1.05).length;
   // The speaker sits in a small corner window, so a punch-in may also be an overlay that enlarges it (the talk footage or a scene over it).
   const before=new Set(b.timeline.attached.map((i:any)=>i.id)),scenes=new Set(a.footage.assets.filter((x:any)=>x.scene).map((x:any)=>x.id)),overlays=a.timeline.attached.filter((i:any)=>!before.has(i.id)&&i.source&&(i.source.assetId===source.id||scenes.has(i.source.assetId))).length;
   return effects(a)-effects(b)+zoomed(a)-zoomed(b)+overlays<3?'fewer than three punch-ins were added':undefined;},noOpus);
  await ask('captions','Add captions.',(_b,a)=>a.timeline.captions?undefined:'no captions',noOpus);
  await ask('music','Add subtle background music under the whole video.',(_b,a)=>{const music=a.timeline.music;return!music.length?'no music':music.some((m:any)=>m.gainDb>-12)?'the music is louder than -12 dB':undefined;},noOpus);
  await ask('cut the Q&A','Cut the audience questions at the end and finish on the conclusion.',(b,a)=>videoLength(a)>videoLength(b)+1?'the video got longer':undefined,noOpus);
  await ask('weak spots','Where does it still feel slow or confusing?',(b,a)=>{const reply=JSON.stringify(a.messages.at(-1));return a.versionId!==b.versionId?'answering changed the project':!/\d+:\d\d/.test(reply)?'the reply names no timestamps':undefined;},(_b:any,_a:any,n:any)=>({'under $0.15':!!n&&n.costUsd<.15}));
  // DREAM_LIVE_SKIP_EXPORT=1 compares editing only (Export spends no AI money but takes minutes).
  if(process.env.DREAM_LIVE_SKIP_EXPORT==='1')return;
  const exported=join(folder,'longform-export.mp4');await app.evaluate(({dialog}:any,path:string)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},exported);
  await page.evaluate(()=>window.dream.exportVideo('video'));expect.soft(existsSync(exported),'export').toBe(true);
 },{computer:false});
});
