import {gzipSync,gunzipSync,unzipSync,zipSync,type Zippable} from 'fflate';
import {CommandError,type Command,type CommandContext} from '../shell/types';
import {parseArgs} from './common';
import {describeError} from '../fs/types';
import {tryStat,walk,mkdirp,encoder,decode} from '../fs/util';
import {join,dirname,basename,relative,normalize} from '../path';
import {globRegex} from '../shell/pattern';

const MAX=1<<30;
const fail=(ctx:CommandContext,message:string)=>ctx.err(`${ctx.name}: ${message}\n`);
/** gzip, gunzip and zcat, whole-file in memory (fflate); -c to stdout, -k keeps the input, -d decompresses. */
const gzip:Command=async ctx=>{
 const {opts,rest}=parseArgs(ctx.name,ctx.args,{flags:'cdkfqvntlr123456789',long:{stdout:'c','to-stdout':'c',decompress:'d',uncompress:'d',keep:'k',force:'f',quiet:'q',verbose:'v',list:'l',recursive:'r','no-name':'n'}});
 const decompress=ctx.name!=='gzip'||!!opts.d,toStdout=ctx.name==='zcat'||!!opts.c;
 const level=Number([...'123456789'].reverse().find(d=>opts[d])??6) as 6;let status=0;
 const convert=(data:Uint8Array)=>decompress?gunzipSync(data):gzipSync(data,{level});
 if(!rest.length||rest[0]==='-'){const data=await ctx.stdin.readAll(MAX);try{await ctx.stdout.write(convert(data));}catch(error){throw new CommandError(decompress?'stdin: not in gzip format':String((error as Error).message),1);}return 0;}
 for(const file of rest){
  const path=ctx.resolve(file);let data:Uint8Array;try{data=ctx.fs.readFile(path);}catch(error){await fail(ctx,`${file}: ${describeError(error)}`);status=1;continue;}
  if(decompress&&!toStdout&&!/\.(gz|tgz|z)$/i.test(file)){await fail(ctx,`${file}: unknown suffix -- ignored`);status=2;continue;}
  let out:Uint8Array;try{out=convert(data);}catch{await fail(ctx,`${file}: not in gzip format`);status=1;continue;}
  if(toStdout){await ctx.stdout.write(out);continue;}
  const target=decompress?path.replace(/\.tgz$/i,'.tar').replace(/\.(gz|z)$/i,''):path+'.gz';
  if(tryStat(ctx.fs,target)&&!opts.f){await fail(ctx,`${target} already exists; not overwritten`);status=2;continue;}
  ctx.fs.writeFile(target,out);if(!opts.k)ctx.fs.unlink(path);
  if(opts.v)await ctx.err(`${file}:\t${decompress?'':((1-out.length/Math.max(1,data.length))*100).toFixed(1)+'% -- '}replaced with ${target}\n`);
 }
 return status;
};
// ---------- tar (ustar, with GNU long names and pax paths on read)
type Entry={name:string;type:'file'|'directory'|'symlink';data:Uint8Array;mode:number;mtime:number;link?:string};
const octal=(n:number,width:number)=>n.toString(8).padStart(width-1,'0')+'\0';
function tarHeader(name:string,type:string,size:number,mode:number,mtime:number,link=''){
 const h=new Uint8Array(512),put=(text:string,at:number,width:number)=>h.set(encoder.encode(text).subarray(0,width),at);
 let prefix='',short=name;
 if(encoder.encode(name).length>100){const cut=name.lastIndexOf('/',name.length-1);if(cut>0&&cut<=155&&name.length-cut-1<=100){prefix=name.slice(0,cut);short=name.slice(cut+1);}else return null;}
 put(short,0,100);put(octal(mode&0o7777,8),100,8);put(octal(0,8),108,8);put(octal(0,8),116,8);put(octal(size,12),124,12);put(octal(Math.floor(mtime/1000),12),136,12);
 h.fill(32,148,156);put(type,156,1);put(link,157,100);put('ustar\0',257,6);put('00',263,2);put('user',265,32);put('user',297,32);put(prefix,345,155);
 let sum=0;for(const b of h)sum+=b;put(sum.toString(8).padStart(6,'0')+'\0 ',148,8);return h;
}
function packTar(entries:Entry[]):Uint8Array{
 const parts:Uint8Array[]=[];
 for(const e of entries){
  const type=e.type==='directory'?'5':e.type==='symlink'?'2':'0',name=e.type==='directory'&&!e.name.endsWith('/')?e.name+'/':e.name;
  let header=tarHeader(name,type,e.type==='file'?e.data.length:0,e.mode,e.mtime,e.link);
  if(!header){const long=encoder.encode(name+'\0');parts.push(tarHeader('././@LongLink','L',long.length,0,0)!,pad(long));header=tarHeader(name.slice(0,99),type,e.type==='file'?e.data.length:0,e.mode,e.mtime,e.link)!;}
  parts.push(header);if(e.type==='file')parts.push(pad(e.data));
 }
 parts.push(new Uint8Array(1024));
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
}
const pad=(data:Uint8Array)=>{const size=Math.ceil(data.length/512)*512;if(size===data.length)return data;const out=new Uint8Array(size);out.set(data);return out;};
function unpackTar(data:Uint8Array):Entry[]{
 const entries:Entry[]=[];let at=0,longName:string|undefined,paxPath:string|undefined;
 const text=(from:number,width:number)=>{const slice=data.subarray(from,from+width),end=slice.indexOf(0);return decode(end<0?slice:slice.subarray(0,end));};
 const num=(from:number,width:number)=>parseInt(text(from,width).trim()||'0',8)||0;
 while(at+512<=data.length){
  if(data.subarray(at,at+512).every(b=>b===0))break;
  const type=String.fromCharCode(data[at+156]||48),size=num(at+124,12),body=data.subarray(at+512,at+512+size);
  let name=text(at,100);const prefix=text(at+345,155);if(prefix&&text(at+257,5)==='ustar')name=prefix+'/'+name;
  const mode=num(at+100,8)||0o644,mtime=num(at+136,12)*1000,link=type==='2'?text(at+157,100):undefined;
  at+=512+Math.ceil(size/512)*512;
  if(type==='L'){longName=decode(body).replace(/\0+$/,'');continue;}
  if(type==='x'){for(const m of decode(body).matchAll(/\d+ path=([^\n]*)\n/g))paxPath=m[1];continue;}
  if(type==='g')continue;
  name=paxPath??longName??name;paxPath=longName=undefined;
  entries.push({name,type:type==='5'?'directory':type==='2'?'symlink':'file',data:body.slice(),mode,mtime,link});
 }
 return entries;
}
const tar:Command=async ctx=>{
 let args=ctx.args.slice();
 if(args[0]&&!args[0].startsWith('-')&&/^[cxtrzvfjJOpPkmuC]+$/.test(args[0]))args[0]='-'+args[0];
 // In a bundle (czf, -xzvf) the letters that take values (f, C, T) take the following arguments in order.
 const expanded:string[]=[];
 for(let i=0;i<args.length;i++){const a=args[i];if(/^-[a-zA-Z]{2,}$/.test(a)){for(const c of a.slice(1)){expanded.push('-'+c);if('fCT'.includes(c))expanded.push(args[++i]??'');}continue;}expanded.push(a);}
 args=expanded;
 const {opts,rest}=parseArgs('tar',args,{flags:'cxtrzvjJOpPkmuaZ',values:'fCT',lists:'e',long:{create:'c',extract:'x',get:'x',list:'t',gzip:'z',gunzip:'z',verbose:'v','file=':'f','directory=':'C','to-stdout':'O','exclude=':'e','strip-components=':'strip','keep-old-files':'k','overwrite':'overwrite','no-same-owner':'nso','no-same-permissions':'nsp','preserve-permissions':'p','absolute-names':'P','owner=':'owner','group=':'group','numeric-owner':'no','mtime=':'mtimeOpt','sort=':'sort','transform=':'transform','wildcards':'wildcards','anchored':'anchored','auto-compress':'a','files-from=':'T'}});
 if(opts.j||opts.J)throw new CommandError('bzip2 and xz archives are not available in the browser sandbox; use gzip (z) or zip',2);
 const archive=opts.f as string|undefined,base=opts.C?ctx.resolve(String(opts.C)):ctx.cwd;
 const gz=!!opts.z||(!!archive&&/\.(tgz|tar\.gz)$/i.test(archive)&&(opts.a||opts.x||opts.t));
 const excludes=((opts.e as string[]|undefined)??[]).map(p=>globRegex(p,'s'));
 const excluded=(name:string)=>excludes.some(re=>re.test(name)||re.test(basename(name)));
 if(opts.c){
  const names=[...rest];if(opts.T)names.push(...decode(ctx.fs.readFile(ctx.resolve(String(opts.T)))).split('\n').filter(Boolean));
  if(!names.length)throw new CommandError('Cowardly refusing to create an empty archive',2);
  const entries:Entry[]=[];
  for(const name of names){
   const root=normalize(name.startsWith('/')?name:join(base,name));if(!tryStat(ctx.fs,root)){await fail(ctx,`${name}: Cannot stat: No such file or directory`);continue;}
   for(const e of walk(ctx.fs,root)){
    const rel=normalize(name.startsWith('/')?e.path.slice(1):join(name,relative(root,e.path))).replace(/^\.\//,'');if(excluded(rel)||excluded(e.path))continue;
    entries.push({name:rel,type:e.stat.type,data:e.stat.type==='file'?ctx.fs.readFile(e.path):new Uint8Array(),mode:e.stat.mode||(e.stat.type==='directory'?0o755:0o644),mtime:e.stat.mtimeMs,link:e.stat.type==='symlink'?ctx.fs.readlink?.(e.path):undefined});
    if(opts.v)await ctx.err(rel+(e.stat.type==='directory'?'/':'')+'\n');
   }
  }
  let data=packTar(entries);if(gz)data=gzipSync(data);
  if(!archive||archive==='-')await ctx.stdout.write(data);else ctx.fs.writeFile(ctx.resolve(archive),data);
  return 0;
 }
 if(opts.x||opts.t){
  let data:Uint8Array;try{data=!archive||archive==='-'?await ctx.stdin.readAll(MAX):ctx.fs.readFile(ctx.resolve(archive));}catch(error){throw new CommandError(`${archive}: Cannot open: ${describeError(error)}`,2);}
  if(data[0]===0x1f&&data[1]===0x8b)data=gunzipSync(data);
  const strip=Number(opts.strip??0),wanted=rest.map(r=>normalize(r).replace(/\/$/,''));
  for(const e of unpackTar(data)){
   const parts=e.name.split('/').filter(p=>p&&p!=='.');if(parts.length<=strip)continue;const name=parts.slice(strip).join('/');
   if(wanted.length&&!wanted.some(w=>name===w||name.startsWith(w+'/')||globRegex(w,'s').test(name)))continue;if(excluded(name))continue;
   if(opts.t){await ctx.out(opts.v?`${e.type==='directory'?'d':'-'}rw-r--r-- user/user ${String(e.data.length).padStart(8)} ${new Date(e.mtime).toISOString().slice(0,16).replace('T',' ')} ${name}${e.type==='directory'?'/':''}\n`:name+(e.type==='directory'?'/':'')+'\n');continue;}
   if(opts.O){if(e.type==='file')await ctx.stdout.write(e.data);continue;}
   if(name.split('/').includes('..')&&!opts.P){await fail(ctx,`${name}: Member name contains '..'`);continue;}
   const target=join(base,name);
   if(e.type==='directory')mkdirp(ctx.fs,target);
   else if(e.type==='symlink'&&ctx.fs.symlink){mkdirp(ctx.fs,dirname(target));try{ctx.fs.unlink(target);}catch{}ctx.fs.symlink(e.link!,target);}
   else{mkdirp(ctx.fs,dirname(target));if(opts.k&&tryStat(ctx.fs,target))continue;ctx.fs.writeFile(target,e.data);ctx.fs.utimes?.(target,e.mtime);}
   if(opts.v)await ctx.out(name+'\n');
  }
  return 0;
 }
 throw new CommandError('You must specify one of the -c, -x or -t options',2);
};
const unzip:Command=async ctx=>{
 const {opts,rest}=parseArgs('unzip',ctx.args,{flags:'olqjnpvZ',values:'dx',lists:'x',long:{}});
 if(!rest.length)throw new CommandError('usage: unzip [-lqojn] file.zip [members...] [-d folder]',10);
 const [file,...members]=rest;let data:Uint8Array;
 try{data=ctx.fs.readFile(ctx.resolve(file));}catch{try{data=ctx.fs.readFile(ctx.resolve(file+'.zip'));}catch(error){throw new CommandError(`cannot find or open ${file}: ${describeError(error)}`,9);}}
 const excludes=((opts.x as string[]|undefined)??[]).map(p=>globRegex(p,'s'));
 const pick=(name:string)=>(!members.length||members.some(m=>globRegex(m,'s').test(name)))&&!excludes.some(re=>re.test(name));
 let files:Record<string,Uint8Array>;try{files=unzipSync(data,{filter:f=>pick(f.name)});}catch(error){throw new CommandError(`${file}: not a zip archive (${(error as Error).message})`,9);}
 const dest=opts.d?ctx.resolve(String(opts.d)):ctx.cwd;
 if(opts.l||opts.v){let total=0,n=0;await ctx.out('  Length      Date    Time    Name\n---------  ---------- -----   ----\n');for(const [name,bytes] of Object.entries(files)){total+=bytes.length;n++;await ctx.out(`${String(bytes.length).padStart(9)}  1980-01-01 00:00   ${name}\n`);}await ctx.out(`---------                     -------\n${String(total).padStart(9)}                     ${n} file${n===1?'':'s'}\n`);return 0;}
 if(!opts.q&&!opts.p)await ctx.out(`Archive:  ${file}\n`);
 for(const [name,bytes] of Object.entries(files)){
  if(opts.p){if(!name.endsWith('/'))await ctx.stdout.write(bytes);continue;}
  if(name.split('/').includes('..')){await fail(ctx,`skipping: ${name} (parent directory in path)`);continue;}
  const target=join(dest,opts.j?basename(name):name);
  if(name.endsWith('/')){if(!opts.j)mkdirp(ctx.fs,target);continue;}
  if(tryStat(ctx.fs,target)&&opts.n)continue;
  mkdirp(ctx.fs,dirname(target));ctx.fs.writeFile(target,bytes);if(!opts.q)await ctx.out(`  inflating: ${relative(ctx.cwd,target)}\n`);
 }
 return 0;
};
const zip:Command=async ctx=>{
 const {opts,rest}=parseArgs('zip',ctx.args,{flags:'rqjD0123456789',values:'x',lists:'x',long:{recurse:'r',quiet:'q','junk-paths':'j'}});
 if(rest.length<2)throw new CommandError('usage: zip [-rqj] archive.zip files...',16);
 let [archive,...names]=rest;if(!/\.zip$/i.test(archive)&&!tryStat(ctx.fs,ctx.resolve(archive)))archive+='.zip';
 const level=Number([...'0123456789'].reverse().find(d=>opts[d])??6);const excludes=((opts.x as string[]|undefined)??[]).map(p=>globRegex(p,'s'));
 const tree:Zippable={};let existing:Record<string,Uint8Array>={};try{existing=unzipSync(ctx.fs.readFile(ctx.resolve(archive)));}catch{}
 for(const [name,bytes] of Object.entries(existing))tree[name]=bytes;
 for(const name of names){
  const root=ctx.resolve(name),s=tryStat(ctx.fs,root);if(!s){await fail(ctx,`warning: name not matched: ${name}`);continue;}
  const entries=s.type==='directory'&&opts.r?[...walk(ctx.fs,root)]:[{path:root,stat:s,depth:0}];
  for(const e of entries){
   const rel=opts.j?basename(e.path):normalize(join(name,relative(root,e.path))).replace(/^\.\//,'').replace(/^\//,'');if(excludes.some(re=>re.test(rel)))continue;
   if(e.stat.type==='directory'){if(!opts.j&&!opts.D)tree[rel.replace(/\/?$/,'/')]=new Uint8Array();}else tree[rel]=[ctx.fs.readFile(e.path),{level:level as 6}];
   if(!opts.q)await ctx.out(`  adding: ${rel}${e.stat.type==='directory'?'/':''}\n`);
  }
 }
 ctx.fs.writeFile(ctx.resolve(archive),zipSync(tree));return 0;
};
export const archiveTools:Record<string,Command>={gzip,gunzip:gzip,zcat:gzip,tar,unzip,zip};
