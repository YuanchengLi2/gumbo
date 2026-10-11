import {it,expect,vi} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {CloudSpeech,cloudWords,speechChunks} from '../../apps/project-service/src/speech';
import {run,Ingest} from '../../apps/project-service/src/media';
import ffprobe from 'ffprobe-static';
import {handleTranscription,wavDuration} from '../../supabase/functions/dream-gateway/transcribe';

it('assigns overlapping speech once, preserving absolute source times and stable IDs',()=>{
 const [a,b]=speechChunks(120);expect(a).toMatchObject({start:0,end:30,decodeEnd:31});expect(b).toMatchObject({start:30,end:120,decodeStart:29});
 const first=cloudWords('a',a,{words:[{word:'before',start:29.2,end:29.7},{word:'after',start:30.1,end:30.5}]},120);
 const second=cloudWords('a',b,{words:[{word:'before',start:.2,end:.7},{word:'after',start:1.1,end:1.5}]},120);
 expect([...first,...second].map(w=>w.text)).toEqual(['before','after']);expect(second[0].start).toBe(30.1);
});

it('starts cloud speech directly on import and reuses saved words without another request',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-cloud-speech-')),db=new ProjectDB(folder,'Speech');
 const request=vi.fn(async(_url:any,options:any)=>{const bytes=new Uint8Array(await options.body.arrayBuffer());expect(wavDuration(bytes)).toBeGreaterThan(0);return Response.json({words:[{word:'Hello',start:.2,end:.6}],segments:[{start:0,end:1,avg_logprob:-.2}]});});
 const speech=new CloudSpeech(db,ffmpeg!,async()=>({url:'https://gateway.invalid',token:'test'}),()=>{},request as typeof fetch);
 const ingest=new Ingest(db,ffmpeg!,ffprobe.path,()=>{},undefined,undefined,(asset,signal)=>{expect(asset.fingerprint).toMatch(/^pending:/);expect(asset.audioPath).toBeUndefined();return speech.transcribe(asset,signal);});
 try{const asset=await ingest.register(resolve('artifacts/fixtures/source.mp4'),true);await ingest.drain();expect(db.footage().words[0].text).toBe('Hello');expect(request).toHaveBeenCalledTimes(1);await speech.transcribe(asset,new AbortController().signal);expect(request).toHaveBeenCalledTimes(1);expect(db.footage().words).toHaveLength(1);expect(db.state().jobs.find(j=>j.step==='transcription')?.status).toBe('complete');}finally{await ingest.cancel();db.close();}
});

it('resumes a failed long-media chunk without retranscribing completed chunks',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-speech-retry-')),source=join(folder,'long.wav');await run(ffmpeg!,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=96','-ar','16000','-ac','1',source]);
 const db=new ProjectDB(folder,'Retry');const asset=AssetSchema.parse({id:'a',filename:'long.wav',originalPath:source,kind:'audio',hasAudio:true,durationSec:96,fingerprint:'test'});db.saveAsset(asset);
 let failed=false;const request=vi.fn(async(_url:any,options:any)=>{const duration=wavDuration(new Uint8Array(await options.body.arrayBuffer()));if(duration>40&&!failed){failed=true;return Response.json({error:'Temporary error'},{status:400});}return Response.json({words:[{word:'hello',start:2,end:2.5}]});});
 const speech=new CloudSpeech(db,ffmpeg!,async()=>({url:'https://gateway.invalid',token:'test'}),()=>{},request as typeof fetch);
 try{await expect(speech.transcribe(asset,new AbortController().signal)).rejects.toThrow('Temporary error');expect(db.footage().words).toHaveLength(1);await speech.transcribe(asset,new AbortController().signal);expect(request).toHaveBeenCalledTimes(3);expect(db.footage().words.map(w=>w.start).sort((a,b)=>a-b)).toEqual([2,31]);expect(JSON.parse(db.getMeta('speech-coverage:a')!).status).toBe('complete');}finally{db.close();}
});

it('validates audio on the server and returns a cached result without provider spend',async()=>{
 const invalid=await handleTranscription(new Request('https://test',{method:'POST',body:'bad audio'}),'user',{db:{},key:'server-key'});expect(invalid.status).toBe(400);
 const folder=mkdtempSync(join(tmpdir(),'dream-wav-')),wav=join(folder,'test.wav');await run(ffmpeg!,['-v','error','-f','lavfi','-i','sine=duration=1','-ar','16000','-ac','1',wav]);
 const fetcher=vi.fn(),db={rpc:vi.fn(async()=>({data:{result:{words:[]}}}))};
 const result=await handleTranscription(new Request('https://test',{method:'POST',body:readFileSync(wav)}),'user',{db,key:'server-key',fetcher});expect(result.body).toMatchObject({cached:true,words:[]});expect(fetcher).not.toHaveBeenCalled();expect(db.rpc.mock.calls).toHaveLength(1);
});

it('rides out a dropped connection and a server error during a long transcription without failing it',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-speech-hiccup-')),source=join(folder,'long.wav');await run(ffmpeg!,['-v','error','-f','lavfi','-i','sine=frequency=440:duration=96','-ar','16000','-ac','1',source]);
 const db=new ProjectDB(folder,'Hiccup');const asset=AssetSchema.parse({id:'a',filename:'long.wav',originalPath:source,kind:'audio',hasAudio:true,durationSec:96,fingerprint:'test'});db.saveAsset(asset);
 let hiccups=0;const request=vi.fn(async(_url:any,options:any)=>{const duration=wavDuration(new Uint8Array(await options.body.arrayBuffer()));if(duration>40&&hiccups<2){hiccups++;if(hiccups===1)throw new TypeError('fetch failed');return Response.json({error:'Bad gateway'},{status:502});}return Response.json({words:[{word:'hello',start:2,end:2.5}]});});
 const speech=new CloudSpeech(db,ffmpeg!,async()=>({url:'https://gateway.invalid',token:'test'}),()=>{},request as typeof fetch);
 try{await speech.transcribe(asset,new AbortController().signal);expect(request).toHaveBeenCalledTimes(4);expect(JSON.parse(db.getMeta('speech-coverage:a')!).status).toBe('complete');}finally{db.close();}
},30_000);
