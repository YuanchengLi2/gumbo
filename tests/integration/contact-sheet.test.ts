import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {contactSheet} from '../../apps/project-service/src/contact-sheet';
import {captureOrder} from '../../packages/orchestrator/src/media-context';

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

it('orders sources by capture time when it is known',()=>{
 const asset=(id:string,capturedAt?:string)=>({...AssetSchema.parse({id,filename:id,kind:'video',durationSec:1,fps:30,width:1,height:1,hasAudio:false,originalPath:id,fingerprint:id,status:'ready'}),...(capturedAt?{capturedAt}:{})});
 expect(captureOrder([asset('late','2026-10-10T15:00:00Z'),asset('unknown'),asset('early','2026-10-10T09:00:00Z')]).map(a=>a.id)).toEqual(['early','late','unknown']);
});
