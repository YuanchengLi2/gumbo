import {CommandError,type CommandContext} from '../shell/types';
import {FileInput,type Input} from '../shell/io';
import {describeError,type FileStat} from '../fs/types';

export type Options=Record<string,string|boolean|string[]|undefined>;
/** Option spec: `flags` are single-letter switches, `values` letters that take a value, `long` maps --names to a letter
 * (or to a name of its own, "=" suffix when it takes a value). `numeric` lets -5 mean -n 5 (head, tail, uniq). Values
 * given more than once collect into a list under `lists`. */
export interface Spec{flags?:string;values?:string;long?:Record<string,string>;numeric?:string;lists?:string;stopAtFirst?:boolean}
export function parseArgs(name:string,args:string[],spec:Spec):{opts:Options;rest:string[]}{
 const opts:Options={},rest:string[]=[],flags=spec.flags??'',values=spec.values??'',lists=spec.lists??'';
 const put=(key:string,value:string|boolean)=>{if(lists.includes(key)&&typeof value==='string'){const list=(opts[key] as string[]|undefined)??[];list.push(value);opts[key]=list;}else opts[key]=value;};
 for(let i=0;i<args.length;i++){
  const a=args[i];
  if(a==='--'){rest.push(...args.slice(i+1));break;}
  if(a.startsWith('--')&&a.length>2){
   const eq=a.indexOf('='),key=eq<0?a.slice(2):a.slice(2,eq),target=spec.long?.[key]??spec.long?.[key+'='];
   if(target===undefined){if(spec.long?.['*']!==undefined){opts[key]=eq<0?true:a.slice(eq+1);continue;}throw new CommandError(`unrecognized option '${a}'`,2);}
   const takes=spec.long?.[key+'=']!==undefined||values.includes(target);
   if(takes){const value=eq>=0?a.slice(eq+1):args[++i];if(value===undefined)throw new CommandError(`option '${a}' requires an argument`,2);put(target,value);}else put(target,true);
   continue;
  }
  if(a.startsWith('-')&&a.length>1){
   if(spec.numeric&&/^-\d+$/.test(a)){put(spec.numeric,a.slice(1));continue;}
   let j=1;
   for(;j<a.length;j++){
    const c=a[j];
    if(values.includes(c)){const value=j+1<a.length?a.slice(j+1):args[++i];if(value===undefined)throw new CommandError(`option requires an argument -- '${c}'`,2);put(c,value);j=a.length;break;}
    if(flags.includes(c)){put(c,true);continue;}
    throw new CommandError(`invalid option -- '${c}'`,2);
   }
   continue;
  }
  rest.push(a);if(spec.stopAtFirst){rest.push(...args.slice(i+1));break;}
 }
 return{opts,rest};
}
/** The inputs a filter reads: its files, or stdin for none or "-". A missing file is reported and skipped (status 1). */
export async function*inputs(ctx:CommandContext,files:string[],state:{status:number}):AsyncGenerator<{name:string;input:Input}>{
 if(!files.length)files=['-'];
 for(const file of files){
  if(file==='-'){yield{name:'-',input:ctx.stdin};continue;}
  let input:Input;
  try{const path=ctx.resolve(file);if(ctx.fs.stat(path).type==='directory'){await ctx.err(`${ctx.name}: ${file}: Is a directory\n`);state.status=1;continue;}input=new FileInput(ctx.fs,path);}
  catch(error){await ctx.err(`${ctx.name}: ${file}: ${describeError(error)}\n`);state.status=1;continue;}
  try{yield{name:file,input};}finally{input.close();}
 }
}
/** Every line of every input, without newlines; `last` says whether the line ended with one. */
export async function*allLines(ctx:CommandContext,files:string[],state:{status:number}):AsyncGenerator<string>{for await(const {input} of inputs(ctx,files,state))yield*input.lines();}
export function humanSize(bytes:number,si=false){const unit=si?1000:1024,units=['','K','M','G','T','P'];let n=bytes,i=0;while(n>=unit&&i<units.length-1){n/=unit;i++;}return i===0?String(n):(n<10?(Math.ceil(n*10)/10).toFixed(1):String(Math.ceil(n)))+units[i];}
export function modeString(stat:FileStat){const t=stat.type==='directory'?'d':stat.type==='symlink'?'l':'-',m=stat.mode||(stat.type==='directory'?0o755:0o644);let s=t;for(let k=8;k>=0;k--)s+=m&(1<<k)?'rwx'[(8-k)%3]:'-';return s;}
/** A positive count with an optional unit suffix (head -c 1K, tail -c 2M). */
export function count(value:string,what:string){
 const m=/^([+-]?)(\d+)([bkKmMgG]?B?|[KMG]iB)?$/.exec(value.trim());if(!m)throw new CommandError(`invalid number of ${what}: '${value}'`,2);
 const unit=(m[3]??'').replace(/i?B$/,'');const mult=unit==='b'?512:/k/i.test(unit)?1024:/m/i.test(unit)?1<<20:/g/i.test(unit)?1<<30:1;
 return{sign:m[1],n:Number(m[2])*mult};
}
