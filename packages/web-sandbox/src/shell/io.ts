import type {FileHandle,SandboxFS} from '../fs/types';
import {encoder,decode} from '../fs/util';

/** A write to a pipe whose reader has gone (`seq 1 1000000 | head -1`): the writer stops, like SIGPIPE. */
export class BrokenPipe extends Error{code='EPIPE';constructor(){super('Broken pipe');}}
export interface Output{write(data:Uint8Array|string):Promise<void>;/** Bytes not yet taken by the reader, for the memory guard. */buffered?():number}
const bytes=(data:Uint8Array|string)=>typeof data==='string'?encoder.encode(data):data;
const concat=(chunks:Uint8Array[])=>{if(chunks.length===1)return chunks[0];const out=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let at=0;for(const c of chunks){out.set(c,at);at+=c.length;}return out;};

/** Something a command reads from: a pipe, a file, a here-document or nothing. Reading by line keeps the rest for the next
 * reader, so `while read line; do …; done < file` and a command inside the loop share one stdin like a real shell. */
export abstract class Input{
 private rest:Uint8Array|null=null;
 protected abstract pull():Promise<Uint8Array|null>;
 async read():Promise<Uint8Array|null>{if(this.rest){const r=this.rest;this.rest=null;return r;}return this.pull();}
 async readLine():Promise<string|null>{
  const parts:Uint8Array[]=[];
  for(;;){const chunk=await this.read();if(!chunk)return parts.length?decode(concat(parts)):null;const i=chunk.indexOf(10);if(i<0){parts.push(chunk);continue;}parts.push(chunk.subarray(0,i));if(i+1<chunk.length)this.rest=chunk.subarray(i+1);return decode(concat(parts));}
 }
 async readAll(limit=Infinity):Promise<Uint8Array>{const parts:Uint8Array[]=[];let n=0;for(let c;(c=await this.read());){parts.push(c);n+=c.length;if(n>limit)throw new Error(`Input is larger than ${Math.round(limit/1048576)} MB; process it in pieces.`);}return concat(parts);}
 async text(){return decode(await this.readAll());}
 async*lines():AsyncGenerator<string>{for(let line;(line=await this.readLine())!==null;)yield line;}
 /** Chunks as they come, decoded as UTF-8 across chunk edges. */
 async*chunks():AsyncGenerator<Uint8Array>{for(let c;(c=await this.read());)yield c;}
 close(){}
}
export class EmptyInput extends Input{protected async pull(){return null;}}
export class BytesInput extends Input{constructor(private data:Uint8Array|null){super();}protected async pull(){const d=this.data;this.data=null;return d&&d.length?d:null;}}
export class FileInput extends Input{
 private position=0;private handle:FileHandle|null;
 constructor(fs:SandboxFS,path:string,private chunk=1<<20){super();this.handle=fs.open(path,'r');}
 protected async pull(){if(!this.handle)return null;const buffer=new Uint8Array(this.chunk),n=this.handle.read(buffer,this.position);if(n<=0){this.close();return null;}this.position+=n;return n<buffer.length?buffer.subarray(0,n):buffer;}
 close(){this.handle?.close();this.handle=null;}
}
/** A pipe between two commands, holding at most `highWater` bytes before the writer waits. */
export class Pipe extends Input implements Output{
 private queue:Uint8Array[]=[];private size=0;private ended=false;private readerGone=false;
 private wakeReader:(()=>void)|null=null;private wakeWriters:(()=>void)[]=[];
 constructor(private highWater=1<<20){super();}
 async write(data:Uint8Array|string){
  if(this.readerGone)throw new BrokenPipe();const chunk=bytes(data);if(!chunk.length)return;
  this.queue.push(chunk);this.size+=chunk.length;this.wakeReader?.();this.wakeReader=null;
  while(this.size>this.highWater&&!this.readerGone)await new Promise<void>(resolve=>this.wakeWriters.push(resolve));
  if(this.readerGone)throw new BrokenPipe();
 }
 end(){this.ended=true;this.wakeReader?.();this.wakeReader=null;}
 protected async pull(){
  while(!this.queue.length&&!this.ended&&!this.readerGone)await new Promise<void>(resolve=>this.wakeReader=resolve);
  const chunk=this.queue.shift();if(!chunk)return null;this.size-=chunk.length;
  if(this.size<=this.highWater){const w=this.wakeWriters;this.wakeWriters=[];w.forEach(f=>f());}
  return chunk;
 }
 close(){this.readerGone=true;this.queue=[];this.size=0;const w=this.wakeWriters;this.wakeWriters=[];w.forEach(f=>f());}
 buffered(){return this.size;}
}
export class NullOutput implements Output{async write(){}}
export class FileOutput implements Output{
 private handle:FileHandle|null;private position:number;
 constructor(fs:SandboxFS,path:string,append:boolean){this.handle=fs.open(path,append?'a':'w');this.position=append?this.handle.size():0;}
 async write(data:Uint8Array|string){if(!this.handle)throw new BrokenPipe();const chunk=bytes(data);this.handle.write(chunk,this.position);this.position+=chunk.length;}
 close(){this.handle?.close();this.handle=null;}
}
/** Collects what a command prints into a string, for $(…) and the tests. */
export class StringOutput implements Output{
 private parts:Uint8Array[]=[];private total=0;
 constructor(private limit=64<<20){}
 async write(data:Uint8Array|string){const chunk=bytes(data);this.total+=chunk.length;if(this.total>this.limit)throw new Error(`Output is larger than ${Math.round(this.limit/1048576)} MB.`);this.parts.push(chunk.slice());}
 text(){return decode(concat(this.parts));}
 bytes(){return concat(this.parts);}
 buffered(){return this.total;}
}
/** The terminal: text goes to a callback as it comes, decoded across chunk edges. */
export class CallbackOutput implements Output{
 private decoder=new TextDecoder();
 constructor(private emit:(text:string)=>void){}
 async write(data:Uint8Array|string){if(typeof data==='string'){this.emit(data);return;}const text=this.decoder.decode(data.buffer instanceof ArrayBuffer?data:data.slice(),{stream:true});if(text)this.emit(text);}
}
