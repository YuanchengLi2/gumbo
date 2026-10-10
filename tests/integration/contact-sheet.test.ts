import {it,expect,vi} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {contactSheet} from '../../apps/project-service/src/contact-sheet';
import {initialMediaContext,assetCatalog,captureOrder} from '../../packages/orchestrator/src/media-context';

const frame=(color:string)=>execFileSync(ffmpeg!,['-v','error','-f','lavfi','-i',`color=c=${color}:s=320x180`,'-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1']).toString('base64');

it('tiles frames into one cached JPEG grid',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-sheet-')));try{
  const images=['red','green','blue','white','black'].map(color=>({data:frame(color)}));
  const sheet=await contactSheet(db,ffmpeg!,images,{columns:4,rows:3,width:1568});
  expect(sheet).toMatchObject({mimeType:'image/jpeg',columns:4,rows:2,count:5});expect(sheet.width).toBeLessThanOrEqual(1568);
  const bytes=Buffer.from(sheet.data,'base64');expect(bytes[0]).toBe(255);expect(bytes[1]).toBe(216);
  // The same frames come from the cache, without running ffmpeg again.
  expect(await contactSheet(db,'missing-ffmpeg',images,{columns:4,rows:3,width:1568})).toEqual(sheet);
 }finally{db.close();}
});

it('gives the agent a catalog of every source, one catalog sheet and one contact sheet per shown source',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-sheet-context-')));try{
  for(let n=0;n<10;n++)db.saveAsset(AssetSchema.parse({id:`clip${n}`,filename:`clip ${n}.mp4`,kind:'video',durationSec:12,fps:30,width:1920,height:1080,hasAudio:true,originalPath:join(db.folder,`clip${n}.mp4`),fingerprint:`f${n}`,status:'ready'}));
  db.setMeta('pending_request',JSON.stringify({turnId:'turn',assetIds:[]}));
  const frames=Array.from({length:9},(_,i)=>({timeSec:i,sha256:String(i),data:'AAAA',mimeType:'image/jpeg' as const}));
  db.inspectSource=vi.fn(async(request:any)=>({assetId:request.assetId,fingerprint:'f',startSec:0,endSec:12,sampleIntervalSec:0,frames,coverage:'test'}));
  const sheet=vi.fn(async(images:{data:string}[],options:{columns:number;rows:number})=>({data:'SHEET',mimeType:'image/jpeg' as const,columns:options.columns,rows:options.rows,count:images.length,width:1568,height:900}));
  db.contactSheet=sheet;
  const blocks=await initialMediaContext(db,'turn');
  const images=blocks.filter((b:any)=>b.type==='image'),text=blocks.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
  // One catalog sheet (5 columns, one frame per source) plus a 4x3 sheet for each of the 4 most recent sources.
  expect(images).toHaveLength(5);expect(sheet.mock.calls[0][1]).toMatchObject({columns:5,rows:4});expect(sheet.mock.calls[0][0]).toHaveLength(10);
  expect(sheet.mock.calls.slice(1).every(call=>call[1].columns===4&&call[1].rows===3&&call[0].length===9)).toBe(true);
  expect(text).toContain('#|assetId|name|kind|captured|duration|size|audio|words');expect(text).toContain('10|clip9|clip 9.mp4|video||12s|1920x1080|yes|0');
  expect(text).toContain('Catalog sheet: one frame from the middle of each source');expect(text).toContain('Contact sheet for clip 9.mp4');
 }finally{db.close();}
});

it('orders sources by capture time when it is known',()=>{
 const asset=(id:string,capturedAt?:string)=>({...AssetSchema.parse({id,filename:id,kind:'video',durationSec:1,fps:30,width:1,height:1,hasAudio:false,originalPath:id,fingerprint:id,status:'ready'}),...(capturedAt?{capturedAt}:{})});
 expect(captureOrder([asset('late','2026-10-10T15:00:00Z'),asset('unknown'),asset('early','2026-10-10T09:00:00Z')]).map(a=>a.id)).toEqual(['early','late','unknown']);
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-sheet-catalog-')));try{expect(assetCatalog(db,[asset('a','2026-10-10T09:00:00Z')])).toContain('1|a|a|video|2026-10-10T09:00:00Z|1s|1x1|no|0');}finally{db.close();}
});
