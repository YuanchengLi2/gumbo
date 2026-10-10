import {it,expect} from 'vitest';
import {mkdtempSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {Ingest} from '../../apps/project-service/src/media';

it('imports real media and retries only the chosen stage while preserving completed artifacts',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-ingest-test-')),db=new ProjectDB(folder,'Ingest');
 const original={binary:process.env.DREAM_INGEST_BINARY,model:process.env.DREAM_WHISPER_MODEL};
 delete process.env.DREAM_INGEST_BINARY;delete process.env.DREAM_WHISPER_MODEL;
 const ingest=new Ingest(db,ffmpeg!,ffprobe.path,()=>{});
 try{
  await ingest.register(resolve('artifacts/fixtures/source.mp4'));await ingest.drain();
  const asset=db.footage().assets[0];expect(asset.status).toBe('ready');expect(asset.waveform.length).toBeGreaterThan(0);expect(asset.audioPath).toBeTruthy();
  expect(asset.playback).toMatchObject({ready:true,video:'original'});expect(asset.proxyPath).toBeUndefined();
  const before=statSync(asset.audioPath!).mtimeMs,cursor=db.state().eventCursor;
  ingest.retry(asset,'waveform');await ingest.drain();
  expect(statSync(asset.audioPath!).mtimeMs).toBe(before);
  const started=db.events(cursor).filter(e=>e.type==='ingest.progress'&&e.payload.status==='running').map(e=>e.payload.step);
  expect(started).toEqual(['waveform']);
  expect(db.state().jobs.find(j=>j.step==='transcription')?.status).toBe('waiting_for_model');
  expect(db.state().jobs.find(j=>j.step==='analysis')?.status).toBe('partial');
 }finally{await ingest.cancel();db.close();if(original.binary)process.env.DREAM_INGEST_BINARY=original.binary;else delete process.env.DREAM_INGEST_BINARY;if(original.model)process.env.DREAM_WHISPER_MODEL=original.model;else delete process.env.DREAM_WHISPER_MODEL;}
});
