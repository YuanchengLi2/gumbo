import {MemoryFS} from '../src/fs/memory';
import {Shell} from '../src/shell/shell';
import {StringOutput,BytesInput,EmptyInput} from '../src/shell/io';
import {unixTools,unavailable} from '../src/tools';
import type {Command,Host} from '../src/shell/types';
import {decode,encoder} from '../src/fs/util';

/** Runs a script in a fresh shell over an in-memory workspace at /w; stdout and stderr come back apart. */
export async function sh(script:string,files:Record<string,string|Uint8Array>={},options:{stdin?:string;programs?:Record<string,Command>;fs?:MemoryFS;env?:Record<string,string>;fetch?:typeof fetch}={}){
 const fs=options.fs??new MemoryFS(Object.fromEntries(Object.entries(files).map(([k,v])=>['w/'+k,v])));fs.mkdir('/w',true);fs.mkdir('/tmp',true);
 const host:Host={commands:new Map(Object.entries({...unixTools,...options.programs})),unavailable,timeLeft:()=>Infinity,reportMemory(){},workspace:'/w',fetch:options.fetch};
 const out=new StringOutput(),err=new StringOutput();
 const shell=new Shell(fs,host,new AbortController().signal,{cwd:'/w',env:{HOME:'/w',PATH:'/usr/bin:/bin',TMPDIR:'/tmp',...options.env}});
 const status=await shell.main(script,{in:options.stdin!==undefined?new BytesInput(encoder.encode(options.stdin)):new EmptyInput(),out,err});
 return{status,out:out.text(),err:err.text(),fs,read:(path:string)=>decode(fs.readFile(path.startsWith('/')?path:'/w/'+path)),exists:(path:string)=>{try{fs.stat(path.startsWith('/')?path:'/w/'+path);return true;}catch{return false;}}};
}
/** stdout of a script that must succeed. */
export async function out(script:string,files:Record<string,string|Uint8Array>={},options:Parameters<typeof sh>[2]={}){
 const r=await sh(script,files,options);if(r.status!==0)throw new Error(`exit ${r.status}: ${r.err}`);return r.out;
}
