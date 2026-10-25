import {md5,sha1} from '@noble/hashes/legacy.js';
import {sha256,sha512} from '@noble/hashes/sha2.js';
import {CommandError,type Command,type CommandContext} from '../shell/types';
import {parseArgs,inputs} from './common';
import {evalTest} from '../shell/test';
import {strftime} from './awk';
import {FileInput} from '../shell/io';
import {describeError} from '../fs/types';
import {tryStat,mkdirp,decode,encoder} from '../fs/util';
import {basename,join,dirname} from '../path';

const hasher={md5sum:md5,sha1sum:sha1,sha256sum:sha256,sha512sum:sha512};
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
/** md5sum, sha1sum, sha256sum, sha512sum: streamed in chunks, and -c to check a list. */
const hashsum:Command=async ctx=>{
 const {opts,rest}=parseArgs(ctx.name,ctx.args,{flags:'cbtwqsz',long:{check:'c',binary:'b',text:'t',warn:'w',quiet:'q',status:'s',strict:'strict',tag:'tag',zero:'z','ignore-missing':'ignoreMissing'}});
 const fn=hasher[ctx.name as keyof typeof hasher]??sha256,state={status:0};
 const digest=async(input:{chunks():AsyncGenerator<Uint8Array>})=>{const h=fn.create();for await(const chunk of input.chunks())h.update(chunk);return hex(h.digest());};
 if(opts.c){
  let bad=0,missing=0;
  for await(const {input} of inputs(ctx,rest,state))for await(const line of input.lines()){
   const m=/^\\?([0-9a-fA-F]+) [ *](.+)$/.exec(line)??/^\w+ \((.+)\) = ([0-9a-fA-F]+)$/.exec(line);if(!m)continue;
   const [want,name]=m[1].length>m[2].length&&/^[0-9a-fA-F]+$/.test(m[1])?[m[1],m[2]]:[m[2],m[1]];
   let got:string;try{const f=new FileInput(ctx.fs,ctx.resolve(name));try{got=await digest(f);}finally{f.close();}}catch{if(opts.ignoreMissing)continue;missing++;if(!opts.s)await ctx.out(`${name}: FAILED open or read\n`);continue;}
   const ok=got.toLowerCase()===want.toLowerCase();if(!ok)bad++;if(!opts.s&&(!ok||!opts.q))await ctx.out(`${name}: ${ok?'OK':'FAILED'}\n`);
  }
  if(bad&&!opts.s)await ctx.err(`${ctx.name}: WARNING: ${bad} computed checksum${bad>1?'s':''} did NOT match\n`);
  return bad||missing||state.status?1:0;
 }
 for await(const {name,input} of inputs(ctx,rest,state)){const h=await digest(input);await ctx.out(opts.tag?`${ctx.name.replace('sum','').toUpperCase()} (${name}) = ${h}\n`:`${h}  ${name}\n`);}
 return state.status;
};
const env:Command=async ctx=>{
 const args=ctx.args.slice();let vars:Record<string,string>={...ctx.env},cwd:string|undefined,nul=false;
 while(args.length){
  const a=args[0];
  if(a==='-i'||a==='-'||a==='--ignore-environment'){vars={};args.shift();continue;}
  if(a==='-u'||a==='--unset'){args.shift();delete vars[args.shift()??''];continue;}
  if(a.startsWith('--unset=')){delete vars[a.slice(8)];args.shift();continue;}
  if(a==='-C'||a==='--chdir'){args.shift();cwd=ctx.resolve(args.shift()??'.');continue;}
  if(a==='-0'||a==='--null'){nul=true;args.shift();continue;}
  if(a==='-S'||a==='--split-string'){args.shift();const s=args.shift()??'';args.unshift(...s.split(/\s+/).filter(Boolean));continue;}
  if(a==='--'){args.shift();break;}
  if(/^[A-Za-z_][A-Za-z0-9_]*=/.test(a)){const eq=a.indexOf('=');vars[a.slice(0,eq)]=a.slice(eq+1);args.shift();continue;}
  break;
 }
 if(!args.length){for(const [k,v] of Object.entries(vars))await ctx.out(`${k}=${v}${nul?'\0':'\n'}`);return 0;}
 return ctx.exec(args,{env:vars,cwd});
};
function duration(text:string){
 const m=/^(\d*\.?\d+)([smhd]?)$/.exec(text.trim());if(!m)throw new CommandError(`invalid time interval '${text}'`,1);
 return Number(m[1])*({'':1,s:1,m:60,h:3600,d:86400}[m[2] as 's'])*1000;
}
/** Waits, or stops early when the command is stopped. */
const wait=(ms:number,signal:AbortSignal)=>new Promise<void>((resolve,reject)=>{if(signal.aborted){reject(signal.reason);return;}const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);const stop=()=>{clearTimeout(timer);reject(signal.reason);};signal.addEventListener('abort',stop,{once:true});});
const sleep:Command=async ctx=>{if(!ctx.args.length)throw new CommandError('missing operand',1);const ms=ctx.args.reduce((n,a)=>n+duration(a),0);await wait(ms,ctx.signal);return 0;};
const timeout:Command=async ctx=>{
 const args=ctx.args.slice();let kill=false;
 while(args[0]?.startsWith('-')){const a=args.shift()!;if(a==='-s'||a==='-k'||a==='--signal'||a==='--kill-after')args.shift();if(a==='--preserve-status'||a==='--foreground'||a==='-v'||a==='--verbose')continue;if(a.startsWith('--signal=')||a.startsWith('--kill-after='))continue;kill||=a==='-k';}
 const limit=args.shift();if(!limit||!args.length)throw new CommandError('usage: timeout DURATION COMMAND [ARG]...',125);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error(`timed out after ${limit}`)),duration(limit));
 try{return await ctx.exec(args,{signal:controller.signal});}
 catch(error){if(controller.signal.aborted&&!ctx.signal.aborted)return 124;throw error;}
 finally{clearTimeout(timer);}
};
/** Commands that only change how another one runs: here they just run it. */
const passthrough=(skip:(args:string[])=>string[]):Command=>async ctx=>{const rest=skip(ctx.args.slice());if(!rest.length)throw new CommandError('missing command',125);return ctx.exec(rest);};
const nice=passthrough(a=>{if(a[0]==='-n')a.splice(0,2);else if(/^-\d+$/.test(a[0]??''))a.shift();else if(a[0]?.startsWith('--adjustment'))a.shift();return a;});
const nohup=passthrough(a=>a);
const stdbuf=passthrough(a=>{while(a[0]&&/^-[ioe]|^--(input|output|error)/.test(a[0])){const x=a.shift()!;if(/^-[ioe]$/.test(x))a.shift();}return a;});
const which:Command=async ctx=>{
 const {opts,rest}=parseArgs('which',ctx.args,{flags:'as',long:{all:'a'}});let status=0;
 for(const name of rest){if(ctx.host.commands.has(name)){if(!opts.s)await ctx.out(`/usr/bin/${name}\n`);}else if(name.includes('/')&&tryStat(ctx.fs,ctx.resolve(name))){if(!opts.s)await ctx.out(ctx.resolve(name)+'\n');}else status=1;}
 return status;
};
/** xargs: builds command lines from stdin; -I replaces, -n/-L batch, -0/-d split, -r skips an empty run. */
const xargs:Command=async ctx=>{
 const {opts,rest}=parseArgs('xargs',ctx.args,{flags:'0rtpx',values:'IinLldPsaE',long:{null:'0','no-run-if-empty':'r',verbose:'t','replace=':'I','max-args=':'n','max-lines=':'L','delimiter=':'d','max-procs=':'P','max-chars=':'s','arg-file=':'a','eof=':'E',interactive:'p',exit:'x','open-tty':'o'},stopAtFirst:true});
 const command=rest.length?rest:['echo'],replace=(opts.I??(opts.i===true?'{}':opts.i)) as string|undefined;
 const text=opts.a?decode(ctx.fs.readFile(ctx.resolve(String(opts.a)))):await ctx.stdin.text();
 let items:string[];
 if(opts['0'])items=text.split('\0');
 else if(opts.d!==undefined){const d=String(opts.d).replace(/^\\n$/,'\n').replace(/^\\t$/,'\t').replace(/^\\0$/,'\0');items=text.split(d);if(items.at(-1)===''||items.at(-1)==='\n')items.pop();}
 else if(replace!==undefined||opts.L)items=text.split('\n').map(l=>replace!==undefined?l.replace(/^[ \t]+/,''):l).filter(l=>l.trim()!=='');
 else{items=[];const re=/"([^"]*)"|'([^']*)'|((?:\\.|[^\s"'\\])+)|(\s+)/g;let cur:string|null=null;for(const m of text.matchAll(re)){if(m[4]!==undefined){if(cur!==null)items.push(cur);cur=null;continue;}cur=(cur??'')+(m[1]??m[2]??m[3].replace(/\\(.)/g,'$1'));}if(cur!==null)items.push(cur);}
 if(opts['0']&&items.at(-1)==='')items.pop();
 if(opts.E!==undefined){const end=items.indexOf(String(opts.E));if(end>=0)items=items.slice(0,end);}
 let status=0;
 const run=async(argv:string[])=>{if(opts.t||opts.p)await ctx.err(argv.join(' ')+'\n');const s=await ctx.exec(argv);if(s===255)throw new CommandError(`${argv[0]}: exited with status 255; aborting`,124);if(s===127||s===126)status=s;else if(s!==0&&status===0)status=123;};
 if(replace!==undefined){for(const item of items)await run(command.map(a=>a.split(replace).join(item)));return status;}
 if(!items.length){if(!opts.r)await run(command);return status;}
 const per=opts.n?Math.max(1,Number(opts.n)):opts.L?Math.max(1,Number(opts.L)):items.length;
 for(let k=0;k<items.length;k+=per){await run([...command,...items.slice(k,k+per)]);if(ctx.signal.aborted)break;}
 return status;
};
/** sh and bash: -c STRING, a script file, or a script on stdin; -e -u -x -o pipefail. */
const sh:Command=async ctx=>{
 const args=ctx.args.slice();let flags='',source:string|undefined,name=ctx.name;
 while(args.length){
  const a=args[0];
  if(a==='-c'){args.shift();source=args.shift()??'';name=args.length?args.shift()!:ctx.name;break;}
  if(a==='-o'||a==='+o'){args.shift();const o=args.shift();if(o==='pipefail')flags+='P';else if(o==='errexit')flags+='e';else if(o==='nounset')flags+='u';else if(o==='xtrace')flags+='x';continue;}
  if(a==='--'){args.shift();break;}
  if(a==='-s'){args.shift();source=await ctx.stdin.text();break;}
  if(/^[-+][a-zA-Z]+$/.test(a)){args.shift();for(const c of a.slice(1)){if(c==='c'){source=args.shift()??'';name=args.length?args.shift()!:ctx.name;}else if(c==='o'){const o=args.shift();if(o==='pipefail')flags+='P';}else if(a[0]==='-')flags+=c;}if(source!==undefined)break;continue;}
  if(a==='--login'||a==='--norc'||a==='--noprofile'||a==='--posix'){args.shift();continue;}
  break;
 }
 if(source===undefined){
  if(!args.length)source=await ctx.stdin.text();
  else{const file=args.shift()!;try{source=decode(ctx.fs.readFile(ctx.resolve(file)));}catch(error){throw new CommandError(`can't open '${file}': ${describeError(error)}`,127);}name=file;}
 }
 return ctx.script(source,{args,name,flags});
};
const test:Command=async ctx=>{
 let args=ctx.args;if(ctx.name==='['){if(args.at(-1)!==']')throw new CommandError("missing ']'",2);args=args.slice(0,-1);}
 return evalTest(args,ctx.fs,ctx.resolve)?0:1;
};
const date:Command=async ctx=>{
 const {opts,rest}=parseArgs('date',ctx.args,{flags:'uRI',values:'dr',long:{utc:'u',universal:'u','date=':'d','reference=':'r','rfc-2822':'R','rfc-email':'R','iso-8601':'I','iso-8601=':'I'}});
 let d=new Date();
 if(opts.r){const s=tryStat(ctx.fs,ctx.resolve(String(opts.r)));if(!s)throw new CommandError(`${opts.r}: No such file or directory`,1);d=new Date(s.mtimeMs);}
 if(opts.d){const t=String(opts.d).trim();const rel=/^([-+]?\d+)\s*(second|minute|hour|day|week)s?(\s+ago)?$/i.exec(t);
  if(t.startsWith('@'))d=new Date(Number(t.slice(1))*1000);else if(t==='now'||t==='')d=new Date();else if(t==='yesterday')d=new Date(Date.now()-86400000);else if(t==='tomorrow')d=new Date(Date.now()+86400000);
  else if(rel){const unit={second:1,minute:60,hour:3600,day:86400,week:604800}[rel[2].toLowerCase() as 'day']*1000;d=new Date(Date.now()+Number(rel[1])*unit*(rel[3]?-1:1));}
  else{const p=Date.parse(t);if(isNaN(p))throw new CommandError(`invalid date '${t}'`,1);d=new Date(p);}}
 const fmt=rest.find(r=>r.startsWith('+'))?.slice(1)??(opts.R?'%a, %d %b %Y %H:%M:%S %z':opts.I?(opts.I===true||opts.I==='date'?'%Y-%m-%d':'%Y-%m-%dT%H:%M:%S%z'):'%a %b %e %H:%M:%S %Z %Y');
 await ctx.out(strftime(fmt,d,!!opts.u).replace('%Z',opts.u?'UTC':'')+'\n');return 0;
};
const uname:Command=async ctx=>{
 const parts={s:'Linux',n:'sandbox',r:'6.0.0-browser',v:'#1 SMP',m:'wasm32',p:'wasm32',i:'wasm32',o:'GNU/Linux'};
 const flags=ctx.args.join('').replace(/-/g,'');const pick=flags.includes('a')?'snrvmo':flags||'s';
 await ctx.out([...pick].map(c=>parts[c as 's']).filter(Boolean).join(' ')+'\n');return 0;
};
const nproc:Command=async ctx=>{await ctx.out(String((globalThis.navigator as {hardwareConcurrency?:number}|undefined)?.hardwareConcurrency??4)+'\n');return 0;};
const whoami:Command=async ctx=>{await ctx.out('user\n');return 0;};
const id:Command=async ctx=>{await ctx.out(ctx.args.includes('-u')?'1000\n':ctx.args.includes('-un')||ctx.args.includes('-nu')?'user\n':'uid=1000(user) gid=1000(user) groups=1000(user)\n');return 0;};
const hostname:Command=async ctx=>{await ctx.out('sandbox\n');return 0;};
const clear:Command=async()=>0;
/** A fetch that names the browser's limits when it fails: most sites refuse cross-origin requests from a web page. */
async function download(ctx:CommandContext,url:string,init?:RequestInit){
 const fetcher=ctx.host.fetch??globalThis.fetch;if(!fetcher)throw new CommandError('no network access in this sandbox',4);
 try{return await fetcher(url,{...init,signal:ctx.signal});}
 catch(error){if(ctx.signal.aborted)throw error;throw new CommandError(`unable to fetch ${url}: ${(error as Error).message}. In the browser a download only works from sites that allow cross-origin requests; for other pages use the web tool with the page's url, and the media tool to import media.`,4);}
}
const wget:Command=async ctx=>{
 const {opts,rest}=parseArgs('wget',ctx.args,{flags:'qcNnvSOP',values:'OPUTt',long:{quiet:'q','output-document=':'O','directory-prefix=':'P','user-agent=':'U','no-check-certificate':'nc','timeout=':'T','tries=':'t',continue:'c','show-progress':'sp','no-verbose':'nv',header:'h','header=':'h','progress=':'progress'},lists:'h'});
 let status=0;
 for(const url of rest){
  const res=await download(ctx,url);if(!res.ok){await ctx.err(`wget: ${url}: ERROR ${res.status} ${res.statusText}\n`);status=8;continue;}
  const data=new Uint8Array(await res.arrayBuffer());
  const target=opts.O!==undefined?String(opts.O):join(String(opts.P??'.'),decodeURIComponent(basename(new URL(url).pathname))||'index.html');
  if(target==='-'){await ctx.stdout.write(data);continue;}
  const path=ctx.resolve(target);mkdirp(ctx.fs,dirname(path));ctx.fs.writeFile(path,data);
  if(!opts.q&&!opts.nv)await ctx.err(`saved '${target}' [${data.length}]\n`);
 }
 return status;
};
const curl:Command=async ctx=>{
 const {opts,rest}=parseArgs('curl',ctx.args,{flags:'sSfLOIikvgGn#',values:'oXHdAwuemrT',lists:'Hd',long:{silent:'s','show-error':'S',fail:'f',location:'L','remote-name':'O','output=':'o','request=':'X','header=':'H','data=':'d','data-raw=':'d','data-binary=':'d','data-urlencode=':'d','user-agent=':'A','write-out=':'w',head:'I',include:'i',insecure:'k',verbose:'v','max-time=':'m','connect-timeout=':'ct','retry=':'retry','compressed':'compressed','create-dirs':'createDirs','url=':'url','progress-bar':'#','globoff':'g','fail-with-body':'f','http1.1':'h11','referer=':'e','range=':'r','upload-file=':'T','json=':'json'}});
 const urls=[...rest,...(opts.url?[String(opts.url)]:[])];if(!urls.length)throw new CommandError('no URL specified',2);
 const headers:Record<string,string>={};for(const h of (opts.H as string[]|undefined)??[]){const i=h.indexOf(':');if(i>0)headers[h.slice(0,i).trim()]=h.slice(i+1).trim();}
 if(opts.A)headers['User-Agent']=String(opts.A);if(opts.e)headers.Referer=String(opts.e);if(opts.r)headers.Range='bytes='+opts.r;
 let body:BodyInit|undefined;const data=(opts.d as string[]|undefined);
 if(opts.json){body=String(opts.json);headers['Content-Type']??='application/json';headers.Accept??='application/json';}
 else if(data){if(data.includes('@-'))throw new CommandError('reading data from stdin (@-) is not supported here',2);body=data.map(d=>d.startsWith('@')?decode(ctx.fs.readFile(ctx.resolve(d.slice(1)))):d).join('&');headers['Content-Type']??='application/x-www-form-urlencoded';}
 if(opts.T){body=ctx.fs.readFile(ctx.resolve(String(opts.T))) as BodyInit;}
 const method=opts.X?String(opts.X):opts.I?'HEAD':body!==undefined?(opts.T?'PUT':'POST'):'GET';
 let status=0;
 for(const url of urls){
  let res:Response;try{res=await download(ctx,url,{method,headers,body,redirect:'follow'});}catch(error){if(!opts.s||opts.S)await ctx.err(`curl: (7) ${(error as Error).message}\n`);status=7;continue;}
  if(opts.f&&res.status>=400){if(!opts.s||opts.S)await ctx.err(`curl: (22) The requested URL returned error: ${res.status}\n`);status=22;continue;}
  const head=`HTTP/1.1 ${res.status} ${res.statusText}\r\n`+[...res.headers].map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n';
  const bytes=opts.I?new Uint8Array():new Uint8Array(await res.arrayBuffer());
  const target=opts.o!==undefined?String(opts.o):opts.O?decodeURIComponent(basename(new URL(url).pathname))||'index.html':undefined;
  const payload=opts.I||opts.i?new Uint8Array([...encoder.encode(head),...bytes]):bytes;
  if(target&&target!=='-'){const path=ctx.resolve(target);if(opts.createDirs)mkdirp(ctx.fs,dirname(path));ctx.fs.writeFile(path,payload);}else await ctx.stdout.write(payload);
  if(opts.w){const out=String(opts.w).replace(/%\{(\w+)\}/g,(_,k)=>k==='http_code'||k==='response_code'?String(res.status):k==='size_download'?String(bytes.length):k==='url_effective'?res.url||url:k==='content_type'?res.headers.get('content-type')??'':'').replace(/\\n/g,'\n');await ctx.out(out);}
 }
 return status;
};
export const systemTools:Record<string,Command>={md5sum:hashsum,sha1sum:hashsum,sha256sum:hashsum,sha512sum:hashsum,env,sleep,timeout,nice,nohup,stdbuf,which,xargs,sh,bash:sh,ash:sh,dash:sh,test,'[':test,date,uname,nproc,whoami,id,hostname,clear,wget,curl};
