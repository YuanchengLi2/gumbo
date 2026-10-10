import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mediaFacts,exifDate,quicktimeDate,tiffDate} from '../../packages/footage/src/capture-time';

const box=(type:string,...parts:Buffer[])=>{const body=Buffer.concat(parts),head=Buffer.alloc(8);head.writeUInt32BE(8+body.length,0);head.write(type,4,'latin1');return Buffer.concat([head,body]);};
const u32=(n:number)=>{const b=Buffer.alloc(4);b.writeUInt32BE(n>>>0);return b;};
const macSeconds=(iso:string)=>Date.parse(iso)/1000+2082844800;
function mvhd(created:string,durationSec:number){const b=Buffer.alloc(100);b.writeUInt32BE(macSeconds(created),4);b.writeUInt32BE(macSeconds(created),8);b.writeUInt32BE(600,12);b.writeUInt32BE(durationSec*600,16);return box('mvhd',b);}
function tkhd(width:number,height:number){const b=Buffer.alloc(84);b.writeUInt32BE(width*65536,76);b.writeUInt32BE(height*65536,80);return box('tkhd',b);}
function appleCreationDate(value:string){
 const key=Buffer.from('com.apple.quicktime.creationdate'),entry=Buffer.concat([u32(8+key.length),Buffer.from('mdta'),key]);
 const keys=box('keys',Buffer.alloc(4),u32(1),entry),data=box('data',u32(1),u32(0),Buffer.from(value)),item=Buffer.concat([u32(8+data.length),u32(1),data]);
 return box('meta',box('hdlr',Buffer.alloc(24)),keys,box('ilst',item));
}
const movie=(parts:Buffer[])=>Buffer.concat([box('ftyp',Buffer.from('qt  '),u32(0)),box('mdat',Buffer.alloc(64)),box('moov',...parts)]);
function exifJpeg(original:string,offset?:string){
 // Little-endian TIFF: IFD0 points to an Exif IFD holding DateTimeOriginal (and its time zone offset).
 const entries:[number,string][]=[[0x9003,original+'\0'],...(offset?[[0x9011,offset+'\0'] as [number,string]]:[])];
 const tiff=Buffer.alloc(200);tiff.write('II',0,'latin1');tiff.writeUInt16LE(42,2);tiff.writeUInt32LE(8,4);
 tiff.writeUInt16LE(1,8);tiff.writeUInt16LE(0x8769,10);tiff.writeUInt16LE(4,12);tiff.writeUInt32LE(1,14);tiff.writeUInt32LE(26,18);tiff.writeUInt32LE(0,22);
 tiff.writeUInt16LE(entries.length,26);let dataAt=26+2+entries.length*12+4;
 entries.forEach(([tag,value],n)=>{const at=28+n*12;tiff.writeUInt16LE(tag,at);tiff.writeUInt16LE(2,at+2);tiff.writeUInt32LE(value.length,at+4);tiff.writeUInt32LE(dataAt,at+8);tiff.write(value,dataAt,'latin1');dataAt+=value.length;});
 const app1=Buffer.concat([Buffer.from([0xff,0xe1]),Buffer.from([0,0]),Buffer.from('Exif\0\0','latin1'),tiff.subarray(0,dataAt)]);app1.writeUInt16BE(app1.length-2,2);
 return Buffer.concat([Buffer.from([0xff,0xd8]),app1,Buffer.from([0xff,0xd9])]);
}

it('reads the phone creation date with its time zone, duration and size from a QuickTime movie',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-capture-')),file=join(dir,'IMG_0001.MOV');
 writeFileSync(file,movie([mvhd('2026-10-10T07:00:00Z',12),box('trak',tkhd(1920,1080)),appleCreationDate('2026-10-10T09:12:33+0200')]));
 expect(mediaFacts(file)).toEqual({capturedAt:'2026-10-10T07:12:33.000Z',capturedAtSource:'quicktime',durationSec:12,width:1920,height:1080});
 const plain=join(dir,'clip.mp4');writeFileSync(plain,movie([mvhd('2026-10-09T18:30:00Z',4),box('trak',tkhd(1080,1920))]));
 expect(mediaFacts(plain)).toMatchObject({capturedAt:'2026-10-09T18:30:00.000Z',capturedAtSource:'mp4',durationSec:4,width:1080,height:1920});
});

it('reads EXIF DateTimeOriginal from a JPEG, with or without an offset, and falls back to file times',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-capture-exif-'));
 const zoned=join(dir,'zoned.jpg');writeFileSync(zoned,exifJpeg('2026:10:10 08:05:00','-04:00'));expect(mediaFacts(zoned)).toEqual({capturedAt:'2026-10-10T12:05:00.000Z',capturedAtSource:'exif'});
 const local=join(dir,'local.jpg');writeFileSync(local,exifJpeg('2026:10:10 08:05:00'));expect(mediaFacts(local).capturedAt).toBe(new Date(2026,9,10,8,5,0).toISOString());
 const plain=join(dir,'notes.wav');writeFileSync(plain,'RIFF');const when=new Date('2026-10-08T10:00:00Z');utimesSync(plain,when,when);
 expect(mediaFacts(plain).capturedAtSource).toBe('file');expect(Date.parse(mediaFacts(plain).capturedAt!)).toBeLessThanOrEqual(when.getTime());
});

it('parses date formats and rejects implausible dates',()=>{
 expect(exifDate('2026:01:02 03:04:05','+00:00')).toBe('2026-01-02T03:04:05.000Z');expect(exifDate('0000:00:00 00:00:00')).toBeUndefined();
 expect(quicktimeDate('2026-10-10T09:12:33-0700')).toBe('2026-10-10T16:12:33.000Z');expect(quicktimeDate('garbage')).toBeUndefined();
 expect(tiffDate(Buffer.from('not a tiff'))).toBeUndefined();
});
