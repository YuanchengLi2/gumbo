import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {ProjectDB,ContactSheetOptions,ContactSheet} from '@dream/project-db';

/** A JPEG's width and height, from its start-of-frame segment. */
export function jpegSize(bytes:Buffer):{width:number;height:number}|undefined{
 for(let at=2;at+9<bytes.length;){if(bytes[at]!==0xff){at++;continue;}const marker=bytes[at+1];
  if(marker>=0xc0&&marker<=0xcf&&marker!==0xc4&&marker!==0xc8&&marker!==0xcc)return{height:bytes.readUInt16BE(at+5),width:bytes.readUInt16BE(at+7)};
  if(marker===0xd8||marker===0x01||marker>=0xd0&&marker<=0xd7){at+=2;continue;}at+=2+bytes.readUInt16BE(at+2);}
}
/** Tiles source frames into one JPEG grid (left to right, top to bottom), so the model reads many frames as one image.
 * Tiles take the frames' own shape (the first frame's), so a vertical video fills its tiles instead of a thin strip in a
 * wide one; a frame of another shape keeps its aspect ratio on a dark letterbox. The sheet is never taller than it is
 * wide. Cached by the frames' content. */
export async function contactSheet(db:ProjectDB,ffmpeg:string,images:{data:string}[],options:ContactSheetOptions,signal?:AbortSignal):Promise<ContactSheet>{
 const columns=Math.max(1,options.columns),rows=Math.max(1,Math.ceil(Math.min(images.length,columns*options.rows)/columns)),count=Math.min(images.length,columns*rows);
 if(!count)throw new Error('A contact sheet needs at least one frame.');
 // Even tile sizes: the scaler rounds to even dimensions, which must never exceed the padded tile.
 const size=jpegSize(Buffer.from(images[0].data,'base64')),aspect=size&&size.width>0&&size.height>0?size.height/size.width:9/16,even=(n:number)=>Math.floor(n/2)*2;
 let tileWidth=Math.max(64,even((options.width-(columns+1)*4)/columns)),tileHeight=even(tileWidth*aspect);
 const tallest=even((options.width-(rows+1)*4)/rows);if(tileHeight>tallest){tileHeight=tallest;tileWidth=Math.max(64,even(tileHeight/aspect));}
 tileHeight=Math.max(36,tileHeight);const used=images.slice(0,count);
 const key='contact-sheet:v2:'+createHash('sha256').update(JSON.stringify({columns,rows,tileWidth,tileHeight,frames:used.map(image=>createHash('sha256').update(image.data).digest('hex'))})).digest('hex');
 const saved=db.getMeta(key);if(saved)return JSON.parse(db.blobs.get(saved));
 const folder=mkdtempSync(join(tmpdir(),'dream-sheet-'));
 try{
  used.forEach((image,n)=>writeFileSync(join(folder,`${String(n).padStart(3,'0')}.jpg`),Buffer.from(image.data,'base64')));
  const filter=`scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${tileWidth}:${tileHeight}:(ow-iw)/2:(oh-ih)/2:color=0x101318,tile=${columns}x${rows}:padding=4:margin=4:color=0x2a2d36`;
  const data=await new Promise<Buffer>((resolve,reject)=>{
   const child=spawn(ffmpeg,['-v','error','-threads','1','-start_number','0','-i',join(folder,'%03d.jpg'),'-frames:v','1','-vf',filter,'-q:v','4','-f','image2pipe','-vcodec','mjpeg','pipe:1'],{windowsHide:true,signal});
   const chunks:Buffer[]=[];let error='';child.stdout.on('data',(chunk:Buffer)=>chunks.push(chunk));child.stderr.on('data',chunk=>error=(error+chunk.toString()).slice(-1200));
   const timer=setTimeout(()=>child.kill(),30000);child.on('error',e=>{clearTimeout(timer);reject(e);});
   child.on('close',code=>{clearTimeout(timer);const bytes=Buffer.concat(chunks);if(signal?.aborted)reject(new DOMException('Contact sheet canceled','AbortError'));else if(code||bytes.length<4||bytes[0]!==255||bytes[1]!==216)reject(new Error('The contact sheet could not be made. '+error));else resolve(bytes);});
  });
  const sheet:ContactSheet={data:data.toString('base64'),mimeType:'image/jpeg',columns,rows,count,width:columns*tileWidth+(columns+1)*4,height:rows*tileHeight+(rows+1)*4};
  db.setMeta(key,db.blobs.put(JSON.stringify(sheet)));return sheet;
 }finally{rmSync(folder,{recursive:true,force:true});}
}
