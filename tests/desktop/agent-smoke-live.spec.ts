import {test} from '@playwright/test';
import {existsSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {liveSession,videoLength,outOfRange,oneModel} from './live-session';

/** The cheap live check to run before a long session: three minutes of the long-form talk cut into a short clip, then one
 * follow-up. A few cents and a few minutes, on the same packaged app and deployed gateway, so a broken model route, a
 * stalled transcript or a tool that fails shows up here first. Spends real money: runs only with DREAM_LIVE_SMOKE=1. */
const talk=resolve(process.env.DREAM_LONGFORM_SOURCE??'artifacts/footage-cache/fun-with-foss-talk.mp4'),excerpt=resolve('artifacts/footage-cache/talk-excerpt-3min.mp4');
test('live smoke session on three minutes of a talk',async()=>{
 test.skip(process.env.DREAM_LIVE_SMOKE!=='1'||!existsSync(talk),'Explicit, budgeted live-provider session with the raw talk downloaded.');test.setTimeout(1_800_000);
 // Minutes 5 to 8 of the talk: the speaker is well into the argument there.
 if(!existsSync(excerpt)){mkdirSync(dirname(excerpt),{recursive:true});const cut=spawnSync(resolve('apps/desktop/resources/staged/media-runtime/ffmpeg.exe'),['-y','-ss','300','-i',talk,'-t','180','-c','copy',excerpt],{encoding:'utf8'});if(cut.status)throw new Error('Could not cut the excerpt: '+cut.stderr.slice(-500));}
 await liveSession('live-smoke',async({ask,importFiles,words})=>{
  const imported=await importFiles([excerpt]),source=imported.footage.assets.find((a:any)=>a.filename===excerpt.split(/[\\/]/).pop())!;
  const fromTalk=(s:any)=>s.timeline.spine.filter((c:any)=>c.assetId===source.id);
  const pauses=(s:any)=>{const spoken=words(source.id);let n=0;for(const c of fromTalk(s)){const inside=spoken.filter(w=>w.start>=c.srcIn&&w.end<=c.srcOut);for(let i=1;i<inside.length;i++)if((inside[i].start-inside[i-1].end)/(c.speed||1)>2.5)n++;}return n;};
  await ask('short cut','Cut this into a tight 60 to 90 second clip: remove pauses and filler, keep the main point, and open with the strongest line.',
   (_b,a)=>{const length=videoLength(a);if(length<45||length>120)return`the clip is ${length.toFixed(0)} s long`;if(fromTalk(a).length<2)return'fewer than two cuts';if(outOfRange(a).length)return`clips past their source: ${outOfRange(a).join(', ')}`;return pauses(a)>1?`${pauses(a)} pauses of over 2.5 seconds remain`:undefined;},
   (_b,_a,n)=>({'one model only':oneModel(n),'under $0.50':!!n&&n.costUsd<.5,'under 5 minutes':!!n&&n.seconds<300}));
  await ask('captions','Add captions.',(_b,a)=>a.timeline.captions?undefined:'no captions',(_b,_a,n)=>({'one model only':oneModel(n),'under $0.10':!!n&&n.costUsd<.1,'under 90 s':!!n&&n.seconds<90}));
 },{computer:false});
});
