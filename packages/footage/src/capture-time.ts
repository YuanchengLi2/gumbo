import {openSync,readSync,closeSync,fstatSync} from 'node:fs';
import {extname} from 'node:path';

/** When and how a media file was captured, read from its own metadata without decoding it. */
export type MediaFacts={capturedAt?:string;capturedAtSource?:'quicktime'|'mp4'|'exif'|'file';durationSec?:number;width?:number;height?:number};
type Read=(position:number,length:number)=>Buffer;

const MAC_EPOCH=2082844800;
const plausible=(date:Date)=>{const year=date.getUTCFullYear();return Number.isFinite(date.getTime())&&year>=1995&&year<=2100;};
const iso=(date:Date)=>plausible(date)?date.toISOString():undefined;
const bmff=new Set(['.mp4','.mov','.m4v','.3gp','.3g2','.heic','.heif','.avif','.mqv']);
const jpegs=new Set(['.jpg','.jpeg']),tiffs=new Set(['.tif','.tiff','.dng']);

/** "2026:10:10 09:12:33" with an optional "+02:00" offset; without an offset the time is local to this computer. */
export function exifDate(value:string,offset?:string){
 const m=/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim());if(!m)return;
 const [,y,mo,d,h,mi,s]=m.map(Number);
 const date=offset&&/^[+-]\d{2}:\d{2}$/.test(offset.trim())?new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset.trim()}`):new Date(y,mo-1,d,h,mi,s);
 return iso(date);
}
/** QuickTime creation dates look like 2026-10-10T09:12:33+0200. */
export function quicktimeDate(value:string){return iso(new Date(value.trim().replace(/([+-]\d{2})(\d{2})$/,'$1:$2')));}

/** Reads DateTimeOriginal (with OffsetTimeOriginal) from a TIFF/EXIF block, falling back to the file's DateTime. */
export function tiffDate(tiff:Buffer):string|undefined{
 if(tiff.length<8)return;const little=tiff.toString('latin1',0,2)==='II';if(!little&&tiff.toString('latin1',0,2)!=='MM')return;
 const u16=(at:number)=>at+2<=tiff.length?(little?tiff.readUInt16LE(at):tiff.readUInt16BE(at)):0,u32=(at:number)=>at+4<=tiff.length?(little?tiff.readUInt32LE(at):tiff.readUInt32BE(at)):0;
 const entries=(offset:number)=>{const out=new Map<number,{type:number;count:number;at:number}>();const count=u16(offset);for(let n=0;n<count&&n<512;n++){const at=offset+2+n*12;if(at+12>tiff.length)break;out.set(u16(at),{type:u16(at+2),count:u32(at+4),at:at+8});}return out;};
 const text=(entry?:{type:number;count:number;at:number})=>{if(!entry||entry.type!==2)return;const start=entry.count<=4?entry.at:u32(entry.at);return tiff.toString('latin1',start,Math.min(tiff.length,start+entry.count)).replace(/\0+$/,'');};
 const ifd0=entries(u32(4)),exifPointer=ifd0.get(0x8769),exif=exifPointer?entries(u32(exifPointer.at)):new Map();
 const original=text(exif.get(0x9003));if(original)return exifDate(original,text(exif.get(0x9011)));
 const digitized=text(exif.get(0x9004));if(digitized)return exifDate(digitized,text(exif.get(0x9012)));
 const changed=text(ifd0.get(0x0132));return changed?exifDate(changed,text(exif.get(0x9010))):undefined;
}

function jpegExif(read:Read){
 const head=read(0,512*1024);if(head[0]!==0xff||head[1]!==0xd8)return;
 for(let at=2;at+4<head.length;){
  if(head[at]!==0xff){at++;continue;}const marker=head[at+1];if(marker===0xd9||marker===0xda)break;if(marker===0xd8||marker>=0xd0&&marker<=0xd7||marker===0x01){at+=2;continue;}
  const length=head.readUInt16BE(at+2);if(marker===0xe1&&head.toString('latin1',at+4,at+10)==='Exif\0\0')return tiffDate(head.subarray(at+10,at+2+length));
  at+=2+length;
 }
}

/** Iterates ISO base media boxes between start and end. */
function boxes(read:Read,start:number,end:number,visit:(type:string,body:number,next:number)=>boolean|void){
 for(let at=start;at+8<=end;){
  const header=read(at,16);if(header.length<8)return;let size=header.readUInt32BE(0),body=at+8;const type=header.toString('latin1',4,8);
  if(size===1){if(header.length<16)return;size=Number(header.readBigUInt64BE(8));body=at+16;}else if(size===0)size=end-at;
  if(size<8||at+size>end+8)return;if(visit(type,body,Math.min(end,at+size))===true)return;at+=size;
 }
}

function movieFacts(read:Read,size:number):MediaFacts{
 const facts:MediaFacts={};let moov:[number,number]|undefined,meta:[number,number]|undefined;
 boxes(read,0,size,(type,body,next)=>{if(type==='moov')moov=[body,next];if(type==='meta')meta=[body+4,next];});
 if(moov){
  const [start,end]=moov,buffer=read(start,Math.min(end-start,32*1024*1024)),local:Read=(p,l)=>buffer.subarray(p-start,p-start+l);
  const keys:string[]=[];let creationDate:string|undefined,day:string|undefined;
  const walk=(from:number,to:number)=>boxes(local,from,to,(type,body,next)=>{
   if(type==='mvhd'){const b=local(body,32),v=b[0];const created=v===1?Number(b.readBigUInt64BE(4)):b.readUInt32BE(4),scale=v===1?b.readUInt32BE(20):b.readUInt32BE(12),length=v===1?Number(b.readBigUInt64BE(24)):b.readUInt32BE(16);const date=iso(new Date((created-MAC_EPOCH)*1000));if(date)facts.capturedAt=date,facts.capturedAtSource='mp4';if(scale)facts.durationSec=Math.round(length/scale*1000)/1000;}
   else if(type==='tkhd'&&!facts.width){const v=local(body,1)[0],at=body+(v===1?88:76),w=local(at,4).readUInt32BE(0)/65536,h=local(at+4,4).readUInt32BE(0)/65536;if(w>0&&h>0){facts.width=Math.round(w);facts.height=Math.round(h);}}
   else if(type==='trak'||type==='mdia'||type==='udta')walk(body,next);
   else if(type==='meta'){const first=local(body+4,4).toString('latin1');walk(['hdlr','keys','ilst'].includes(first)?body:body+4,next);}
   else if(type==='keys'){const count=local(body+4,4).readUInt32BE(0);let at=body+8;for(let n=0;n<count&&at<next;n++){const size=local(at,4).readUInt32BE(0);keys.push(local(at+8,Math.max(0,size-8)).toString('utf8'));at+=Math.max(8,size);}}
   else if(type==='ilst')boxes(local,body,next,(index,itemBody,itemNext)=>{const key=index==='©day'?'©day':keys[local(itemBody-4,4).readUInt32BE(0)-1];boxes(local,itemBody,itemNext,(dataType,dataBody,dataNext)=>{if(dataType!=='data')return;const value=local(dataBody+8,dataNext-dataBody-8).toString('utf8');if(key==='com.apple.quicktime.creationdate')creationDate=value;else if(key==='©day')day=value;});});
   else if(type==='©day'){const b=local(body,next-body);day=b.toString('utf8',4,4+b.readUInt16BE(0));}
  });
  walk(start,end);
  // The phone's own creation date carries its time zone and survives edits; it wins over the container timestamp.
  const preferred=creationDate?quicktimeDate(creationDate):day?quicktimeDate(day):undefined;if(preferred){facts.capturedAt=preferred;facts.capturedAtSource='quicktime';}
 }
 if(meta&&!facts.capturedAt){const date=heifExif(read,meta[0],meta[1]);if(date){facts.capturedAt=date;facts.capturedAtSource='exif';}}
 return facts;
}

/** HEIF/HEIC photos keep EXIF as an item located through iinf and iloc. */
function heifExif(read:Read,start:number,end:number){
 let exifItem:number|undefined;const locations=new Map<number,{offset:number;length:number}>();
 boxes(read,start,end,(type,body,next)=>{
  const b=read(body,next-body);
  if(type==='iinf'){const v=b[0];let at=v===0?6:8;while(at+8<b.length){const size=b.readUInt32BE(at),kind=b.toString('latin1',at+4,at+8);if(kind==='infe'){const iv=b[at+8],id=iv>=3?b.readUInt32BE(at+12):b.readUInt16BE(at+12),typeAt=at+12+(iv>=3?4:2)+2;if(b.toString('latin1',typeAt,typeAt+4)==='Exif')exifItem=id;}if(size<8)break;at+=size;}}
  if(type==='iloc'){const v=b[0],offsetSize=b[4]>>4,lengthSize=b[4]&15,baseSize=b[5]>>4,indexSize=v>=1?b[5]&15:0;let at=6;const count=v<2?b.readUInt16BE(at):b.readUInt32BE(at);at+=v<2?2:4;const int=(size:number)=>{const value=size===8?Number(b.readBigUInt64BE(at)):size===4?b.readUInt32BE(at):size===2?b.readUInt16BE(at):0;at+=size;return value;};
   for(let n=0;n<count&&at<b.length;n++){const id=v<2?b.readUInt16BE(at):b.readUInt32BE(at);at+=v<2?2:4;if(v>=1)at+=2;at+=2;const base=int(baseSize),extents=b.readUInt16BE(at);at+=2;for(let e=0;e<extents;e++){if(indexSize)int(indexSize);const offset=int(offsetSize),length=int(lengthSize);if(e===0)locations.set(id,{offset:base+offset,length});}}}
 });
 const location=exifItem===undefined?undefined:locations.get(exifItem);if(!location||location.length<8)return;
 const data=read(location.offset,Math.min(location.length,256*1024)),tiffAt=4+data.readUInt32BE(0);return tiffDate(data.subarray(tiffAt));
}

/** Capture time and basic facts from the file's own metadata, falling back to the earliest file timestamp. */
export function mediaFacts(path:string):MediaFacts{
 const extension=extname(path).toLowerCase();let facts:MediaFacts={};let fd:number|undefined;
 try{
  fd=openSync(path,'r');const size=fstatSync(fd).size,handle=fd;
  const read:Read=(position,length)=>{const buffer=Buffer.alloc(Math.max(0,Math.min(length,size-position)));if(buffer.length)readSync(handle,buffer,0,buffer.length,position);return buffer;};
  if(bmff.has(extension))facts=movieFacts(read,size);
  else if(jpegs.has(extension)){const date=jpegExif(read);if(date)facts={capturedAt:date,capturedAtSource:'exif'};}
  else if(tiffs.has(extension)){const date=tiffDate(read(0,1024*1024));if(date)facts={capturedAt:date,capturedAtSource:'exif'};}
  if(!facts.capturedAt){const info=fstatSync(fd),times=[info.birthtime,info.mtime].filter(t=>t&&plausible(t)).map(t=>t.getTime());if(times.length){facts.capturedAt=new Date(Math.min(...times)).toISOString();facts.capturedAtSource='file';}}
 }catch{}finally{if(fd!==undefined)closeSync(fd);}
 return facts;
}
