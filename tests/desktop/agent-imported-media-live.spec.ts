import {test,expect} from '@playwright/test';
import ffmpeg from 'ffmpeg-static';
import {spawnSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {liveSession,clipLength,clipIds as ids,quick,noOpus,assetNamed} from './live-session';

// Four clips that differ only in color, named so the color is not in the name, a photo and a song.
const clips=[{file:'clip-1.mp4',color:'green',hex:'0x2e7d32'},{file:'clip-2.mp4',color:'red',hex:'0xc62828'},{file:'clip-3.mp4',color:'blue',hex:'0x1f4fd8'},{file:'clip-4.mp4',color:'gray',hex:'0x777777'}];
function makeMedia(folder:string){
 mkdirSync(folder,{recursive:true});const run=(args:string[])=>{const r=spawnSync(ffmpeg!,['-y','-v','error',...args],{windowsHide:true});if(r.status)throw new Error(r.stderr.toString().slice(-1000));};
 for(const c of clips)run(['-f','lavfi','-i',`color=c=${c.hex}:s=1280x720:r=30:d=6`,'-f','lavfi','-i','anoisesrc=d=6:a=0.02','-vf','noise=alls=25:allf=t+u','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',join(folder,c.file)]);
 run(['-f','lavfi','-i','color=c=0xf9a825:s=1600x1200','-frames:v','1',join(folder,'photo.jpg')]);
 run(['-f','lavfi','-i','sine=frequency=220:duration=40','-f','lavfi','-i','sine=frequency=330:duration=40','-filter_complex','amix=inputs=2,volume=0.5','-c:a','pcm_s16le',join(folder,'my-song.wav')]);
 return[...clips.map(c=>join(folder,c.file)),join(folder,'photo.jpg'),join(folder,'my-song.wav')];
}

/** Media the user brought into the project through the app (no computer search): using it, picking a clip by what it
 * shows, a photo and a song by what they are, a clip attached to the message, a clip selected on the timeline, and
 * remembering what was left out. Spends real money: runs only with DREAM_LIVE_IMPORTED=1, capped like the others. */
test('live imported media: using what the user brought in, by look, by attachment and by selection',async()=>{
 test.skip(process.env.DREAM_LIVE_IMPORTED!=='1','Explicit, budgeted live-provider session.');test.setTimeout(3_600_000);
 const files=makeMedia(resolve('artifacts/live-imported-media-'+Date.now()));
 await liveSession('live-imported-media',async({ask,importFiles})=>{
  const imported=await importFiles(files),id=(file:string)=>assetNamed(imported,file)!,color=(name:string)=>id(clips.find(c=>c.color===name)!.file);
  const onlyImported=(a:any)=>{const extra=a.footage.assets.filter((x:any)=>!x.scene&&!x.generated&&!files.some(f=>f.endsWith(x.filename)));return extra.length?`media from elsewhere was added: ${extra.map((x:any)=>x.filename).join(', ')}`:undefined;};
  await ask('use all four','Make a short edit using all four video clips I imported.',
   (_b,a)=>{const used=new Set(a.timeline.spine.map((c:any)=>c.assetId)),missing=clips.filter(c=>!used.has(id(c.file)));return missing.length?`not used: ${missing.map(c=>c.file).join(', ')}`:onlyImported(a);},noOpus);
  await ask('blue first','Put the blue clip first.',(b,a)=>a.timeline.spine[0]?.assetId!==color('blue')?'the first clip is not the blue one':a.timeline.spine.length!==b.timeline.spine.length?'clips were added or removed':undefined,
   (b,a,n)=>({...noOpus(b,a,n),'under $0.15':!!n&&n.costUsd<.15}));
  await ask('photo at the end','Add the photo I imported at the end for 3 seconds.',(_b,a)=>{const last=a.timeline.spine.at(-1);return last?.assetId!==id('photo.jpg')?'the last clip is not the photo':Math.abs(clipLength(last)-3)>.1?`the photo lasts ${clipLength(last).toFixed(2)}s`:undefined;},quick);
  await ask('my song as music','Use my song as the music, quietly.',(_b,a)=>{const music=a.timeline.music[0];return music?.assetId!==id('my-song.wav')?'the music is not my-song.wav':music.gainDb>-10?`the music is at ${music.gainDb} dB`:onlyImported(a);},(b,a,n)=>({...noOpus(b,a,n),'under $0.15':!!n&&n.costUsd<.15}));
  const before=await ask('attached clip replaces red','Use this one instead of the red clip.',
   (b,a)=>{const red=b.timeline.spine.findIndex((c:any)=>c.assetId===color('red'));return a.timeline.spine.some((c:any)=>c.assetId===color('red'))?'the red clip is still there':red>=0&&a.timeline.spine[red]?.assetId!==color('green')?'the green clip did not take the red clip\'s place':undefined;},
   quick,{assetIds:[color('green')]});
  const selected=before.timeline.spine[1].id;
  await ask('selected clip slower','Make this one slower.',(b,a)=>{const clip=a.timeline.spine.find((c:any)=>c.id===selected);if(!clip)return'the selected clip is gone';if((clip.speed??1)>=1)return`its speed is ${clip.speed}`;const others=(s:any)=>s.timeline.spine.filter((c:any)=>c.id!==selected).map((c:any)=>`${c.id}:${c.speed}`).join();return others(a)!==others(b)?'other clips changed speed':ids(a).join()!==ids(b).join()?'the clip order changed':undefined;},quick,{selection:[selected]});
  await ask('remove gray','Remove the gray clip.',(_b,a)=>a.timeline.spine.some((c:any)=>c.assetId===color('gray'))?'the gray clip is still there':undefined,quick);
  await ask('what was left out','Which of the files I imported are not in the video now?',(b,a)=>{const reply=JSON.stringify(a.messages.at(-1));return a.versionId!==b.versionId?'answering changed the project':!/clip-2|red/i.test(reply)||!/clip-4|gr[ae]y/i.test(reply)?'the reply does not name the red and gray clips':undefined;},(_b:any,_a:any,n:any)=>({'under $0.10':!!n&&n.costUsd<.1}));
 },{computer:false});
});
