import {gzipSync,gunzipSync,deflateSync,inflateSync,zlibSync,unzlibSync} from 'fflate';
import {md5,sha1} from '@noble/hashes/legacy.js';
import {sha256,sha512} from '@noble/hashes/sha2.js';
import {CommandError,type Command,type CommandContext} from '../shell/types';
import {EmptyInput,StringOutput,BytesInput} from '../shell/io';
import type {FileStat,SandboxFS} from '../fs/types';
import {tryStat,mkdirp,removeTree,copyTree,decode,encoder} from '../fs/util';
import * as posix from '../path';
import {resolveModule,type ResolveOptions} from './resolve';
import {toCommonJS,stripToESM,formatError} from './esbuild';

export const NODE_VERSION='v22.12.0';
class Exit{constructor(public code:number){}}
type Module={id:string;filename:string;loaded:boolean;exports:any;children:Module[];paths:string[];parent?:Module|null;require?:any};

// ---------- Buffer: the common part of Node's, over Uint8Array
function toBase64(bytes:Uint8Array,url=false){let bin='';for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode(...bytes.subarray(i,i+32768));const s=btoa(bin);return url?s.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):s;}
function fromBase64(text:string){const clean=text.replace(/[^A-Za-z0-9+/\-_]/g,'').replace(/-/g,'+').replace(/_/g,'/');const bin=atob(clean.padEnd(Math.ceil(clean.length/4)*4,'='));return Uint8Array.from(bin,c=>c.charCodeAt(0));}
type Encoding='utf8'|'utf-8'|'hex'|'base64'|'base64url'|'latin1'|'binary'|'ascii'|'utf16le'|'ucs2';
export class Buffer extends Uint8Array{
 static from(value:any,encodingOrOffset?:any,length?:number):Buffer{
  if(typeof value==='string')return Buffer.fromBytes(encode(value,encodingOrOffset??'utf8'));
  if(value instanceof ArrayBuffer||(typeof SharedArrayBuffer!=='undefined'&&value instanceof SharedArrayBuffer))return new Buffer(value as ArrayBuffer,encodingOrOffset??0,length??value.byteLength-(encodingOrOffset??0));
  if(ArrayBuffer.isView(value))return Buffer.fromBytes(new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice());
  if(Array.isArray(value))return Buffer.fromBytes(Uint8Array.from(value));
  if(value&&value.type==='Buffer'&&Array.isArray(value.data))return Buffer.fromBytes(Uint8Array.from(value.data));
  throw new TypeError('The first argument must be of type string, Buffer, ArrayBuffer or Array');
 }
 static fromBytes(bytes:Uint8Array){return new Buffer(bytes.buffer as ArrayBuffer,bytes.byteOffset,bytes.byteLength);}
 static alloc(size:number,fill?:number|string){const b=new Buffer(size);if(fill!==undefined)b.fill(typeof fill==='string'?fill.charCodeAt(0):fill);return b;}
 static allocUnsafe(size:number){return new Buffer(size);}
 static isBuffer(value:unknown):value is Buffer{return value instanceof Buffer;}
 static isEncoding(enc:string){return['utf8','utf-8','hex','base64','base64url','latin1','binary','ascii','utf16le','ucs2'].includes(enc?.toLowerCase());}
 static byteLength(value:string|Uint8Array,encoding:Encoding='utf8'){return typeof value==='string'?encode(value,encoding).length:value.byteLength;}
 static concat(list:Uint8Array[],total?:number){const size=total??list.reduce((n,b)=>n+b.length,0),out=Buffer.alloc(size);let at=0;for(const b of list){out.set(b.subarray(0,Math.max(0,size-at)),at);at+=b.length;if(at>=size)break;}return out;}
 static compare(a:Uint8Array,b:Uint8Array){for(let i=0;i<Math.min(a.length,b.length);i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return Math.sign(a.length-b.length);}
 toString(encoding:Encoding='utf8',start=0,end=this.length):string{return decodeAs(this.subarray(start,end),encoding);}
 toJSON(){return{type:'Buffer',data:Array.from(this)};}
 equals(other:Uint8Array){return Buffer.compare(this,other)===0;}
 compare(other:Uint8Array){return Buffer.compare(this,other);}
 write(text:string,offset=0,length?:number,encoding:Encoding='utf8'){const bytes=encode(text,encoding).subarray(0,length??Infinity);this.set(bytes.subarray(0,this.length-offset),offset);return Math.min(bytes.length,this.length-offset);}
 slice(start?:number,end?:number):Buffer{const s=super.subarray(start,end);return new Buffer(s.buffer,s.byteOffset,s.byteLength);}
 subarray(start?:number,end?:number):Buffer{const s=super.subarray(start,end);return new Buffer(s.buffer,s.byteOffset,s.byteLength);}
 copy(target:Uint8Array,targetStart=0,start=0,end=this.length){const part=this.subarray(start,end);target.set(part.subarray(0,target.length-targetStart),targetStart);return Math.min(part.length,target.length-targetStart);}
 private view(){return new DataView(this.buffer,this.byteOffset,this.byteLength);}
 readUInt8(o=0){return this[o];}readInt8(o=0){return this.view().getInt8(o);}
 readUInt16LE(o=0){return this.view().getUint16(o,true);}readUInt16BE(o=0){return this.view().getUint16(o);}readInt16LE(o=0){return this.view().getInt16(o,true);}readInt16BE(o=0){return this.view().getInt16(o);}
 readUInt32LE(o=0){return this.view().getUint32(o,true);}readUInt32BE(o=0){return this.view().getUint32(o);}readInt32LE(o=0){return this.view().getInt32(o,true);}readInt32BE(o=0){return this.view().getInt32(o);}
 readFloatLE(o=0){return this.view().getFloat32(o,true);}readFloatBE(o=0){return this.view().getFloat32(o);}readDoubleLE(o=0){return this.view().getFloat64(o,true);}readDoubleBE(o=0){return this.view().getFloat64(o);}
 readBigUInt64LE(o=0){return this.view().getBigUint64(o,true);}readBigInt64LE(o=0){return this.view().getBigInt64(o,true);}
 writeUInt8(v:number,o=0){this[o]=v;return o+1;}writeInt8(v:number,o=0){this.view().setInt8(o,v);return o+1;}
 writeUInt16LE(v:number,o=0){this.view().setUint16(o,v,true);return o+2;}writeUInt16BE(v:number,o=0){this.view().setUint16(o,v);return o+2;}writeInt16LE(v:number,o=0){this.view().setInt16(o,v,true);return o+2;}
 writeUInt32LE(v:number,o=0){this.view().setUint32(o,v,true);return o+4;}writeUInt32BE(v:number,o=0){this.view().setUint32(o,v);return o+4;}writeInt32LE(v:number,o=0){this.view().setInt32(o,v,true);return o+4;}writeInt32BE(v:number,o=0){this.view().setInt32(o,v);return o+4;}
 writeFloatLE(v:number,o=0){this.view().setFloat32(o,v,true);return o+4;}writeDoubleLE(v:number,o=0){this.view().setFloat64(o,v,true);return o+8;}
 readUIntLE(o:number,n:number){let v=0;for(let i=n-1;i>=0;i--)v=v*256+this[o+i];return v;}readUIntBE(o:number,n:number){let v=0;for(let i=0;i<n;i++)v=v*256+this[o+i];return v;}
 indexOf(value:any,from=0):number{if(typeof value==='number')return super.indexOf(value,from);const needle=typeof value==='string'?encoder.encode(value):value as Uint8Array;outer:for(let i=from;i<=this.length-needle.length;i++){for(let j=0;j<needle.length;j++)if(this[i+j]!==needle[j])continue outer;return i;}return-1;}
 includes(value:any,from=0){return this.indexOf(value,from)>=0;}
}
function encode(text:string,encoding:string):Uint8Array{
 switch(encoding.toLowerCase()){
  case'hex':{const out=new Uint8Array(text.length>>1);for(let i=0;i<out.length;i++)out[i]=parseInt(text.substr(i*2,2),16);return out;}
  case'base64':case'base64url':return fromBase64(text);
  case'latin1':case'binary':case'ascii':return Uint8Array.from(text,c=>c.charCodeAt(0)&255);
  case'utf16le':case'ucs2':case'ucs-2':case'utf-16le':{const out=new Uint8Array(text.length*2);for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);out[i*2]=c&255;out[i*2+1]=c>>8;}return out;}
  default:return encoder.encode(text);
 }
}
function decodeAs(bytes:Uint8Array,encoding:string):string{
 switch(encoding.toLowerCase()){
  case'hex':return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  case'base64':return toBase64(bytes);case'base64url':return toBase64(bytes,true);
  case'latin1':case'binary':return Array.from(bytes,b=>String.fromCharCode(b)).join('');
  case'ascii':return Array.from(bytes,b=>String.fromCharCode(b&127)).join('');
  case'utf16le':case'ucs2':case'ucs-2':case'utf-16le':{let s='';for(let i=0;i+1<bytes.length;i+=2)s+=String.fromCharCode(bytes[i]|bytes[i+1]<<8);return s;}
  default:return decode(bytes);
 }
}
// ---------- util.inspect and format, close enough to Node's for logs
export function inspect(value:any,options:{depth?:number}={},seen=new Set<any>(),level=0):string{
 const depth=options.depth??2;
 if(value===null)return'null';if(value===undefined)return'undefined';
 switch(typeof value){
  case'string':return level===0?value:`'${value.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n')}'`;
  case'number':return Object.is(value,-0)?'-0':String(value);case'bigint':return value+'n';case'boolean':return String(value);
  case'symbol':return value.toString();case'function':return value.name?`[Function: ${value.name}]`:'[Function (anonymous)]';
 }
 if(seen.has(value))return'[Circular *1]';
 if(value instanceof Error)return value.stack??`${value.name}: ${value.message}`;
 if(value instanceof Date)return isNaN(value.getTime())?'Invalid Date':value.toISOString();
 if(value instanceof RegExp)return value.toString();
 if(value instanceof Buffer){const hex=Array.from(value.subarray(0,50),b=>b.toString(16).padStart(2,'0')).join(' ');return`<Buffer ${hex}${value.length>50?` ... ${value.length-50} more bytes`:''}>`;}
 if(level>depth)return Array.isArray(value)?'[Array]':'[Object]';
 seen.add(value);
 try{
  const wrap=(open:string,items:string[],close:string)=>{if(!items.length)return open+close;const one=`${open} ${items.join(', ')} ${close}`;return one.length<=72&&!one.includes('\n')?one:`${open}\n${items.map(i=>'  '.repeat(level+1)+i).join(',\n')}\n${'  '.repeat(level)}${close}`;};
  if(Array.isArray(value)){const items=value.slice(0,100).map(v=>inspect(v,options,seen,level+1));if(value.length>100)items.push(`... ${value.length-100} more items`);return wrap('[',items,']');}
  if(ArrayBuffer.isView(value)&&!(value instanceof DataView)){const arr=Array.from(value as unknown as ArrayLike<number>).slice(0,100);return`${value.constructor.name}(${(value as unknown as {length:number}).length}) `+wrap('[',arr.map(String),']');}
  if(value instanceof Map)return`Map(${value.size}) `+wrap('{',[...value].map(([k,v])=>`${inspect(k,options,seen,level+1)} => ${inspect(v,options,seen,level+1)}`),'}');
  if(value instanceof Set)return`Set(${value.size}) `+wrap('{',[...value].map(v=>inspect(v,options,seen,level+1)),'}');
  if(value instanceof Promise)return'Promise { <pending> }';
  const name=value.constructor&&value.constructor!==Object&&value.constructor.name?value.constructor.name+' ':Object.getPrototypeOf(value)===null?'[Object: null prototype] ':'';
  const items=Object.keys(value).map(k=>`${/^[A-Za-z_$][\w$]*$/.test(k)?k:`'${k}'`}: ${inspect(value[k],options,seen,level+1)}`);
  return name+wrap('{',items,'}');
 }finally{seen.delete(value);}
}
export function format(...args:any[]):string{
 if(typeof args[0]!=='string')return args.map(a=>inspect(a)).join(' ');
 let i=1;const first=args[0].replace(/%[sdifjoOc%]/g,(m:string)=>{if(m==='%%')return'%';if(i>=args.length)return m;const a=args[i++];
  switch(m){case'%s':return typeof a==='string'?a:typeof a==='object'&&a!==null?inspect(a,{depth:1},new Set(),1):String(a);case'%d':case'%i':return typeof a==='object'?'NaN':String(m==='%i'?parseInt(a):Number(a));case'%f':return String(parseFloat(a));case'%j':try{return JSON.stringify(a);}catch{return'[Circular]';}case'%c':return'';default:return inspect(a,{},new Set(),1);}});
 return[first,...args.slice(i).map(a=>typeof a==='string'?a:inspect(a))].join(' ');
}
// ---------- events
export class EventEmitter{
 private listeners_=new Map<string|symbol,((...args:any[])=>void)[]>();
 on(event:string|symbol,listener:(...args:any[])=>void){(this.listeners_.get(event)??this.listeners_.set(event,[]).get(event)!).push(listener);return this;}
 addListener(event:string|symbol,listener:(...args:any[])=>void){return this.on(event,listener);}
 prependListener(event:string|symbol,listener:(...args:any[])=>void){(this.listeners_.get(event)??this.listeners_.set(event,[]).get(event)!).unshift(listener);return this;}
 once(event:string|symbol,listener:(...args:any[])=>void){const wrapper=(...args:any[])=>{this.off(event,wrapper);listener(...args);};(wrapper as any).listener=listener;return this.on(event,wrapper);}
 off(event:string|symbol,listener:(...args:any[])=>void){const list=this.listeners_.get(event);if(list){const i=list.findIndex(l=>l===listener||(l as any).listener===listener);if(i>=0)list.splice(i,1);}return this;}
 removeListener(event:string|symbol,listener:(...args:any[])=>void){return this.off(event,listener);}
 removeAllListeners(event?:string|symbol){if(event===undefined)this.listeners_.clear();else this.listeners_.delete(event);return this;}
 emit(event:string|symbol,...args:any[]){const list=this.listeners_.get(event);if(!list?.length){if(event==='error')throw args[0];return false;}for(const l of[...list])l.apply(this,args);return true;}
 listenerCount(event:string|symbol){return this.listeners_.get(event)?.length??0;}
 listeners(event:string|symbol){return[...(this.listeners_.get(event)??[])];}
 setMaxListeners(){return this;}getMaxListeners(){return 10;}
 eventNames(){return[...this.listeners_.keys()];}
}
// ---------- the runtime for one node process
const CORE_UNAVAILABLE=new Set(['http','https','net','dns','tls','dgram','cluster','http2','worker_threads','inspector','repl','v8','sqlite','vm']);
/** One `node` process: its module cache, process object, timers it waits for, stdin, and exit code. */
class NodeProcess{
 cache=new Map<string,Module>();timers=new Set<any>();pending=0;exitCode:number|undefined;exited=false;error:unknown;stdin:Uint8Array;cwd:string;
 private wake:(()=>void)|undefined;private exitListeners:((code:number)=>void)[]=[];
 process:any;console:any;builtins=new Map<string,any>();
 constructor(public ctx:CommandContext,public argv:string[],stdin:Uint8Array){this.stdin=stdin;this.cwd=ctx.cwd;this.process=this.makeProcess();this.console=this.makeConsole();}
 private write(stream:'stdout'|'stderr',data:unknown){const out=stream==='stdout'?this.ctx.stdout:this.ctx.stderr;const bytes=typeof data==='string'?data:data instanceof Uint8Array?data.slice():String(data);void out.write(bytes).catch(()=>{});return true;}
 notify(){const w=this.wake;this.wake=undefined;w?.();}
 idle(){return new Promise<void>(resolve=>{this.wake=resolve;});}
 fail(error:unknown){if(error instanceof Exit){this.exit(error.code);return;}if(!this.exited){this.error=error;this.exit(1,true);}}
 exit(code:number,crashed=false){if(this.exited)return;this.exited=true;this.exitCode=code;for(const t of this.timers)clearTimeout(t);this.timers.clear();if(!crashed)for(const l of this.exitListeners)try{l(code);}catch{}this.notify();}
 /** Timers the script starts keep the process alive, as in Node; a throw inside one ends it like an uncaught exception. */
 timer(kind:'timeout'|'interval'|'immediate',fn:any,ms=0,args:any[]=[]){
  if(typeof fn!=='function')throw new TypeError('The "callback" argument must be of type function');
  const run=()=>{if(this.exited)return;if(kind!=='interval')this.timers.delete(handle);try{fn(...args);}catch(error){this.fail(error);}this.notify();};
  const handle:any=kind==='interval'?setInterval(run,Math.max(1,ms)):setTimeout(run,kind==='immediate'?0:Math.max(0,ms));
  this.timers.add(handle);
  const wrapped={ref:()=>{this.timers.add(handle);return wrapped;},unref:()=>{this.timers.delete(handle);this.notify();return wrapped;},hasRef:()=>this.timers.has(handle),refresh:()=>wrapped,[Symbol.toPrimitive]:()=>handle,_handle:handle};
  return wrapped;
 }
 clear(t:any){const handle=t?._handle??t;clearTimeout(handle);clearInterval(handle);this.timers.delete(handle);this.notify();}
 /** Async work the script waits on without a timer (fetch, child_process.exec, fs.promises): counted until it settles. */
 track<T>(promise:Promise<T>):Promise<T>{this.pending++;return promise.finally(()=>{this.pending--;this.notify();});}
 private makeProcess(){
  const self=this,stdout=Object.assign(new EventEmitter(),{write:(d:unknown,_e?:unknown,cb?:()=>void)=>{self.write('stdout',d);if(typeof _e==='function')(_e as ()=>void)();cb?.();return true;},isTTY:false,columns:80,rows:24,fd:1,end:()=>{},on(){return this;},once(){return this;}});
  const stderr=Object.assign(new EventEmitter(),{write:(d:unknown,_e?:unknown,cb?:()=>void)=>{self.write('stderr',d);if(typeof _e==='function')(_e as ()=>void)();cb?.();return true;},isTTY:false,columns:80,fd:2,end:()=>{}});
  const stdin=this.makeStdin();
  const proc:any=Object.assign(new EventEmitter(),{
   argv:this.argv,argv0:'node',execArgv:[],execPath:'/usr/bin/node',env:{...this.ctx.env},platform:'linux',arch:'wasm32',pid:1,ppid:0,version:NODE_VERSION,versions:{node:NODE_VERSION.slice(1),v8:'12.4',modules:'127',sandbox:'browser'},release:{name:'node'},title:'node',
   stdout,stderr,stdin,exitCode:undefined,
   cwd:()=>self.cwd,chdir:(dir:string)=>{const path=posix.resolve(self.cwd,dir);if(tryStat(self.ctx.fs,path)?.type!=='directory')throw nodeError('ENOENT','chdir',dir);self.cwd=path;},
   exit:(code?:number)=>{throw new Exit(code??proc.exitCode??0);},
   abort:()=>{throw new Exit(134);},
   nextTick:(fn:(...a:any[])=>void,...args:any[])=>queueMicrotask(()=>{try{fn(...args);}catch(e){self.fail(e);}}),
   hrtime:Object.assign((prev?:[number,number])=>{const t=performance.now(),s=Math.floor(t/1000),ns=Math.floor((t%1000)*1e6);if(!prev)return[s,ns];let ds=s-prev[0],dn=ns-prev[1];if(dn<0){ds--;dn+=1e9;}return[ds,dn];},{bigint:()=>BigInt(Math.floor(performance.now()*1e6))}),
   uptime:()=>performance.now()/1000,memoryUsage:Object.assign(()=>({rss:0,heapTotal:0,heapUsed:0,external:0,arrayBuffers:0}),{rss:()=>0}),cpuUsage:()=>({user:0,system:0}),
   emitWarning:(w:unknown)=>self.write('stderr',`(node) Warning: ${w}\n`),umask:()=>0o22,getuid:()=>1000,getgid:()=>1000,kill:()=>true,binding:()=>{throw new Error('process.binding is not available');},
   on(event:string,listener:(...a:any[])=>void){if(event==='exit')self.exitListeners.push(listener);else EventEmitter.prototype.on.call(this,event,listener);return this;},
  });
  proc.once=proc.on;return proc;
 }
 private makeStdin(){
  const self=this,em:any=new EventEmitter();let flowing=false,encoding:string|undefined;
  const start=()=>{if(flowing)return;flowing=true;self.track(new Promise<void>(resolve=>setTimeout(()=>{if(self.stdin.length)em.emit('data',encoding?decodeAs(self.stdin,encoding):Buffer.fromBytes(self.stdin));em.emit('end');em.emit('close');resolve();},0)));};
  em.fd=0;em.isTTY=false;em.setEncoding=(e:string)=>{encoding=e;return em;};em.resume=()=>{start();return em;};em.pause=()=>em;em.setRawMode=()=>em;em.unref=()=>em;em.ref=()=>em;
  const on=em.on.bind(em);em.on=(event:string,listener:any)=>{on(event,listener);if(event==='data'||event==='end'||event==='readable')start();return em;};em.addListener=em.on;
  em.read=()=>null;
  em[Symbol.asyncIterator]=async function*(){if(self.stdin.length)yield Buffer.fromBytes(self.stdin);};
  return em;
 }
 private makeConsole(){
  const counts=new Map<string,number>(),times=new Map<string,number>();let indent='';
  const log=(stream:'stdout'|'stderr')=>(...args:any[])=>{const text=format(...args);this.write(stream,(indent?text.split('\n').map(l=>indent+l).join('\n'):text)+'\n');};
  return{log:log('stdout'),info:log('stdout'),debug:log('stdout'),error:log('stderr'),warn:log('stderr'),trace:(...a:any[])=>log('stderr')('Trace:',...a),
   dir:(v:any,o?:{depth?:number})=>this.write('stdout',inspect(v,o??{},new Set(),1)+'\n'),table:(v:any)=>log('stdout')(v),assert:(c:any,...a:any[])=>{if(!c)log('stderr')('Assertion failed'+(a.length?': '+format(...a):''));},
   count:(l='default')=>{const n=(counts.get(l)??0)+1;counts.set(l,n);log('stdout')(`${l}: ${n}`);},countReset:(l='default')=>counts.delete(l),
   time:(l='default')=>times.set(l,performance.now()),timeEnd:(l='default')=>{const t=times.get(l);if(t!==undefined){log('stdout')(`${l}: ${(performance.now()-t).toFixed(3)}ms`);times.delete(l);}},timeLog:(l='default',...a:any[])=>{const t=times.get(l);if(t!==undefined)log('stdout')(`${l}: ${(performance.now()-t).toFixed(3)}ms`,...a);},
   group:(...a:any[])=>{if(a.length)log('stdout')(...a);indent+='  ';},groupEnd:()=>{indent=indent.slice(2);},groupCollapsed:(...a:any[])=>{if(a.length)log('stdout')(...a);indent+='  ';}};
 }
 // ---------- modules
 resolveOptions:ResolveOptions={extensions:['.js','.json','.cjs','.mjs','.ts','.tsx','.mts','.cts','.jsx','.node'],conditions:['node','require'],fallbackConditions:['node','import','module'],mainFields:['main','module']};
 requireFrom(dir:string,parent:Module|null){
  const require:any=(id:string)=>this.load(id,dir,parent);
  require.resolve=(id:string)=>{const r=resolveModule(this.ctx.fs,dir,id,this.resolveOptions);if(!r)throw Object.assign(new Error(`Cannot find module '${id}'`),{code:'MODULE_NOT_FOUND'});return'builtin' in r?r.builtin:r.path;};
  require.cache=Object.fromEntries(this.cache);require.main=this.main;return require;
 }
 main:Module|undefined;
 load(id:string,dir:string,parent:Module|null):any{
  const found=resolveModule(this.ctx.fs,dir,id,this.resolveOptions);
  if(!found)throw Object.assign(new Error(`Cannot find module '${id}'\nRequire stack:\n- ${parent?.filename??'[eval]'}`+(/^[@\w]/.test(id)?`\n(npm is not available in the browser sandbox: bring the package's files into node_modules in the workspace)`:'')),{code:'MODULE_NOT_FOUND'});
  if('builtin' in found)return this.builtin(found.builtin);
  const cached=this.cache.get(found.path);if(cached)return cached.exports;
  const module:Module={id:found.path,filename:found.path,loaded:false,exports:{},children:[],paths:[],parent};
  this.cache.set(found.path,module);parent?.children.push(module);
  try{this.evaluate(module,this.compiled.get(found.path)??decode(this.ctx.fs.readFile(found.path)));}catch(error){this.cache.delete(found.path);throw error;}
  return module.exports;
 }
 /** Source already turned into CommonJS (TypeScript, ES modules), by path; filled in before running, as require is sync. */
 compiled=new Map<string,string>();
 evaluate(module:Module,source:string):any{
  if(module.filename.endsWith('.json')){module.exports=JSON.parse(source);module.loaded=true;return;}
  const require=this.requireFrom(posix.dirname(module.filename),module);module.require=require;
  const code=source.startsWith('#!')?'//'+source:source;
  const self=this;
  const scope={setTimeout:(f:any,ms?:number,...a:any[])=>self.timer('timeout',f,ms,a),setInterval:(f:any,ms?:number,...a:any[])=>self.timer('interval',f,ms,a),setImmediate:(f:any,...a:any[])=>self.timer('immediate',f,0,a),
   clearTimeout:(t:any)=>self.clear(t),clearInterval:(t:any)=>self.clear(t),clearImmediate:(t:any)=>self.clear(t),fetch:(...a:Parameters<typeof fetch>)=>self.track((self.ctx.host.fetch??fetch)(...a))};
  const names=['exports','require','module','__filename','__dirname','process','Buffer','console','global','setTimeout','setInterval','setImmediate','clearTimeout','clearInterval','clearImmediate','fetch'];
  const fn=new Function(...names,code+`\n//# sourceURL=${module.filename}`);
  const result=fn.call(module.exports,module.exports,require,module,module.filename,posix.dirname(module.filename),this.process,Buffer,this.console,this.global(),scope.setTimeout,scope.setInterval,scope.setImmediate,scope.clearTimeout,scope.clearInterval,scope.clearImmediate,scope.fetch);
  module.loaded=true;return result;
 }
 private globalObject:any;
 global(){return this.globalObject??=new Proxy(globalThis as any,{get:(t,k)=>k==='process'?this.process:k==='Buffer'?Buffer:k==='console'?this.console:k==='global'||k==='globalThis'?this.globalObject:t[k],set:(t,k,v)=>{t[k]=v;return true;}});}
 /** Every module the program can reach, compiled ahead when it needs esbuild (require itself stays synchronous). */
 async precompile(entry:string){
  const seen=new Set<string>(),queue=[entry];
  while(queue.length){
   const path=queue.pop()!;if(seen.has(path))continue;seen.add(path);
   let source:string;try{source=decode(this.ctx.fs.readFile(path));}catch{continue;}
   if(path.endsWith('.json'))continue;
   if(needsCompile(path,source,this.ctx.fs))this.compiled.set(path,await compile(this.ctx,source,path));
   for(const m of(this.compiled.get(path)??source).matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)){const r=resolveModule(this.ctx.fs,posix.dirname(path),m[1],this.resolveOptions);if(r&&'path' in r)queue.push(r.path);}
  }
 }
 builtin(name:string):any{
  const cached=this.builtins.get(name);if(cached)return cached;
  const mod=makeBuiltin(this,name);this.builtins.set(name,mod);return mod;
 }
}
function needsCompile(path:string,source:string,fs:SandboxFS){
 if(/\.(ts|tsx|mts|cts|jsx)$/.test(path)||path.endsWith('.mjs'))return true;
 if(path.endsWith('.cjs'))return false;
 if(/\bimport\.meta\b/.test(source)||/(^|\n)\s*(import\s+[\w{*'"]|export\s)/.test(source))return true;
 // "type": "module" in the nearest package.json
 for(let dir=posix.dirname(path);;dir=posix.dirname(dir)){const pkg=tryStat(fs,posix.join(dir,'package.json'));if(pkg){try{return JSON.parse(decode(fs.readFile(posix.join(dir,'package.json')))).type==='module';}catch{return false;}}if(posix.dirname(dir)===dir)return false;}
}
async function compile(ctx:CommandContext,source:string,path:string){
 try{return await toCommonJS(ctx.host,source,path);}
 catch(error){
  const message=await formatError(ctx.host,error);
  if(!/Top-level await/i.test(message))throw new CommandError(`${path}: could not compile\n${message}`,1);
  // CommonJS cannot hold top-level await: keep the module's imports as requires and run its body as an async function.
  const esm=await stripToESM(ctx.host,source,path);
  return'return (async () => {\n'+esmToRequires(esm)+'\n})();';
 }
}
/** esbuild's ES module output, one import per statement, as CommonJS requires (for modules with top-level await). */
export function esmToRequires(code:string){
 let n=0;const named=(list:string)=>list.split(',').map(s=>s.trim()).filter(Boolean).map(s=>{const [a,b]=s.split(/\s+as\s+/);return b?`${a==='default'?'default':a}: ${b}`:a;}).join(', ');
 return code
  .replace(/^import\s+([\w$]+)\s*,\s*\{([^}]*)\}\s*from\s*(["'][^"']+["']);?$/gm,(_,d,list,m)=>{const v=`__m${n++}`;return`const ${v} = require(${m}); const ${d} = ${v}.__esModule ? ${v}.default : ${v}; const { ${named(list)} } = ${v};`;})
  .replace(/^import\s+\*\s+as\s+([\w$]+)\s+from\s*(["'][^"']+["']);?$/gm,'const $1 = require($2);')
  .replace(/^import\s*\{([^}]*)\}\s*from\s*(["'][^"']+["']);?$/gm,(_,list,m)=>`const { ${named(list)} } = require(${m});`)
  .replace(/^import\s+([\w$]+)\s+from\s*(["'][^"']+["']);?$/gm,(_,d,m)=>{const v=`__m${n++}`;return`const ${v} = require(${m}); const ${d} = ${v} && ${v}.__esModule ? ${v}.default : ${v};`;})
  .replace(/^import\s*(["'][^"']+["']);?$/gm,'require($1);')
  .replace(/^export\s+default\s+/gm,'module.exports.default = ')
  .replace(/^export\s+(?=(const|let|var|function|class|async)\b)/gm,'')
  .replace(/^export\s*\{[^}]*\}(\s*from\s*["'][^"']+["'])?;?$/gm,'')
  .replace(/\bimport\.meta\.url\b/g,'require("url").pathToFileURL(__filename).href').replace(/\bimport\.meta\.dirname\b/g,'__dirname').replace(/\bimport\.meta\.filename\b/g,'__filename');
}
function nodeError(code:string,syscall:string,path:string,message?:string){
 const text={ENOENT:'no such file or directory',EEXIST:'file already exists',ENOTDIR:'not a directory',EISDIR:'illegal operation on a directory',ENOTEMPTY:'directory not empty',EBADF:'bad file descriptor',EINVAL:'invalid argument',EPERM:'operation not permitted'}[code]??message??code;
 return Object.assign(new Error(`${code}: ${text}, ${syscall} '${path}'`),{code,errno:-2,syscall,path});
}
// ---------- fs
class Stats{
 constructor(private s:FileStat){}
 get size(){return this.s.size;}get mode(){return(this.s.type==='directory'?0o040000:this.s.type==='symlink'?0o120000:0o100000)|(this.s.mode||0o644);}
 get mtimeMs(){return this.s.mtimeMs;}get atimeMs(){return this.s.mtimeMs;}get ctimeMs(){return this.s.mtimeMs;}get birthtimeMs(){return this.s.mtimeMs;}
 get mtime(){return new Date(this.s.mtimeMs);}get atime(){return this.mtime;}get ctime(){return this.mtime;}get birthtime(){return this.mtime;}
 dev=1;ino=0;nlink=1;uid=1000;gid=1000;rdev=0;blksize=4096;get blocks(){return Math.ceil(this.s.size/512);}
 isFile(){return this.s.type==='file';}isDirectory(){return this.s.type==='directory';}isSymbolicLink(){return this.s.type==='symlink';}
 isFIFO(){return false;}isSocket(){return false;}isBlockDevice(){return false;}isCharacterDevice(){return false;}
}
class Dirent{constructor(public name:string,private type:FileStat['type'],public parentPath:string){}get path(){return this.parentPath;}isFile(){return this.type==='file';}isDirectory(){return this.type==='directory';}isSymbolicLink(){return this.type==='symlink';}isFIFO(){return false;}isSocket(){return false;}isBlockDevice(){return false;}isCharacterDevice(){return false;}}
function makeFs(p:NodeProcess){
 const fs=p.ctx.fs,abs=(path:any)=>{if(path instanceof URL)path=decodeURIComponent(path.pathname);if(path instanceof Uint8Array)path=decode(path);return posix.resolve(p.cwd,String(path));};
 const wrap=<T>(syscall:string,path:any,f:()=>T):T=>{try{return f();}catch(error){const code=(error as {code?:string}).code;if(code)throw nodeError(code,syscall,String(path));throw error;}};
 const enc=(o:any)=>typeof o==='string'?o:o?.encoding;
 const fds=new Map<number,{handle:ReturnType<SandboxFS['open']>;position:number;append:boolean;path:string}>();let nextFd=10;
 const toBytes=(data:any,encoding?:string)=>typeof data==='string'?encode(data,encoding??'utf8'):data instanceof Uint8Array?data:ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):encoder.encode(String(data));
 const sync={
  existsSync:(path:any)=>{try{return!!tryStat(fs,abs(path));}catch{return false;}},
  readFileSync:(path:any,options?:any)=>{
   const e=enc(options);let bytes:Uint8Array;
   if(path===0||path==='/dev/stdin')bytes=p.stdin;else bytes=wrap('open',path,()=>{const full=abs(path);if(tryStat(fs,full)?.type==='directory')throw Object.assign(new Error(),{code:'EISDIR'});return fs.readFile(full);});
   return e?decodeAs(bytes,e):Buffer.fromBytes(bytes);
  },
  writeFileSync:(path:any,data:any,options?:any)=>{if(path===1||path===2){p.process[path===1?'stdout':'stderr'].write(data);return;}const full=abs(path);wrap('open',path,()=>{if(options?.flag==='a'){fs.appendFile(full,toBytes(data,enc(options)));return;}if(options?.flag==='wx'&&tryStat(fs,full))throw Object.assign(new Error(),{code:'EEXIST'});fs.writeFile(full,toBytes(data,enc(options)));});},
  appendFileSync:(path:any,data:any,options?:any)=>wrap('open',path,()=>fs.appendFile(abs(path),toBytes(data,enc(options)))),
  statSync:(path:any,options?:any)=>{try{return new Stats(fs.stat(abs(path)));}catch(error){if(options?.throwIfNoEntry===false)return undefined;throw nodeError((error as {code?:string}).code??'ENOENT','stat',String(path));}},
  lstatSync:(path:any,options?:any)=>{try{return new Stats(fs.lstat?fs.lstat(abs(path)):fs.stat(abs(path)));}catch(error){if(options?.throwIfNoEntry===false)return undefined;throw nodeError((error as {code?:string}).code??'ENOENT','lstat',String(path));}},
  readdirSync:(path:any,options?:any)=>{
   const full=abs(path),names=wrap('scandir',path,()=>fs.readdir(full));
   const list=(dir:string,prefix:string):any[]=>fs.readdir(dir).flatMap(name=>{const s=fs.lstat?fs.lstat(posix.join(dir,name)):fs.stat(posix.join(dir,name));const item=options?.withFileTypes?new Dirent(name,s.type,dir):prefix+name;return s.type==='directory'?[item,...list(posix.join(dir,name),prefix+name+'/')]:[item];});
   if(options?.recursive)return list(full,'');
   return options?.withFileTypes?names.map(name=>{const s=fs.lstat?fs.lstat(posix.join(full,name)):fs.stat(posix.join(full,name));return new Dirent(name,s.type,full);}):names;
  },
  mkdirSync:(path:any,options?:any)=>{const full=abs(path),recursive=typeof options==='object'&&options?.recursive;const existed=!!tryStat(fs,full);wrap('mkdir',path,()=>recursive?mkdirp(fs,full):fs.mkdir(full,false));return recursive&&!existed?full:undefined;},
  mkdtempSync:(prefix:string)=>{const path=abs(prefix+Math.random().toString(36).slice(2,8));fs.mkdir(path,true);return path;},
  rmSync:(path:any,options?:any)=>{const full=abs(path);if(!tryStat(fs,full)){if(options?.force)return;throw nodeError('ENOENT','rm',String(path));}const s=fs.stat(full);if(s.type==='directory'&&!options?.recursive)throw nodeError('EISDIR','rm',String(path));wrap('rm',path,()=>removeTree(fs,full));},
  rmdirSync:(path:any,options?:any)=>wrap('rmdir',path,()=>options?.recursive?removeTree(fs,abs(path)):fs.rmdir(abs(path))),
  unlinkSync:(path:any)=>wrap('unlink',path,()=>fs.unlink(abs(path))),
  renameSync:(from:any,to:any)=>wrap('rename',from,()=>fs.rename(abs(from),abs(to))),
  copyFileSync:(from:any,to:any)=>wrap('copyfile',from,()=>copyTree(fs,abs(from),abs(to))),
  cpSync:(from:any,to:any)=>wrap('cp',from,()=>copyTree(fs,abs(from),abs(to))),
  realpathSync:Object.assign((path:any)=>{const full=abs(path);wrap('realpath',path,()=>fs.stat(full));return full;},{native:(path:any)=>abs(path)}),
  accessSync:(path:any)=>{wrap('access',path,()=>fs.stat(abs(path)));},
  chmodSync:(path:any,mode:number|string)=>wrap('chmod',path,()=>fs.chmod?.(abs(path),typeof mode==='string'?parseInt(mode,8):mode)),
  utimesSync:(path:any,_atime:any,mtime:any)=>wrap('utime',path,()=>fs.utimes?.(abs(path),mtime instanceof Date?mtime.getTime():Number(mtime)*1000)),
  readlinkSync:(path:any)=>wrap('readlink',path,()=>{if(!fs.readlink)throw Object.assign(new Error(),{code:'EINVAL'});return fs.readlink(abs(path));}),
  symlinkSync:(target:string,path:any)=>wrap('symlink',path,()=>{if(!fs.symlink)throw Object.assign(new Error(),{code:'EPERM'});fs.symlink(target,abs(path));}),
  truncateSync:(path:any,length=0)=>wrap('open',path,()=>{const h=fs.open(abs(path),'r+');try{h.truncate(length);}finally{h.close();}}),
  openSync:(path:any,flags:any='r')=>{const f=typeof flags==='string'?flags.replace(/[sx]/g,''):'r';const full=abs(path),handle=wrap('open',path,()=>{if(String(flags).includes('x')&&tryStat(fs,full))throw Object.assign(new Error(),{code:'EEXIST'});return fs.open(full,(['r','r+','w','w+','a','a+'].includes(f)?f:'r') as 'r');});const fd=nextFd++;fds.set(fd,{handle,position:f.startsWith('a')?handle.size():0,append:f.startsWith('a'),path:full});return fd;},
  closeSync:(fd:number)=>{const f=fds.get(fd);if(!f)throw nodeError('EBADF','close',String(fd));f.handle.close();fds.delete(fd);},
  readSync:(fd:number,buffer:Uint8Array,offsetOrOptions:any=0,length?:number,position?:number|null)=>{
   const f=fds.get(fd);if(!f)throw nodeError('EBADF','read',String(fd));const o=typeof offsetOrOptions==='object'?offsetOrOptions:{offset:offsetOrOptions,length,position};
   const offset=o.offset??0,len=o.length??buffer.length-offset,at=o.position??f.position;const n=f.handle.read(buffer.subarray(offset,offset+len),at);if(o.position==null)f.position+=n;return n;
  },
  writeSync:(fd:number,data:any,offsetOrPosition?:any,lengthOrEncoding?:any,position?:number|null)=>{
   if(fd===1||fd===2){p.process[fd===1?'stdout':'stderr'].write(data);return typeof data==='string'?encoder.encode(data).length:data.length;}
   const f=fds.get(fd);if(!f)throw nodeError('EBADF','write',String(fd));
   let bytes:Uint8Array,at:number|null|undefined;
   if(typeof data==='string'){bytes=encode(data,typeof lengthOrEncoding==='string'?lengthOrEncoding:'utf8');at=offsetOrPosition;}else{const offset=offsetOrPosition??0;bytes=toBytes(data).subarray(offset,offset+(lengthOrEncoding??data.length-offset));at=position;}
   const n=f.handle.write(bytes,f.append?f.handle.size():at??f.position);if(at==null)f.position+=n;return n;
  },
  fstatSync:(fd:number)=>{const f=fds.get(fd);if(!f)throw nodeError('EBADF','fstat',String(fd));return new Stats(fs.stat(f.path));},
  fsyncSync:()=>{},
 };
 // Callback and promise forms run the sync ones, as the file system underneath is synchronous anyway.
 const callbacks:any={},promises:any={};
 for(const [name,f] of Object.entries(sync)){
  const base=name.replace(/Sync$/,'');if(base===name)continue;
  callbacks[base]=(...args:any[])=>{const cb=typeof args[args.length-1]==='function'?args.pop():undefined;let result:any,error:any=null;try{result=(f as any)(...args);}catch(e){error=e;}if(base==='exists'){p.timer('immediate',()=>cb?.(result));return;}p.timer('immediate',()=>cb?.(error,result));};
  promises[base]=(...args:any[])=>p.track(new Promise((resolve,reject)=>{try{resolve((f as any)(...args));}catch(e){reject(e);}}));
 }
 delete promises.exists;
 promises.open=async(path:any,flags?:any)=>{const fd=sync.openSync(path,flags);return{fd,read:(b:Uint8Array,o?:number,l?:number,pos?:number)=>({bytesRead:sync.readSync(fd,b,o,l,pos),buffer:b}),write:(d:any,...r:any[])=>({bytesWritten:(sync.writeSync as any)(fd,d,...r)}),writeFile:(d:any)=>{sync.writeSync(fd,d);},readFile:(o?:any)=>sync.readFileSync(fds.get(fd)!.path,o),stat:()=>sync.fstatSync(fd),close:async()=>sync.closeSync(fd),[Symbol.asyncDispose]:async()=>sync.closeSync(fd)};};
 promises.constants=callbacks.constants={F_OK:0,R_OK:4,W_OK:2,X_OK:1,O_RDONLY:0,O_WRONLY:1,O_RDWR:2,O_CREAT:64,O_EXCL:128,O_TRUNC:512,O_APPEND:1024,COPYFILE_EXCL:1};
 const createWriteStream=(path:any,options?:any)=>{
  const flags=typeof options==='object'?options?.flags??'w':'w',fd=sync.openSync(path,flags),em:any=new EventEmitter();let closed=false;
  em.write=(chunk:any,encoding?:any,cb?:any)=>{if(typeof encoding==='function'){cb=encoding;encoding=undefined;}sync.writeSync(fd,typeof chunk==='string'?encode(chunk,encoding??'utf8'):chunk);if(cb)p.timer('immediate',cb);return true;};
  em.end=(chunk?:any,encoding?:any,cb?:any)=>{if(typeof chunk==='function'){cb=chunk;chunk=undefined;}if(chunk!==undefined&&chunk!==null)em.write(chunk,typeof encoding==='string'?encoding:undefined);if(!closed){closed=true;sync.closeSync(fd);p.timer('immediate',()=>{em.emit('finish');em.emit('close');cb?.();});}return em;};
  em.close=(cb?:any)=>em.end(cb);em.path=String(path);em.bytesWritten=0;em.writable=true;em.destroy=()=>{if(!closed){closed=true;sync.closeSync(fd);}return em;};
  return em;
 };
 const createReadStream=(path:any,options?:any)=>{
  const em:any=new EventEmitter();const encoding=enc(options);let started=false;
  const start=()=>{if(started)return;started=true;p.timer('immediate',()=>{try{const data=sync.readFileSync(path) as Buffer;const start=options?.start??0,end=options?.end!==undefined?options.end+1:data.length,slice=data.subarray(start,end);const size=options?.highWaterMark??65536;for(let i=0;i<slice.length;i+=size){const part=slice.subarray(i,i+size);em.emit('data',encoding?decodeAs(part,encoding):part);}em.emit('end');em.emit('close');}catch(e){em.emit('error',e);}});};
  const on=em.on.bind(em);em.on=(e:string,l:any)=>{on(e,l);if(e==='data'||e==='end')start();return em;};
  em.pipe=(dest:any)=>{em.on('data',(d:any)=>dest.write(d));em.on('end',()=>dest.end?.());return dest;};em.setEncoding=()=>em;em.resume=()=>{start();return em;};em.destroy=()=>em;
  em[Symbol.asyncIterator]=async function*(){const data=sync.readFileSync(path) as Buffer;yield encoding?decodeAs(data,encoding):data;};
  return em;
 };
 return{...sync,...callbacks,promises,createWriteStream,createReadStream,Stats,Dirent,watch:()=>{throw new Error('fs.watch is not available in the browser sandbox');}};
}
// ---------- the built-in modules
function makeBuiltin(p:NodeProcess,name:string):any{
 if(CORE_UNAVAILABLE.has(name))throw Object.assign(new Error(`The "${name}" module is not available in the browser sandbox`+(name==='http'||name==='https'?'; use fetch()':'')),{code:'ERR_UNAVAILABLE'});
 switch(name){
  case'fs':return makeFs(p);
  case'fs/promises':return p.builtin('fs').promises;
  case'path':case'path/posix':{const path:any={...posix,sep:'/',delimiter:':',resolve:(...parts:string[])=>parts.reduce((acc,part)=>posix.resolve(acc,part),p.cwd),parse:(s:string)=>{const base=posix.basename(s),ext=posix.extname(s),dir=s.includes('/')?posix.dirname(s):'';return{root:s.startsWith('/')?'/':'',dir,base,ext,name:ext?base.slice(0,-ext.length):base};},format:(o:{dir?:string;root?:string;base?:string;name?:string;ext?:string})=>{const base=o.base??(o.name??'')+(o.ext??'');const dir=o.dir??o.root??'';return dir?(dir.endsWith('/')?dir+base:dir+'/'+base):base;},toNamespacedPath:(s:string)=>s,matchesGlob:()=>false};path.posix=path;path.win32=path;return path;}
  case'os':return{EOL:'\n',platform:()=>'linux',type:()=>'Linux',arch:()=>'wasm32',release:()=>'6.0.0-browser',hostname:()=>'sandbox',homedir:()=>p.ctx.env.HOME??'/',tmpdir:()=>p.ctx.env.TMPDIR??'/tmp',cpus:()=>Array.from({length:(globalThis.navigator as {hardwareConcurrency?:number}|undefined)?.hardwareConcurrency??4},()=>({model:'wasm',speed:0,times:{user:0,nice:0,sys:0,idle:0,irq:0}})),availableParallelism:()=>(globalThis.navigator as {hardwareConcurrency?:number}|undefined)?.hardwareConcurrency??4,totalmem:()=>4*1024**3,freemem:()=>2*1024**3,uptime:()=>performance.now()/1000,userInfo:()=>({username:'user',uid:1000,gid:1000,shell:'/bin/sh',homedir:p.ctx.env.HOME??'/'}),endianness:()=>'LE',loadavg:()=>[0,0,0],networkInterfaces:()=>({}),constants:{signals:{}}};
  case'util':case'util/types':{
   const types={isPromise:(v:unknown)=>v instanceof Promise,isDate:(v:unknown)=>v instanceof Date,isRegExp:(v:unknown)=>v instanceof RegExp,isUint8Array:(v:unknown)=>v instanceof Uint8Array,isTypedArray:(v:unknown)=>ArrayBuffer.isView(v)&&!(v instanceof DataView),isArrayBuffer:(v:unknown)=>v instanceof ArrayBuffer,isMap:(v:unknown)=>v instanceof Map,isSet:(v:unknown)=>v instanceof Set,isNativeError:(v:unknown)=>v instanceof Error,isAsyncFunction:(v:unknown)=>typeof v==='function'&&v.constructor?.name==='AsyncFunction'};
   if(name==='util/types')return types;
   return{format,inspect:Object.assign(inspect,{custom:Symbol.for('nodejs.util.inspect.custom')}),types,TextEncoder,TextDecoder,isDeepStrictEqual:(a:unknown,b:unknown)=>deepEqual(a,b),
    promisify:(f:any)=>{if(f?.[Symbol.for('nodejs.util.promisify.custom')])return f[Symbol.for('nodejs.util.promisify.custom')];return(...args:any[])=>p.track(new Promise((resolve,reject)=>f(...args,(e:any,...r:any[])=>e?reject(e):resolve(r.length>1?r:r[0]))));},
    callbackify:(f:any)=>(...args:any[])=>{const cb=args.pop();f(...args).then((r:any)=>cb(null,r),(e:any)=>cb(e));},
    inherits:(ctor:any,superCtor:any)=>{Object.setPrototypeOf(ctor.prototype,superCtor.prototype);Object.setPrototypeOf(ctor,superCtor);ctor.super_=superCtor;},
    deprecate:(f:any)=>f,debuglog:()=>()=>{},isArray:Array.isArray,isString:(v:unknown)=>typeof v==='string',isNumber:(v:unknown)=>typeof v==='number',isObject:(v:unknown)=>v!==null&&typeof v==='object',isFunction:(v:unknown)=>typeof v==='function',
    parseArgs:()=>{throw new Error('util.parseArgs is not available in the browser sandbox');},styleText:(_s:unknown,t:string)=>t,stripVTControlCharacters:(s:string)=>s.replace(/\x1b\[[0-9;]*m/g,'')};
  }
  case'events':{const mod:any=EventEmitter;mod.EventEmitter=EventEmitter;mod.once=(em:EventEmitter,event:string)=>p.track(new Promise(resolve=>em.once(event,(...a:any[])=>resolve(a))));mod.default=EventEmitter;return mod;}
  case'buffer':return{Buffer,constants:{MAX_LENGTH:2**31-1},kMaxLength:2**31-1,atob,btoa,Blob};
  case'crypto':{
   const algorithms:Record<string,{create():{update(data:Uint8Array):unknown;digest():Uint8Array}}>={md5,sha1,sha256,sha512,'sha-256':sha256,'sha-1':sha1,'sha-512':sha512};
   const createHash=(alg:string)=>{const f=algorithms[alg.toLowerCase()];if(!f)throw new Error(`Digest method not supported: ${alg}`);const h=f.create();const api:any={update:(d:any,e?:string)=>{h.update(typeof d==='string'?encode(d,e??'utf8'):d);return api;},digest:(e?:string)=>{const out=Buffer.fromBytes(h.digest());return e?out.toString(e as Encoding):out;},copy:()=>{throw new Error('hash.copy is not available');}};return api;};
   return{createHash,randomUUID:()=>crypto.randomUUID(),randomBytes:(n:number)=>Buffer.fromBytes(crypto.getRandomValues(new Uint8Array(n))),randomInt:(a:number,b?:number)=>{const [min,max]=b===undefined?[0,a]:[a,b];return min+Math.floor(Math.random()*(max-min));},getRandomValues:(a:any)=>crypto.getRandomValues(a),webcrypto:crypto,subtle:crypto.subtle,getHashes:()=>Object.keys(algorithms),
    createHmac:()=>{throw new Error('crypto.createHmac is not available in the browser sandbox; use crypto.subtle');},timingSafeEqual:(a:Uint8Array,b:Uint8Array)=>Buffer.compare(a,b)===0};
  }
  case'zlib':{const sync=(f:(d:Uint8Array)=>Uint8Array)=>(d:any)=>Buffer.fromBytes(f(typeof d==='string'?encoder.encode(d):d));const async=(f:(d:Uint8Array)=>Uint8Array)=>(d:any,o:any,cb?:any)=>{if(typeof o==='function')cb=o;let r:any,e:any=null;try{r=sync(f)(d);}catch(x){e=x;}p.timer('immediate',()=>cb(e,r));};
   return{gzipSync:sync(gzipSync),gunzipSync:sync(gunzipSync),deflateSync:sync(zlibSync),inflateSync:sync(unzlibSync),deflateRawSync:sync(deflateSync),inflateRawSync:sync(inflateSync),unzipSync:sync(gunzipSync),gzip:async(gzipSync),gunzip:async(gunzipSync),deflate:async(zlibSync),inflate:async(unzlibSync),constants:{}};}
  case'url':return{URL,URLSearchParams,fileURLToPath:(u:string|URL)=>decodeURIComponent(new URL(String(u)).pathname),pathToFileURL:(s:string)=>new URL('file://'+encodeURI(posix.resolve(p.cwd,s))),format:(u:URL|string)=>String(u),parse:(s:string)=>{try{const u=new URL(s);return{...u,href:u.href,protocol:u.protocol,host:u.host,hostname:u.hostname,port:u.port,pathname:u.pathname,search:u.search,query:u.search.slice(1),hash:u.hash};}catch{return{href:s,pathname:s};}}};
  case'querystring':return{parse:(s:string)=>Object.fromEntries(new URLSearchParams(s)),stringify:(o:Record<string,string>)=>new URLSearchParams(o).toString(),escape:encodeURIComponent,unescape:decodeURIComponent};
  case'assert':case'assert/strict':{
   const fail=(message:unknown,fallback:string)=>{if(message instanceof Error)throw message;throw Object.assign(new Error(message?String(message):fallback),{name:'AssertionError',code:'ERR_ASSERTION'});};
   const assert:any=(v:unknown,m?:unknown)=>{if(!v)fail(m,'The expression evaluated to a falsy value');};
   Object.assign(assert,{ok:assert,equal:(a:unknown,b:unknown,m?:unknown)=>{if(a!=b)fail(m,`${inspect(a)} == ${inspect(b)}`);},strictEqual:(a:unknown,b:unknown,m?:unknown)=>{if(!Object.is(a,b))fail(m,`Expected values to be strictly equal:\n${inspect(a)} !== ${inspect(b)}`);},notEqual:(a:unknown,b:unknown,m?:unknown)=>{if(a==b)fail(m,`${inspect(a)} != ${inspect(b)}`);},notStrictEqual:(a:unknown,b:unknown,m?:unknown)=>{if(Object.is(a,b))fail(m,'Expected values to be not strictly equal');},
    deepEqual:(a:unknown,b:unknown,m?:unknown)=>{if(!deepEqual(a,b,true))fail(m,'Expected values to be loosely deep-equal');},deepStrictEqual:(a:unknown,b:unknown,m?:unknown)=>{if(!deepEqual(a,b))fail(m,`Expected values to be strictly deep-equal:\n${inspect(a)}\n${inspect(b)}`);},notDeepStrictEqual:(a:unknown,b:unknown,m?:unknown)=>{if(deepEqual(a,b))fail(m,'Expected values not to be deep-equal');},
    throws:(f:()=>void,_e?:unknown,m?:unknown)=>{try{f();}catch{return;}fail(m,'Missing expected exception.');},rejects:async(f:any,_e?:unknown,m?:unknown)=>{try{await(typeof f==='function'?f():f);}catch{return;}fail(m,'Missing expected rejection.');},
    doesNotThrow:(f:()=>void)=>f(),match:(s:string,re:RegExp,m?:unknown)=>{if(!re.test(s))fail(m,`The input did not match the regular expression ${re}`);},fail:(m?:unknown)=>fail(m,'Failed'),AssertionError:Error});
   assert.strict=assert;return assert;
  }
  case'timers':return{setTimeout:(f:any,ms?:number,...a:any[])=>p.timer('timeout',f,ms,a),setInterval:(f:any,ms?:number,...a:any[])=>p.timer('interval',f,ms,a),setImmediate:(f:any,...a:any[])=>p.timer('immediate',f,0,a),clearTimeout:(t:any)=>p.clear(t),clearInterval:(t:any)=>p.clear(t),clearImmediate:(t:any)=>p.clear(t)};
  case'timers/promises':return{setTimeout:(ms?:number,value?:unknown)=>new Promise(resolve=>p.timer('timeout',()=>resolve(value),ms)),setImmediate:(value?:unknown)=>new Promise(resolve=>p.timer('immediate',()=>resolve(value))),scheduler:{wait:(ms:number)=>new Promise(resolve=>p.timer('timeout',resolve,ms))}};
  case'perf_hooks':return{performance};
  case'process':return p.process;
  case'console':return p.console;
  case'module':return{createRequire:(from:string|URL)=>p.requireFrom(posix.dirname(String(from).replace(/^file:\/\//,'')),null),builtinModules:[...CORE_UNAVAILABLE],isBuiltin:(s:string)=>s.startsWith('node:')};
  case'string_decoder':return{StringDecoder:class{private d:TextDecoder;constructor(e='utf8'){this.d=new TextDecoder(e==='utf8'?'utf-8':e);}write(b:Uint8Array){return this.d.decode(b,{stream:true});}end(b?:Uint8Array){return(b?this.d.decode(b,{stream:true}):'')+this.d.decode();}}};
  case'readline':case'readline/promises':{
   return{createInterface:(options:{input?:any}={})=>{
    const rl:any=new EventEmitter(),input=options.input??p.process.stdin;let closed=false;
    const text=()=>input===p.process.stdin?decode(p.stdin):'';
    const lines=()=>{const all=text().split('\n');if(all.at(-1)==='')all.pop();return all.map(l=>l.replace(/\r$/,''));};
    const on=rl.on.bind(rl);rl.on=(e:string,l:any)=>{on(e,l);if(e==='line')p.timer('immediate',()=>{if(closed)return;for(const line of lines())rl.emit('line',line);closed=true;rl.emit('close');});return rl;};
    rl.close=()=>{if(!closed){closed=true;rl.emit('close');}};rl.question=(_q:string,cb?:(a:string)=>void)=>{const answer=lines()[0]??'';if(cb)p.timer('immediate',()=>cb(answer));return Promise.resolve(answer);};
    rl.setPrompt=()=>{};rl.prompt=()=>{};rl.write=()=>{};
    rl[Symbol.asyncIterator]=async function*(){yield*lines();};return rl;
   }};
  }
  case'child_process':{
   // Commands run in a child shell of the sandbox. Only the asynchronous forms exist: a synchronous one would have to
   // stop this worker while the shell (which is itself async) runs.
   const run=(command:string,options:{cwd?:string;env?:Record<string,string>;input?:string|Uint8Array}={})=>{const out=new StringOutput(),err=new StringOutput();return p.track(p.ctx.script(command,{cwd:options.cwd?posix.resolve(p.cwd,options.cwd):p.cwd,env:options.env??p.process.env,io:{out,err,in:options.input!==undefined?new BytesInput(typeof options.input==='string'?encoder.encode(options.input):options.input):undefined}}).then(code=>({code,stdout:out.text(),stderr:err.text()})));};
   const quote=(s:string)=>`'${s.replace(/'/g,`'\\''`)}'`;
   const exec=(command:string,options?:any,cb?:any)=>{if(typeof options==='function'){cb=options;options={};}const child:any=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=1;child.kill=()=>false;
    run(command,options).then(r=>{if(r.stdout)child.stdout.emit('data',r.stdout);if(r.stderr)child.stderr.emit('data',r.stderr);child.stdout.emit('end');child.stderr.emit('end');child.emit('exit',r.code);child.emit('close',r.code);cb?.(r.code?Object.assign(new Error(`Command failed: ${command}\n${r.stderr}`),{code:r.code,stdout:r.stdout,stderr:r.stderr}):null,r.stdout,r.stderr);});return child;};
   const unavailable=(what:string)=>()=>{throw new Error(`child_process.${what} is not available in the browser sandbox; use child_process.exec or execFile (async), or run the command from the shell`);};
   const execFile=(file:string,args?:any,options?:any,cb?:any)=>{if(typeof args==='function'){cb=args;args=[];options={};}else if(typeof options==='function'){cb=options;options={};}return exec([file,...(args??[])].map(quote).join(' '),options,cb);};
   const spawn=(command:string,args:string[]=[],options:any={})=>exec(options.shell?[command,...args].join(' '):[command,...args].map(quote).join(' '),options);
   const promisified=Symbol.for('nodejs.util.promisify.custom');
   (exec as any)[promisified]=(command:string,options?:any)=>run(command,options).then(r=>{if(r.code)throw Object.assign(new Error(`Command failed: ${command}\n${r.stderr}`),{code:r.code,stdout:r.stdout,stderr:r.stderr});return{stdout:r.stdout,stderr:r.stderr};});
   (execFile as any)[promisified]=(file:string,args:string[]=[],options?:any)=>(exec as any)[promisified]([file,...args].map(quote).join(' '),options);
   return{exec,execFile,spawn,fork:unavailable('fork'),execSync:unavailable('execSync'),execFileSync:unavailable('execFileSync'),spawnSync:unavailable('spawnSync')};
  }
  case'stream':case'stream/promises':{
   class Stream extends EventEmitter{pipe(dest:any){this.on('data',(d:any)=>dest.write(d));this.on('end',()=>dest.end?.());return dest;}}
   class Readable extends Stream{static from(items:Iterable<unknown>|AsyncIterable<unknown>){const r=new Readable();p.timer('immediate',async()=>{for await(const item of items as AsyncIterable<unknown>)r.emit('data',item);r.emit('end');});return r;}push(chunk:unknown){if(chunk===null)this.emit('end');else this.emit('data',chunk);return true;}}
   class Writable extends Stream{constructor(private options:{write?:(c:any,e:string,cb:()=>void)=>void}={}){super();}write(chunk:any,_e?:any,cb?:any){this.options.write?.(chunk,'buffer',()=>{});if(typeof cb==='function')cb();return true;}end(chunk?:any){if(chunk!==undefined)this.write(chunk);this.emit('finish');this.emit('close');return this;}}
   const mod={Stream,Readable,Writable,Transform:Writable,PassThrough:Writable,Duplex:Writable,pipeline:(...streams:any[])=>{const cb=typeof streams.at(-1)==='function'?streams.pop():undefined;for(let i=0;i<streams.length-1;i++)streams[i].pipe(streams[i+1]);streams.at(-1).on?.('finish',()=>cb?.());return streams.at(-1);},finished:(s:any,cb:any)=>s.on('finish',cb)};
   return name==='stream'?mod:{pipeline:(...streams:any[])=>new Promise(resolve=>{mod.pipeline(...streams,resolve);}),finished:(s:any)=>new Promise(resolve=>s.on('finish',resolve))};
  }
  case'tty':return{isatty:()=>false};
  case'constants':return{};
  case'async_hooks':return{AsyncLocalStorage:class{private store:unknown;run(store:unknown,f:()=>unknown){this.store=store;return f();}getStore(){return this.store;}}};
  case'diagnostics_channel':return{channel:()=>({publish(){},subscribe(){},hasSubscribers:false})};
  case'test':throw new Error('node:test is not available in the browser sandbox');
 }
 throw Object.assign(new Error(`Cannot find module 'node:${name}'`),{code:'MODULE_NOT_FOUND'});
}
function deepEqual(a:any,b:any,loose=false):boolean{
 if(loose?a==b:Object.is(a,b))return true;
 if(typeof a!=='object'||typeof b!=='object'||!a||!b)return false;
 if(Object.getPrototypeOf(a)!==Object.getPrototypeOf(b)&&!loose)return false;
 if(a instanceof Date)return a.getTime()===b.getTime();
 if(a instanceof Map||a instanceof Set)return a.size===b.size&&deepEqual([...a],[...b],loose);
 const ka=Object.keys(a),kb=Object.keys(b);return ka.length===kb.length&&ka.every(k=>deepEqual(a[k],b[k],loose));
}
/** `node`: -e/-p code, a script, or a script on stdin, with Node's CommonJS require, built-in modules over the sandbox's
 * files, and TypeScript or ES modules compiled by esbuild first. The process ends when its timers and pending work do. */
export const node:Command=async ctx=>{
 const args=ctx.args.slice();let code:string|undefined,print=false,file:string|undefined,check=false,inputType='commonjs';const preload:string[]=[];
 while(args.length){
  const a=args.shift()!;
  if(a==='-v'||a==='--version'){await ctx.out(NODE_VERSION+'\n');return 0;}
  if(a==='-h'||a==='--help'){await ctx.out('Usage: node [options] [ script.js | -e "script" | - ] [arguments]\nnode in the browser sandbox: CommonJS and ES modules, TypeScript, and fs, path, os, util, events, crypto, zlib, child_process.exec over the workspace.\n');return 0;}
  if(a==='-e'||a==='--eval'){code=args.shift()??'';break;}
  if(a==='-p'||a==='--print'){code=args.shift()??'';print=true;break;}
  if(a.startsWith('--eval=')){code=a.slice(7);break;}
  if(a==='-c'||a==='--check'){check=true;continue;}
  if(a==='-r'||a==='--require'){preload.push(args.shift()??'');continue;}
  if(a.startsWith('--input-type=')){inputType=a.slice(13);continue;}
  if(a==='--')break;
  if(a==='-'){code=await ctx.stdin.text();break;}
  if(a.startsWith('-'))continue; // --no-warnings, --max-old-space-size=…, --experimental-* and the like change nothing here
  file=a;break;
 }
 if(code===undefined&&file===undefined){code=ctx.stdin instanceof EmptyInput?'':await ctx.stdin.text();if(!code.trim())return 0;}
 const stdin=ctx.stdin instanceof EmptyInput?new Uint8Array():await ctx.stdin.readAll(256<<20);
 const path=file!==undefined?ctx.resolve(file):posix.join(ctx.cwd,'[eval]');
 const proc=new NodeProcess(ctx,['/usr/bin/node',...(file!==undefined?[path]:[]),...args],stdin);
 const module:Module={id:'.',filename:path,loaded:false,exports:{},children:[],paths:[],parent:null};proc.main=module;proc.cache.set(path,module);
 let source:string;
 if(file!==undefined){const s=tryStat(ctx.fs,path);if(!s||s.type!=='file'){await ctx.err(`node:internal/modules/cjs/loader\n  throw err;\n  ^\n\nError: Cannot find module '${path}'\n\nNode.js ${NODE_VERSION}\n`);return 1;}source=decode(ctx.fs.readFile(path));}
 else source=print?`module.exports=(${code});`:code!;
 const onRejection=(event:{reason?:unknown;preventDefault?:()=>void})=>{event.preventDefault?.();proc.fail(event.reason);};
 globalThis.addEventListener?.('unhandledrejection',onRejection as never);
 try{
  // TypeScript, JSX and ES modules are compiled before anything runs, so require can stay synchronous.
  const esmEval=file===undefined&&(inputType==='module'||(code!==undefined&&!print&&/(^|\n)\s*(import\s+[\w{*'"]|export\s)/.test(code)));
  if(file!==undefined){await proc.precompile(path);source=proc.compiled.get(path)??source;}
  else if(esmEval)source=await compile(ctx,source,path+'.mjs');
  else if(!print&&/\bawait\b/.test(code!)&&!/\basync\b/.test(code!))source=`return (async () => {\n${code}\n})();`;
  proc.compiled.set(path,source);
  if(check)return 0;
  for(const id of preload)proc.load(id,ctx.cwd,module);
  let result:unknown;
  try{result=proc.evaluate(module,source);if(result instanceof Promise)await proc.track(result);}catch(error){proc.fail(error);}
  if(print&&!proc.exited)proc.process.stdout.write(inspect(module.exports)+'\n');
  // Like Node, the process lives while timers or other pending work remain.
  while(!proc.exited&&(proc.timers.size||proc.pending)){
   if(ctx.signal.aborted){proc.exit(130);break;}
   await Promise.race([proc.idle(),new Promise(r=>setTimeout(r,50))]);
  }
  await new Promise(r=>setTimeout(r,0));
  if(!proc.exited)proc.exit(proc.process.exitCode??0);
  if(proc.error!==undefined){const e=proc.error;await ctx.err(`${e instanceof Error?e.stack??String(e):`Uncaught ${inspect(e)}`}\n\nNode.js ${NODE_VERSION}\n`);}
  return proc.exitCode??0;
 }catch(error){
  if(error instanceof CommandError)throw error;
  await ctx.err(String((error as Error)?.stack??error)+'\n');return 1;
 }finally{
  globalThis.removeEventListener?.('unhandledrejection',onRejection as never);
  for(const t of proc.timers)clearTimeout(t);
 }
};
/** npx: esbuild and TypeScript runners resolve to what the sandbox has; nothing is downloaded. */
export const npx:Command=async ctx=>{
 const args=ctx.args.filter(a=>a!=='-y'&&a!=='--yes'&&a!=='--no-install'&&!a.startsWith('--package'));
 const [tool,...rest]=args;
 if(tool==='esbuild')return ctx.exec(['esbuild',...rest]);
 if(tool==='tsx'||tool==='ts-node'||tool==='ts-node-esm')return ctx.exec(['node',...rest]);
 throw new CommandError(`${tool??'npx'}: npx cannot download packages in the browser sandbox. Available: npx esbuild, npx tsx (runs TypeScript with node).`,127);
};
