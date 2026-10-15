import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {contactSheet,jpegSize} from '../../apps/project-service/src/contact-sheet';
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

// A vertical video's frames went into wide 16:9 tiles: each became a strip a third of its tile, captions too small to read,
// and the agent kept re-checking a vertical edit's captions it could not see.
it('gives vertical frames tiles of their own shape, never taller than the sheet is wide',async()=>{
 const tall=(color:string)=>execFileSync(ffmpeg!,['-v','error','-f','lavfi','-i',`color=c=${color}:s=540x960`,'-frames:v','1','-f','image2pipe','-vcodec','mjpeg','pipe:1']).toString('base64');
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-sheet-tall-')));try{
  expect(jpegSize(Buffer.from(tall('red'),'base64'))).toEqual({width:540,height:960});
  const two=await contactSheet(db,ffmpeg!,['red','green','blue','white','black','gray'].map(color=>({data:tall(color)})),{columns:4,rows:3,width:1536});
  // Two rows of 9:16 tiles 378 wide: each tile 672 tall, the sheet about 1352 tall.
  expect(two.rows).toBe(2);expect(two.width).toBe(4*378+20);expect(two.height).toBeGreaterThan(1300);expect(two.height).toBeLessThanOrEqual(1536);
  const three=await contactSheet(db,ffmpeg!,Array.from({length:12},(_,n)=>({data:tall(n%2?'red':'blue')})),{columns:4,rows:3,width:1536});
  expect(three.rows).toBe(3);expect(three.height).toBeLessThanOrEqual(1536);
  // Landscape frames keep the 16:9 tiles they had.
  const wide=await contactSheet(db,ffmpeg!,['red','green'].map(color=>({data:frame(color)})),{columns:4,rows:3,width:1568});
  expect(wide.height).toBe(Math.floor(((1568-20)/4)*9/16/2)*2+8);
 }finally{db.close();}
});
