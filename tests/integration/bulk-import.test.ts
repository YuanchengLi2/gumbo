import {it,expect,vi} from 'vitest';
import {mkdtempSync,copyFileSync,utimesSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {Ingest} from '../../apps/project-service/src/media';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

it('imports many files at once, reuses an unchanged file across requests, records source and capture time, and reports bad paths',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-bulk-')),db=new ProjectDB(folder,'Bulk'),publish=vi.fn();
 const a=join(folder,'a.mp4'),b=join(folder,'b.mp4');copyFileSync(resolve('artifacts/fixtures/source.mp4'),a);copyFileSync(resolve('artifacts/fixtures/source.mp4'),b);
 utimesSync(a,new Date('2026-10-10T08:00:00Z'),new Date('2026-10-10T08:00:00Z'));
 const ingest=new Ingest(db,ffmpeg!,ffprobe.path,publish);
 try{
  const results=await ingest.registerMany([a,b,join(folder,'missing.mp4')],()=>false,'first');
  expect(results.filter(r=>'asset'in r)).toHaveLength(2);expect(results[2]).toMatchObject({path:join(folder,'missing.mp4')});
  expect(publish.mock.calls.some(([type])=>type==='state')).toBe(true);
  const first=(results[0] as any).asset;expect(first.source).toMatchObject({path:a,modifiedAt:'2026-10-10T08:00:00.000Z'});expect(first.capturedAt).toBeTruthy();
  // The same unchanged file in a later request is the same asset; a changed file is a new one.
  expect((await ingest.register(a,false,'second-request')).id).toBe(first.id);
  utimesSync(a,new Date('2026-10-10T09:00:00Z'),new Date('2026-10-10T09:00:00Z'));expect((await ingest.register(a,false,'third-request')).id).not.toBe(first.id);
 }finally{await ingest.drain().catch(()=>{});db.close();}
// Background analysis (including the footage map) finishes before the project closes, which takes longer under a full parallel run.
},90_000);

it('gives the agent find_media results marked with what is already imported, and imports in capture order with contact sheets',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-bulk-tools-')),db=new ProjectDB(folder,'Tools');
 const late={id:'late',filename:'late.mp4',kind:'video',durationSec:3,fps:30,width:640,height:360,hasAudio:false,originalPath:resolve('artifacts/fixtures/source.mp4'),capturedAt:'2026-10-10T12:00:00.000Z'},early={...late,id:'early',filename:'early.mp4',capturedAt:'2026-10-10T07:00:00.000Z'};
 db.saveAsset({...early,fingerprint:'e',status:'ready',source:{path:'C:\\Camera\\early.mp4',size:1,modifiedAt:'x'}} as any);
 const files=vi.fn(async(request:any)=>request.action==='computer_status'?{access:true,now:'2026-10-10T18:00:00.000Z',timeZone:'UTC',folders:[{name:'Camera Roll',path:'C:\\Camera',exists:true}]}:{media:[{path:'C:\\Camera\\early.mp4',name:'early.mp4',kind:'video',modifiedAt:'x',sizeMB:1},{path:'C:\\Camera\\late.mp4',name:'late.mp4',kind:'video',modifiedAt:'x',sizeMB:1}],scanned:2,matched:2,truncated:false,now:'2026-10-10T18:00:00.000Z',timeZone:'UTC',folders:[]});
 const importMany=vi.fn(async()=>({results:[{asset:late},{asset:early},{path:'C:\\Camera\\broken.mov',error:'Unsupported file.'}]}));
 db.contactSheet=vi.fn(async(images:any[])=>({data:'SHEET',mimeType:'image/jpeg' as const,columns:5,rows:1,count:images.length,width:1568,height:300}));
 const workspace=new CodeWorkspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path,files:files as any,importMany:importMany as any},()=>{});
 try{
  await workspace.initialize();
  expect((workspace.context('today') as any).computer).toMatchObject({access:true,timeZone:expect.any(String),mediaFolders:[{name:'Camera Roll'}]});
  const found:any=await workspace.execute('find_media',{when:'today'},'find',db.head(),new AbortController().signal);
  expect(found.files.map((f:any)=>f.importedAssetId)).toEqual(['early',undefined]);expect(found.next).toContain('import_media');
  const imported:any=await workspace.execute('import_media',{paths:['C:\\Camera\\late.mp4','C:\\Camera\\early.mp4','C:\\Camera\\broken.mov']},'import',db.head(),new AbortController().signal);
  expect(imported.assets).toEqual(['early','late']);expect(imported.media.map((m:any)=>m.id)).toEqual(['early','late']);expect(imported.failed).toHaveLength(1);
  expect(imported.content.filter((b:any)=>b.type==='image')).toHaveLength(1);expect(JSON.parse(imported.content[0].text).imported.map((i:any)=>i.assetId)).toEqual(['early','late']);
 }finally{db.close();}
});
