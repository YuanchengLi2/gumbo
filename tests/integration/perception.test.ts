import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {emptyTimeline,TimelineSchema,resolve} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {ProjectDB} from '@dream/project-db';
import {mixEditRange,measureClip,extractAudio} from '../../apps/project-service/src/edit-audio';
import {viewEdit,happenings} from '../../apps/project-service/src/edit-view';
import {Workspace} from '../../apps/project-service/src/workspace';
import {chatRequest,responsesRequest,providerModels} from '../../supabase/functions/dream-gateway/providers';
import {promptEstimate} from '../../supabase/functions/dream-gateway/inference-policy';
import {estimateTokens} from '../../packages/agent/src/compact';
import {call,textOf} from '../fixtures/agent-project';

const tone=(folder:string,seconds=3)=>{const path=join(folder,'tone.wav');execFileSync(ffmpeg!,['-v','error','-y','-f','lavfi','-i',`sine=frequency=440:duration=${seconds}`,'-ar','48000','-ac','2',path]);return path;};
// A ten-second timeline: a silent picture clip, and a three-second tone placed from 2 s to 5 s at full gain.
function project(path:string){
 const footage=emptyFootage();footage.assets=[AssetSchema.parse({id:'pic',filename:'pic.png',kind:'image',originalPath:path,durationSec:10,width:320,height:180,fps:30,hasAudio:false,fingerprint:'p',status:'ready'}),AssetSchema.parse({id:'tone',filename:'tone.wav',kind:'audio',originalPath:path,durationSec:3,fps:30,hasAudio:true,fingerprint:'t',status:'ready'})];
 const t=emptyTimeline('t'),timeline=TimelineSchema.parse({...t,settings:{...t.settings,width:320,height:180},spine:[{id:'still',assetId:'pic',srcIn:0,srcOut:10,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:true},reason:''}],
  music:[{id:'beep',assetId:'tone',srcIn:0,srcOut:3,start:{kind:'project',at:'start',offsetSec:2},gainDb:0,duckUnderSpeechDb:0,fadeInSec:0,fadeOutSec:0,reason:''}]});
 return{footage,timeline};
}

it('mixes a stretch of the edit as Export does: each sound where the timeline puts it, silence elsewhere',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-listen-')),path=tone(folder),{footage,timeline}=project(path),signal=new AbortController().signal;
 const clip=(await mixEditRange(ffmpeg!,timeline,footage,1,6,signal))!;
 expect(clip.subarray(0,3).toString('latin1')).toMatch(/^(ID3|\xff[\xe0-\xff])/);
 const m:any=await measureClip(ffmpeg!,clip,signal);
 // The tone plays from 2 s to 5 s of the edit, so in this 1-6 s stretch from 1 s to 4 s: silent before and after.
 expect(m.silent[0]).toMatch(/^0-(0\.9|1|1\.1)s$/);expect(m.silent.at(-1)).toMatch(/^(3\.9|4|4\.1)-end|^(3\.9|4|4\.1)-(4\.9|5)s$/);expect(m.integratedLufs).toBeLessThan(0);
 expect(await mixEditRange(ffmpeg!,timeline,footage,6,9,signal)).toBeUndefined();
 const source=await extractAudio(ffmpeg!,path,.5,2,signal);expect(source.length).toBeGreaterThan(1000);
},60_000);

it('lets the agent listen to a source or to the edit, through the hearing model, with the loudness beside it',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-listen-tool-')),db=new ProjectDB(folder,'Listen'),path=tone(folder);
 db.saveAsset(AssetSchema.parse({id:'tone',filename:'tone.wav',kind:'audio',originalPath:path,durationSec:3,fps:30,hasAudio:true,fingerprint:'t',status:'ready'}));
 const heard:any[]=[];const listen=vi.fn(async(clip:any,turnId:string)=>{heard.push({...clip,turnId});return'A steady 440 Hz tone from 0 s to 2 s, no speech.';});
 const workspace=new Workspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path,listen},()=>{});
 try{
  await workspace.initialize();
  const result=textOf(await call(workspace,'listen',{source:'tone',start:0,end:2,question:'Is there speech?'},'l1','turn-1'));
  expect(result).toContain('A steady 440 Hz tone from 0 s to 2 s, no speech.');expect(result).toMatch(/integratedLufs/);
  expect(heard[0]).toMatchObject({durationSec:2,what:'tone.wav from 0 s to 2 s',question:'Is there speech?',turnId:'turn-1'});expect(Buffer.from(heard[0].audio,'base64').length).toBeGreaterThan(1000);
  // At most 90 seconds are heard at once; the source can be named by its file name.
  await call(workspace,'listen',{source:'tone.wav',start:0,end:500},'l2','turn-1');expect(heard[1].durationSec).toBe(90);
  // The edit is empty: nothing sounds there, and nothing is sent.
  expect(textOf(await call(workspace,'listen',{target:'edit',start:0,end:5},'l3','turn-1'))).toBe('Nothing sounds in the edit from 0 s to 5 s.');expect(listen).toHaveBeenCalledTimes(2);
  // When the hearing model fails, the loudness still comes back.
  listen.mockRejectedValueOnce(new Error('hearing needs the Gemini key on the gateway'));
  const failed=textOf(await call(workspace,'listen',{source:'tone',start:0,end:1},'l4','turn-1'));expect(failed).toMatch(/Listening failed \(hearing needs the Gemini key/);expect(failed).toMatch(/integratedLufs/);
 }finally{workspace.close();db.close();}
},60_000);

it('gives Gemini the sound to hear, tells other models it was there, and counts sound by its length',()=>{
 const audio={type:'audio',source:{type:'base64',media_type:'audio/mpeg',data:'SUQz'},durationSec:30};
 const body={model:'gemini-3.8-flash',system:'Listen.',messages:[{role:'user',content:[{type:'text',text:'Audio: the edit.'},audio]}]};
 expect(chatRequest(body,providerModels['gemini-3.8-flash'],1000).messages.at(-1).content).toEqual([{type:'text',text:'Audio: the edit.'},{type:'input_audio',input_audio:{data:'SUQz',format:'mp3'}}]);
 expect(chatRequest({...body,model:'deepseek-flash'},providerModels['deepseek-flash'],1000).messages.at(-1).content).toBe('Audio: the edit.\n\n[Audio was attached here; this model cannot hear it.]');
 expect(JSON.stringify(responsesRequest({...body,model:'gpt-6-luna'},providerModels['gpt-6-luna'],1000))).not.toContain('SUQz');
 const big={...audio,source:{...audio.source,data:'A'.repeat(1_000_000)}};expect(promptEstimate(big)).toBe(30*32+50);expect(estimateTokens(big)).toBe(30*32+50);
});

it('shows a stretch of the edit as one strip of frames with what happens in it: cuts, items and sounds, and the pace',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-strip-')),path=tone(folder),{footage,timeline}=project(path);
 const cut=TimelineSchema.parse({...timeline,spine:[{...timeline.spine[0],srcOut:4},{...timeline.spine[0],id:'second',srcIn:4,srcOut:10}]});
 const draw=async(request:any)=>({versionId:request.versionId,frames:request.frames.map((f:any)=>({...f,mimeType:'image/jpeg' as const,data:'/9j/AA==',sha256:'0'.repeat(64)}))});
 const sheet=vi.fn(async(images:any[])=>({data:'STRIP'+images.length}));
 const result:any=await viewEdit({startSec:0,endSec:8},{versionId:'v',timeline:cut,footage},draw as any,new AbortController().signal,sheet);
 const summary=JSON.parse(result.content[0].text);
 expect(summary.stretch.events).toEqual(['0s cut to still (pic.png 0-4s)','2s sound beep starts (tone.wav, 0 dB)','4s cut to second (pic.png 4-10s)','5s sound beep ends']);
 expect(summary.stretch.pace).toEqual({mainTrackShots:2,averageShotSec:4.02,shortestSec:4,longestSec:4.03});
 expect(result.content.filter((b:any)=>b.type==='image')).toEqual([{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'STRIP8'}}]);
 // Single moments still come back one by one, without a stretch.
 const one:any=await viewEdit({times:[1,3]},{versionId:'v',timeline:cut,footage},draw as any,new AbortController().signal,sheet);
 expect(JSON.parse(one.content[0].text).stretch).toBeUndefined();expect(one.content.filter((b:any)=>b.type==='image')).toHaveLength(2);
 expect(happenings(resolve(cut,footage),new Map(),9,10).events).toEqual([]);
});
