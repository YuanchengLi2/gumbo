import {parse,parseQuoted,ShellSyntaxError,type Node,type Word,type Part,type Redirect} from './parser';
import {Input,type Output,Pipe,EmptyInput,BytesInput,FileInput,FileOutput,NullOutput,StringOutput,BrokenPipe} from './io';
import {arithmetic,ArithError} from './arith';
import {glob,globRegex,globSource,escapeGlob,hasGlob} from './pattern';
import {evalTest} from './test';
import {CommandError,type Command,type CommandContext,type Host,type IO} from './types';
import {resolve as resolvePath,basename} from '../path';
import {describeError,errorCode,type SandboxFS} from '../fs/types';
import {encoder,decode} from '../fs/util';

class ExitSignal{constructor(public status:number){}}
class ReturnSignal{constructor(public status:number){}}
class LoopSignal{constructor(public kind:'break'|'continue',public levels:number){}}
/** An error the shell reports as "sh: …" and turns into a status (bad substitution, a redirect it cannot open). */
export class ShellError extends Error{constructor(message:string,public status=1){super(message);}}
type Var={value:string;exported:boolean};
type Seg={text:string;quoted:boolean;split:boolean}|{at:string[]};
export interface ShellInit{cwd:string;env:Record<string,string>;args?:string[];name?:string;flags?:string}
let jobCounter=1000;

/** The shell: runs parsed scripts against the sandbox's file system, with JS tools and programs as its commands. */
export class Shell{
 vars=new Map<string,Var>();functions=new Map<string,Node>();positional:string[];name:string;cwd:string;status=0;
 opts={errexit:false,nounset:false,xtrace:false,pipefail:false,noglob:false};
 private suspended=0;private exempt=false;private locals:Map<string,Var|undefined>[]=[];private jobs:Promise<number>[]=[];
 private traps:Record<string,string>={};private closers:(()=>void)[]=[];private depth=0;private lastBg='';private yielded=Date.now();
 private rootIO:IO|undefined;private baseIO:IO|undefined;private lineno=0;private started=Date.now();private substitutions=0;
 constructor(public fs:SandboxFS,public host:Host,public signal:AbortSignal,init:ShellInit){
  for(const [k,v] of Object.entries(init.env))this.vars.set(k,{value:v,exported:true});
  if(!this.vars.has('IFS'))this.vars.set('IFS',{value:' \t\n',exported:false});
  this.cwd=init.cwd;this.vars.set('PWD',{value:init.cwd,exported:true});this.positional=init.args??[];this.name=init.name??'sh';
  for(const flag of init.flags??'')this.setFlag(flag,true);
 }
 /** Runs a whole script as a process: syntax errors, exit, the EXIT trap and background jobs are settled here. */
 async main(source:string,io:IO):Promise<number>{
  this.rootIO=io;let status:number;
  try{status=await this.run(parse(source),io);}
  catch(error){status=await this.settle(error,io);}
  try{await this.waitJobs();}catch{}
  const trap=this.traps.EXIT;if(trap){delete this.traps.EXIT;try{await this.run(parse(trap),io);}catch(error){if(!(error instanceof ExitSignal))await this.settle(error,io);}}
  for(const close of this.closers.splice(0))close();
  return status;
 }
 private async settle(error:unknown,io:IO){
  if(error instanceof ExitSignal)return error.status;
  if(error instanceof ReturnSignal)return error.status;
  if(error instanceof LoopSignal)return this.status;
  if(error instanceof ShellSyntaxError){await io.err.write(error.message+'\n').catch(()=>{});return 2;}
  if(error instanceof ShellError||error instanceof ArithError||error instanceof CommandError){await io.err.write(`sh: ${error.message}\n`).catch(()=>{});return(error as ShellError).status??2;}
  if(error instanceof BrokenPipe)return 141;
  throw error;
 }
 // ---------- variables
 get(name:string):string|undefined{
  switch(name){
   case'?':return String(this.status);case'$':return'1';case'#':return String(this.positional.length);case'0':return this.name;case'!':return this.lastBg||undefined;
   case'-':return(this.opts.errexit?'e':'')+(this.opts.nounset?'u':'')+(this.opts.xtrace?'x':'')+(this.opts.noglob?'f':'');
   case'RANDOM':return String(Math.floor(Math.random()*32768));case'LINENO':return String(this.lineno);case'SECONDS':return String(Math.floor((Date.now()-this.started)/1000));
  }
  if(/^\d+$/.test(name))return this.positional[Number(name)-1];
  return this.vars.get(name)?.value;
 }
 set(name:string,value:string,exported?:boolean){
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new ShellError(`${name}: bad variable name`);
  const old=this.vars.get(name);this.vars.set(name,{value,exported:exported??old?.exported??false});
 }
 environment(extra:[string,string][]=[]):Record<string,string>{const env:Record<string,string>={};for(const [k,v] of this.vars)if(v.exported)env[k]=v.value;for(const [k,v] of extra)env[k]=v;if('PWD' in env)env.PWD=this.cwd;return env;}
 /** A copy for ( … ), pipeline stages, $( … ) and background jobs: changes inside never reach this shell. */
 subshell(signal=this.signal){
  const child=new Shell(this.fs,this.host,signal,{cwd:this.cwd,env:{},args:[...this.positional],name:this.name});
  child.vars=new Map([...this.vars].map(([k,v])=>[k,{...v}]));child.functions=new Map(this.functions);child.opts={...this.opts};child.status=this.status;child.depth=this.depth;child.started=this.started;
  child.rootIO=this.rootIO;child.baseIO=this.baseIO;return child;
 }
 // P is not a real sh flag: it carries "-o pipefail" from `sh -o pipefail -c` into the child shell.
 private setFlag(flag:string,on:boolean){const key=({e:'errexit',u:'nounset',x:'xtrace',f:'noglob',P:'pipefail'} as const)[flag as 'e'];if(key)this.opts[key]=on;}
 // ---------- execution
 async run(node:Node,io:IO):Promise<number>{
  if(this.signal.aborted)throw this.signal.reason??new Error('Stopped.');
  if(this.baseIO&&io===this.rootIO)io=this.baseIO;
  // A loop of builtins never yields on its own; letting the worker take messages keeps "stop" working.
  if(Date.now()-this.yielded>40){this.yielded=Date.now();await new Promise(resolve=>setTimeout(resolve,0));if(this.signal.aborted)throw this.signal.reason??new Error('Stopped.');}
  switch(node.type){
   case'list':return this.list(node,io);
   case'andor':return this.andor(node,io);
   case'pipeline':return this.pipeline(node,io);
   case'simple':return this.status=await this.simple(node,io);
   case'func':this.functions.set(node.name,node.body);return this.status=0;
   default:{
    let redirected:{io:IO;close():void};
    try{redirected=await this.redirect(node.redirects,io);}catch(error){if(error instanceof ShellError){await io.err.write(`sh: ${error.message}\n`);return this.status=1;}throw error;}
    try{return this.status=await this.compound(node,redirected.io);}finally{redirected.close();}
   }
  }
 }
 private async compound(node:Node,io:IO):Promise<number>{
  switch(node.type){
   case'group':return this.run(node.body,io);
   case'subshell':return this.subshell().isolated(node.body,io);
   case'if':{
    for(const clause of node.clauses){if(await this.condition(clause.cond,io)===0)return this.run(clause.body,io);}
    return node.otherwise?this.run(node.otherwise,io):0;
   }
   case'for':{
    const items=node.items?await this.fields(node.items,io):[...this.positional];let status=0;
    for(const item of items){this.set(node.name,item);const r=await this.loopStep(node.body,io);if(r.status!==undefined)status=r.status;if(r.stop)break;}
    return status;
   }
   case'cfor':{
    let status=0;if(node.init.trim())await this.arith(node.init,io);
    for(;;){if(node.cond.trim()&&await this.arith(node.cond,io)===0)break;const r=await this.loopStep(node.body,io);if(r.status!==undefined)status=r.status;if(r.stop)break;if(node.step.trim())await this.arith(node.step,io);}
    return status;
   }
   case'while':{
    let status=0;
    for(;;){const c=await this.condition(node.cond,io);if(node.until?c===0:c!==0)break;const r=await this.loopStep(node.body,io);if(r.status!==undefined)status=r.status;if(r.stop)break;}
    return status;
   }
   case'case':{
    const subject=await this.expandSingle(node.word,io);let falling=false,status=0;
    for(const arm of node.arms){
     let matched=falling;
     if(!matched)for(const p of arm.patterns){if(globRegex(await this.expandPattern(p,io),'s').test(subject)){matched=true;break;}}
     if(!matched)continue;
     status=await this.run(arm.body,io);if(arm.next===';&'){falling=true;continue;}if(arm.next===';;&'){falling=false;continue;}return status;
    }
    return status;
   }
   case'test':{
    const words:string[]=[],patterns=new Set<number>();let rematch=false;
    for(const [k,w] of node.words.entries()){const prev=words[k-1];if(prev==='=='||prev==='='||prev==='!='){patterns.add(k);words.push(await this.expandPattern(w,io));}else{if(prev==='=~')rematch=true;words.push(await this.expandSingle(w,io));}}
    try{return evalTest(words,this.fs,p=>resolvePath(this.cwd,p),{extended:true,patterns,vars:n=>this.get(n),match:groups=>{if(rematch)this.set('BASH_REMATCH',groups[0]??'');}})?0:1;}
    catch(error){if(error instanceof CommandError){await io.err.write(`sh: [[: ${error.message}\n`);return 2;}throw error;}
   }
   case'arith':return await this.arith(node.src,io)!==0?0:1;
  }
  throw new ShellError('unsupported command');
 }
 /** A condition (if, while, the left of && and ||) never trips set -e. */
 private async condition(node:Node,io:IO){this.suspended++;try{return await this.run(node,io);}finally{this.suspended--;}}
 private async loopStep(body:Node,io:IO):Promise<{status?:number;stop?:boolean}>{
  try{return{status:await this.run(body,io)};}
  catch(error){if(!(error instanceof LoopSignal))throw error;if(error.levels>1){error.levels--;throw error;}return error.kind==='break'?{stop:true,status:0}:{status:0};}
 }
 /** Runs a node as its own process (subshell, pipeline stage, background job): exit ends only it. */
 async isolated(node:Node,io:IO):Promise<number>{
  try{const status=await this.run(node,io);await this.waitJobs();return status;}
  catch(error){return this.settle(error,io);}
  finally{for(const close of this.closers.splice(0))close();}
 }
 private async list(node:Extract<Node,{type:'list'}>,io:IO){
  let status=0;
  for(const item of node.items){
   if(item.background){const job=this.subshell().isolated(item.node,io).catch(()=>1);this.jobs.push(job);this.lastBg=String(++jobCounter);status=0;continue;}
   this.exempt=false;status=this.status=await this.run(item.node,io);
   if(status!==0&&this.opts.errexit&&this.suspended===0&&!this.exempt)throw new ExitSignal(status);
  }
  return status;
 }
 private async andor(node:Extract<Node,{type:'andor'}>,io:IO){
  let status=await this.condition(node.first,io),ranLast=false;
  for(const [k,step] of node.rest.entries()){
   if((step.op==='&&')!==(status===0))continue;
   const last=k===node.rest.length-1;status=last?await this.run(step.node,io):await this.condition(step.node,io);ranLast=last;
  }
  this.exempt=!ranLast;return status;
 }
 private async pipeline(node:Extract<Node,{type:'pipeline'}>,io:IO){
  const started=performance.now();let status:number;
  if(node.commands.length===1)status=node.negate?await this.condition(node.commands[0],io):await this.run(node.commands[0],io);
  else{
   const n=node.commands.length,pipes=Array.from({length:n-1},()=>new Pipe());
   const statuses=await Promise.all(node.commands.map(async(command,k)=>{
    const stage:IO={in:k?pipes[k-1]:io.in,out:k<n-1?pipes[k]:io.out,err:k<n-1&&node.stderrToo[k]?pipes[k]:io.err};
    try{return await this.subshell().isolated(command,stage);}
    finally{if(k<n-1)pipes[k].end();if(k>0)pipes[k-1].close();}
   }));
   status=this.opts.pipefail?[...statuses].reverse().find(s=>s!==0)??0:statuses[n-1];
  }
  if(node.negate){status=status===0?1:0;this.exempt=true;}
  if(node.time){const s=(performance.now()-started)/1000;await io.err.write(`\nreal\t${Math.floor(s/60)}m${(s%60).toFixed(3)}s\nuser\t0m0.000s\nsys\t0m0.000s\n`);}
  return status;
 }
 private async simple(node:Extract<Node,{type:'simple'}>,io:IO):Promise<number>{
  this.lineno=node.line;const substitutions=this.substitutions;
  let argv:string[],assigns:[string,string][]=[];
  try{
   argv=await this.fields(node.words,io);
   for(const a of node.assigns){const append=a.name.endsWith('+'),name=append?a.name.slice(0,-1):a.name,value=await this.expandSingle(a.value,io);assigns.push([name,append?(this.get(name)??'')+value:value]);}
  }catch(error){
   // A failed expansion (${x:?}, a bad substitution) ends a non-interactive shell; bad arithmetic fails the command.
   if(error instanceof ArithError){await io.err.write(`sh: arithmetic: ${error.message}\n`);return 1;}
   if(error instanceof ShellError){await io.err.write(`sh: ${error.message}\n`);throw new ExitSignal(error.status);}
   throw error;
  }
  const substituted=this.substitutions!==substitutions?this.status:0;
  if(!argv.length){
   for(const [k,v] of assigns)this.set(k,v);
   if(node.redirects.length){try{(await this.redirect(node.redirects,io)).close();}catch(error){if(error instanceof ShellError){await io.err.write(`sh: ${error.message}\n`);return 1;}throw error;}}
   return substituted;
  }
  if(this.opts.xtrace)await io.err.write('+ '+[...assigns.map(([k,v])=>`${k}=${quote(v)}`),...argv.map(quote)].join(' ')+'\n');
  let redirected:{io:IO;close():void};
  try{redirected=await this.redirect(node.redirects,io);}catch(error){if(error instanceof ShellError){await io.err.write(`sh: ${error.message}\n`);return 1;}throw error;}
  // `exec >log 2>&1` with no command keeps its redirects for the rest of the script.
  if(argv[0]==='exec'&&argv.length===1){this.closers.push(redirected.close);this.baseIO=redirected.io;return 0;}
  try{return await this.execArgv(argv,redirected.io,assigns);}
  finally{redirected.close();}
 }
 /** Runs one command by name: a function, a builtin, a tool or program, or a script file. */
 async execArgv(argv:string[],io:IO,assigns:[string,string][]=[],functions=true):Promise<number>{
  const [name,...args]=argv;
  if(functions&&this.functions.has(name))return this.callFunction(name,args,io,assigns);
  const builtin=builtins[name];
  if(builtin){
   // Assignments before a builtin last only for it, except before the special ones POSIX says keep them.
   const keep=SPECIAL.has(name),saved=keep?[]:assigns.map(([k])=>[k,this.vars.get(k)] as const);
   for(const [k,v] of assigns)this.set(k,v);
   try{return await builtin.call(this,args,io);}
   catch(error){if(error instanceof CommandError){await io.err.write(`sh: ${name}: ${error.message}\n`);return error.status;}if(error instanceof BrokenPipe)return 141;throw error;}
   finally{for(const [k,v] of saved){if(v)this.vars.set(k,v);else this.vars.delete(k);}}
  }
  const env=this.environment(assigns),command=this.host.commands.get(name);
  if(command)return this.runCommand(command,name,args,io,env,this.cwd);
  if(name.includes('/'))return this.runPath(name,args,io,env);
  return this.notFound(name,io);
 }
 private async callFunction(name:string,args:string[],io:IO,assigns:[string,string][]){
  if(this.depth>=200)throw new ShellError(`${name}: maximum function nesting level exceeded`);
  const saved=this.positional,frame=new Map<string,Var|undefined>();this.positional=args;this.locals.push(frame);this.depth++;
  for(const [k,v] of assigns){frame.set(k,this.vars.get(k));this.set(k,v,true);}
  try{return await this.run(this.functions.get(name)!,io);}
  catch(error){if(error instanceof ReturnSignal)return error.status;throw error;}
  finally{this.depth--;this.locals.pop();this.positional=saved;for(const [k,v] of frame){if(v)this.vars.set(k,v);else this.vars.delete(k);}}
 }
 context(name:string,args:string[],io:IO,env:Record<string,string>,cwd:string):CommandContext{
  return{
   name,args,stdin:io.in,stdout:io.out,stderr:io.err,cwd,env,fs:this.fs,signal:this.signal,host:this.host,
   resolve:path=>resolvePath(cwd,path),
   out:text=>io.out.write(text),err:text=>io.err.write(text),
   exec:(argv,o={})=>{const child=this.subshell(o.signal?AbortSignal.any([this.signal,o.signal]):this.signal);child.cwd=o.cwd??cwd;child.vars=new Map(Object.entries(o.env??env).map(([k,v])=>[k,{value:v,exported:true}]));return child.execArgv(argv,{in:o.in??io.in,out:o.out??io.out,err:o.err??io.err},[],false);},
   script:(source,o={})=>{const child=new Shell(this.fs,this.host,this.signal,{cwd:o.cwd??cwd,env:o.env??env,args:o.args,name:o.name,flags:o.flags});child.depth=this.depth+1;if(child.depth>64)throw new CommandError('too many nested shells');return child.main(source,{in:o.io?.in??io.in,out:o.io?.out??io.out,err:o.io?.err??io.err});}
  };
 }
 async runCommand(command:Command,name:string,args:string[],io:IO,env:Record<string,string>,cwd:string):Promise<number>{
  try{return await command(this.context(name,args,io,env,cwd));}
  catch(error){
   if(error instanceof BrokenPipe)return 141;
   if(this.signal.aborted)throw error;
   if(error instanceof CommandError){await io.err.write(`${name}: ${error.message}\n`).catch(()=>{});return error.status;}
   if(errorCode(error)){await io.err.write(`${name}: ${(error as Error).message}\n`).catch(()=>{});return 1;}
   await io.err.write(`${name}: ${(error as Error)?.message??error}\n`).catch(()=>{});return 1;
  }
 }
 /** ./script.sh, ./tool.py, /usr/bin/python3 and node_modules/.bin/esbuild: by shebang or by name. */
 private async runPath(name:string,args:string[],io:IO,env:Record<string,string>){
  const path=resolvePath(this.cwd,name);let stat;try{stat=this.fs.stat(path);}catch{}
  const base=basename(name),known=this.host.commands.get(base);
  if(!stat){if(known&&/(^|\/)(usr\/)?(local\/)?bin\/[^/]+$|node_modules\/\.bin\/[^/]+$/.test(name))return this.runCommand(known,base,args,io,env,this.cwd);await io.err.write(`sh: ${name}: not found\n`);return 127;}
  if(stat.type==='directory'){await io.err.write(`sh: ${name}: Permission denied\n`);return 126;}
  if(known&&/node_modules\/\.bin\//.test(name))return this.runCommand(known,base,args,io,env,this.cwd);
  const handle=this.fs.open(path,'r'),head=new Uint8Array(256);let n=0;try{n=handle.read(head,0);}finally{handle.close();}
  const first=decode(head.subarray(0,n)).split('\n')[0],shebang=first.startsWith('#!')?first.slice(2).trim().split(/\s+/):[];
  const interpreter=shebang[0]?.endsWith('/env')?shebang[1]:shebang[0]?basename(shebang[0]):'';
  const by=interpreter?interpreter.replace(/[\d.]+$/,''):/\.py$/.test(path)?'python':/\.(m?js|cjs)$/.test(path)?'node':'sh';
  if(by==='python'||by==='node'){const program=this.host.commands.get(by==='python'?'python3':'node');if(program)return this.runCommand(program,by,[path,...args],io,env,this.cwd);}
  if(['sh','bash','ash','dash','zsh'].includes(by)){
   if(n&&head.subarray(0,n).includes(0)){await io.err.write(`sh: ${name}: cannot execute binary file\n`);return 126;}
   return this.context(name,args,io,env,this.cwd).script(decode(this.fs.readFile(path)),{args,name});
  }
  await io.err.write(`sh: ${name}: ${interpreter} is not available in the browser sandbox\n`);return 126;
 }
 private async notFound(name:string,io:IO){
  const reason=this.host.unavailable[name];
  const available=[...this.host.commands.keys()].filter(n=>!/^\[/.test(n)).sort().join(', ');
  await io.err.write(reason?`sh: ${name}: ${reason}\n`:`sh: ${name}: not found. Commands run in a sandbox in the browser; available: ${available}; and the shell's own cd, echo, export, read, set, source, test, type, wait.\n`);
  return 127;
 }
 // ---------- redirects
 private async redirect(redirects:Redirect[],io:IO):Promise<{io:IO;close():void}>{
  if(!redirects.length)return{io,close(){}};
  const fds:Record<number,Input|Output>={0:io.in,1:io.out,2:io.err},closers:(()=>void)[]=[];
  const output=(path:string,append:boolean):Output=>{
   if(path==='/dev/null')return new NullOutput();if(path==='/dev/stdout'||path==='/dev/fd/1')return fds[1] as Output;if(path==='/dev/stderr'||path==='/dev/fd/2'||path==='/dev/tty')return fds[2] as Output;
   if(!path)throw new ShellError('ambiguous redirect');
   try{const out=new FileOutput(this.fs,resolvePath(this.cwd,path),append);closers.push(()=>out.close());return out;}
   catch(error){throw new ShellError(`can't create ${path}: ${errorCode(error)==='ENOENT'?'nonexistent directory':describeError(error)}`);}
  };
  try{
   for(const r of redirects){
    if(r.op==='<<'||r.op==='<<-'){fds[r.fd]=new BytesInput(encoder.encode(await this.expandSingle(r.heredoc??[],io)));continue;}
    const target=await this.expandSingle(r.target,io);
    switch(r.op){
     case'<<<':fds[r.fd]=new BytesInput(encoder.encode(target+'\n'));break;
     case'>&':case'<&':{
      if(target==='-'){fds[r.fd]=r.op==='>&'?new NullOutput():new EmptyInput();break;}
      if(/^\d+$/.test(target)){const source=fds[Number(target)];if(!source)throw new ShellError(`${target}: bad file descriptor`);fds[r.fd]=source;break;}
      if(r.op==='>&'){const out=output(target,false);fds[1]=fds[2]=out;break;}
      throw new ShellError(`${target}: bad file descriptor`);
     }
     case'&>':case'&>>':{const out=output(target,r.op==='&>>');fds[1]=fds[2]=out;break;}
     case'>':case'>|':case'>>':fds[r.fd]=output(target,r.op==='>>');break;
     case'<':case'<>':{
      if(target==='/dev/null'){fds[r.fd]=new EmptyInput();break;}if(target==='/dev/stdin'){fds[r.fd]=fds[0];break;}
      try{const input=new FileInput(this.fs,resolvePath(this.cwd,target));closers.push(()=>input.close());fds[r.fd]=input;}
      catch(error){throw new ShellError(`can't open '${target}': ${describeError(error)}`);}
      break;
     }
    }
   }
  }catch(error){closers.forEach(close=>close());throw error;}
  return{io:{in:fds[0] as Input,out:fds[1] as Output,err:fds[2] as Output},close:()=>closers.forEach(close=>close())};
 }
 // ---------- expansion
 async fields(words:Word[],io:IO):Promise<string[]>{const out:string[]=[];for(const word of words)for(const w of braces(word))out.push(...await this.expandFields(w,io));return out;}
 private async expandFields(word:Word,io:IO):Promise<string[]>{
  type Field={text:string;pat:string;glob:boolean;started:boolean};
  const fields:Field[]=[];let cur:Field={text:'',pat:'',glob:false,started:false};
  const push=()=>{if(cur.started)fields.push(cur);cur={text:'',pat:'',glob:false,started:false};};
  const ifs=this.get('IFS')??' \t\n',white=[...ifs].filter(c=>' \t\n'.includes(c)),other=[...ifs].filter(c=>!' \t\n'.includes(c));
  for(const seg of await this.segments(word,io)){
   if('at' in seg){seg.at.forEach((text,k)=>{if(k)push();cur.text+=text;cur.pat+=escapeGlob(text);cur.started=true;});continue;}
   if(seg.quoted){cur.text+=seg.text;cur.pat+=escapeGlob(seg.text);cur.started=true;continue;}
   if(!seg.split){cur.text+=seg.text;cur.pat+=seg.text;cur.glob||=hasGlob(seg.text);if(seg.text)cur.started=true;continue;}
   for(const c of seg.text){
    if(white.includes(c)){push();continue;}
    if(other.includes(c)){cur.started=true;push();continue;}
    cur.text+=c;cur.pat+=c;cur.started=true;if(c==='*'||c==='?'||c==='[')cur.glob=true;
   }
  }
  push();
  const out:string[]=[];
  for(const f of fields){if(f.glob&&!this.opts.noglob&&hasGlob(f.pat)){const matches=glob(this.fs,this.cwd,f.pat);if(matches.length){out.push(...matches);continue;}}out.push(f.text);}
  return out;
 }
 async expandSingle(word:Word,io:IO):Promise<string>{let text='';for(const seg of await this.segments(word,io))text+='at' in seg?seg.at.join(' '):seg.text;return text;}
 /** A word as a pattern: quoted parts match literally. */
 async expandPattern(word:Word,io:IO):Promise<string>{let text='';for(const seg of await this.segments(word,io))text+='at' in seg?escapeGlob(seg.at.join(' ')):seg.quoted?escapeGlob(seg.text):seg.text;return text;}
 private async segments(word:Word,io:IO):Promise<Seg[]>{
  const out:Seg[]=[];
  for(const [index,part] of word.entries()){
   switch(part.t){
    case'lit':{
     if(index===0&&part.q===0&&part.v.startsWith('~')){const m=/^~([^/]*)/.exec(part.v)!;if(!m[1]){out.push({text:this.get('HOME')??'/',quoted:true,split:false});if(part.v.length>1)out.push({text:part.v.slice(1),quoted:false,split:false});continue;}}
     out.push({text:part.v,quoted:part.q!==0,split:false});break;
    }
    case'param':{const value=await this.param(part,io);if(Array.isArray(value))out.push({at:value});else out.push({text:value,quoted:part.q,split:!part.q});break;}
    case'cmd':out.push({text:await this.substitute(part.src,io),quoted:part.q,split:!part.q});break;
    case'arith':out.push({text:String(await this.arith(part.src,io)),quoted:part.q,split:!part.q});break;
   }
  }
  return out;
 }
 private async param(part:Extract<Part,{t:'param'}>,io:IO):Promise<string|string[]>{
  const {name,op}=part,positional=name==='@'||name==='*';
  if(op==='length')return String(positional?this.positional.length:[...(this.get(name)??'')].length);
  if(op==='indirect')return this.get(this.get(name)??'')??'';
  if(positional&&!op){if(part.q&&name==='@')return[...this.positional];return this.positional.join(name==='*'?(this.get('IFS')??' ').slice(0,1):' ');}
  const value=positional?(this.positional.length?this.positional.join(' '):undefined):this.get(name);
  const arg=()=>this.expandSingle(part.arg??[],io);
  switch(op){
   case undefined:if(value===undefined&&this.opts.nounset)throw new ShellError(`${name}: parameter not set`);return value??'';
   case':-':return value===undefined||value===''?arg():value;
   case'-':return value===undefined?arg():value;
   case':=':case'=':{if(value===undefined||(op===':='&&value==='')){const v=await arg();this.set(name,v);return v;}return value;}
   case':+':return value!==undefined&&value!==''?arg():'';
   case'+':return value!==undefined?arg():'';
   case':?':case'?':{if(value===undefined||(op===':?'&&value==='')){const message=await arg();throw new ShellError(`${name}: ${message||'parameter null or not set'}`);}return value;}
   case'#':case'##':case'%':case'%%':{
    const v=value??'',re=globRegex(await this.expandPattern(part.arg??[],io),'s');
    if(op==='#'){for(let k=0;k<=v.length;k++)if(re.test(v.slice(0,k)))return v.slice(k);}
    if(op==='##'){for(let k=v.length;k>=0;k--)if(re.test(v.slice(0,k)))return v.slice(k);}
    if(op==='%'){for(let k=v.length;k>=0;k--)if(re.test(v.slice(k)))return v.slice(0,k);}
    if(op==='%%'){for(let k=0;k<=v.length;k++)if(re.test(v.slice(k)))return v.slice(0,k);}
    return v;
   }
   case'/':case'//':case'/#':case'/%':{
    const v=value??'',pattern=await this.expandPattern(part.arg??[],io);if(!pattern)return v;
    const replacement=await this.expandSingle(part.arg2??[],io),source=globSource(pattern);
    const re=new RegExp(op==='/#'?'^(?:'+source+')':op==='/%'?'(?:'+source+')$':source,op==='//'?'gs':'s');return v.replace(re,()=>replacement);
   }
   case'substr':{
    const v=[...(value??'')],offset=await this.arith(await arg(),io,true),start=offset<0?Math.max(0,v.length+offset):Math.min(offset,v.length);
    if(!part.arg2)return v.slice(start).join('');const length=await this.arith(await this.expandSingle(part.arg2,io),io,true);
    return v.slice(start,length<0?v.length+length:start+length).join('');
   }
   case'^^':return(value??'').toUpperCase();case',,':return(value??'').toLowerCase();
   case'^':{const v=value??'';return v.slice(0,1).toUpperCase()+v.slice(1);}
   case',':{const v=value??'';return v.slice(0,1).toLowerCase()+v.slice(1);}
  }
  throw new ShellError(`\${${name}${op}}: bad substitution`);
 }
 private async substitute(source:string,io:IO):Promise<string>{
  const out=new StringOutput(),child=this.subshell();child.depth=this.depth+1;if(child.depth>64)throw new ShellError('command substitution nested too deeply');
  let status:number;try{status=await child.isolated(parse(source),{in:io.in,out,err:io.err});}catch(error){if(error instanceof ShellSyntaxError){await io.err.write(error.message+'\n');status=2;}else throw error;}
  this.status=status;this.substitutions++;return out.text().replace(/\n+$/,'');
 }
 private async arith(source:string,io:IO,expanded=false):Promise<number>{
  const text=expanded?source:await this.expandSingle(parseQuoted(source),io);
  return arithmetic(text,{get:name=>this.get(name),set:(name,value)=>this.set(name,value)});
 }
 private async waitJobs(){let status=0;while(this.jobs.length){const jobs=this.jobs.splice(0);for(const job of jobs)status=await job;}return status;}
 // builtins reach these
 /** @internal */ _locals(){return this.locals;}
 /** @internal */ _jobs(){return this.waitJobs();}
 /** @internal */ _traps(){return this.traps;}
 /** @internal */ _setFlag(flag:string,on:boolean){this.setFlag(flag,on);}
 /** @internal */ async _eval(source:string,io:IO){return this.run(parse(source),io);}
}

const quote=(s:string)=>/^[\w@%+=:,./-]+$/.test(s)?s:`'${s.replace(/'/g,`'\\''`)}'`;
/** {a,b,c} and {1..5} in unquoted text, as bash does (BusyBox ash does not, but models write it). */
function braces(word:Word):Word[]{
 for(const [index,part] of word.entries()){
  if(part.t!=='lit'||part.q!==0)continue;
  const v=part.v;
  for(let start=v.indexOf('{');start>=0;start=v.indexOf('{',start+1)){
   let depth=0,end=-1;const commas:number[]=[];
   for(let k=start;k<v.length;k++){if(v[k]==='{')depth++;else if(v[k]==='}'){depth--;if(depth===0){end=k;break;}}else if(v[k]===','&&depth===1)commas.push(k);}
   if(end<0)break;
   const inner=v.slice(start+1,end);let items:string[]|null=null;
   if(commas.length){items=[];let from=start+1;for(const c of[...commas,end]){items.push(v.slice(from,c));from=c+1;}}
   else{const m=/^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(inner)??/^([a-zA-Z])\.\.([a-zA-Z])$/.exec(inner);
    if(m){const numeric=/\d/.test(m[1]),a=numeric?Number(m[1]):m[1].charCodeAt(0),b=numeric?Number(m[2]):m[2].charCodeAt(0),step=Math.abs(Number(m[3]??1))||1,width=numeric&&/^-?0\d/.test(m[1])?m[1].length:0;items=[];
     for(let x=a;a<=b?x<=b:x>=b;x+=a<=b?step:-step){if(items.length>100000)break;items.push(numeric?String(x).padStart(width,'0'):String.fromCharCode(x));}}}
   if(!items)continue;
   const out:Word[]=[];
   for(const item of items){const copy=structuredClone(word);(copy[index] as {v:string}).v=v.slice(0,start)+item+v.slice(end+1);out.push(...braces(copy));}
   return out;
  }
 }
 return[word];
}
const SPECIAL=new Set([':','.','source','eval','exec','exit','export','readonly','return','set','shift','trap','unset','break','continue','local']);
type Builtin=(this:Shell,args:string[],io:IO)=>Promise<number>;
const out=(io:IO,text:string)=>io.out.write(text);
function echoEscapes(text:string):{text:string;stop:boolean}{
 let result='',stop=false;
 for(let i=0;i<text.length;i++){
  if(text[i]!=='\\'||i===text.length-1){result+=text[i];continue;}
  const c=text[++i];
  switch(c){
   case'n':result+='\n';break;case't':result+='\t';break;case'r':result+='\r';break;case'\\':result+='\\';break;case'a':result+='\x07';break;case'b':result+='\b';break;
   case'e':result+='\x1b';break;case'f':result+='\f';break;case'v':result+='\v';break;case'c':stop=true;return{text:result,stop};
   case'0':{const m=/^[0-7]{0,3}/.exec(text.slice(i+1))![0];result+=String.fromCharCode(parseInt(m||'0',8));i+=m.length;break;}
   case'x':{const m=/^[0-9a-fA-F]{1,2}/.exec(text.slice(i+1))?.[0];if(m){result+=String.fromCharCode(parseInt(m,16));i+=m.length;}else result+='\\x';break;}
   default:result+='\\'+c;
  }
 }
 return{text:result,stop};
}
export {echoEscapes};
const builtins:Record<string,Builtin>={
 ':':async()=>0,true:async()=>0,false:async()=>1,
 async echo(args,io){
  let newline=true,escapes=false,i=0;
  for(;i<args.length&&/^-[neE]+$/.test(args[i]);i++)for(const f of args[i].slice(1)){if(f==='n')newline=false;else if(f==='e')escapes=true;else escapes=false;}
  let text=args.slice(i).join(' ');if(escapes){const r=echoEscapes(text);text=r.text;if(r.stop)newline=false;}
  await out(io,newline?text+'\n':text);return 0;
 },
 async cd(args,io){
  const list=args.filter(a=>a!=='-L'&&a!=='-P');let target=list[0]??this.get('HOME')??'/';
  if(target==='-'){target=this.get('OLDPWD')??this.cwd;await out(io,target+'\n');}
  const full=resolvePath(this.cwd,target);let stat;try{stat=this.fs.stat(full);}catch{}
  if(stat?.type!=='directory'){await io.err.write(`sh: cd: can't cd to ${target}: ${stat?'Not a directory':'No such file or directory'}\n`);return 1;}
  this.set('OLDPWD',this.cwd,true);this.cwd=full;this.set('PWD',full,true);return 0;
 },
 async pwd(_args,io){await out(io,this.cwd+'\n');return 0;},
 async export(args,io){
  let unexport=false;const names=args.filter(a=>{if(a==='-n'){unexport=true;return false;}return a!=='-p';});
  if(!names.length){for(const [k,v] of[...this.vars].sort())if(v.exported)await out(io,`export ${k}=${quote(v.value)}\n`);return 0;}
  for(const a of names){const eq=a.indexOf('=');const name=eq<0?a:a.slice(0,eq);if(eq>=0)this.set(name,a.slice(eq+1),!unexport);else{const v=this.vars.get(name);if(v)v.exported=!unexport;else if(!unexport)this.vars.set(name,{value:'',exported:true});}}
  return 0;
 },
 async readonly(args){for(const a of args.filter(a=>!a.startsWith('-'))){const eq=a.indexOf('=');if(eq>=0)this.set(a.slice(0,eq),a.slice(eq+1));}return 0;},
 async unset(args){
  let mode:'v'|'f'|''='';for(const a of args){if(a==='-f'){mode='f';continue;}if(a==='-v'){mode='v';continue;}if(mode!=='f'&&this.vars.has(a))this.vars.delete(a);else if(mode!=='v')this.functions.delete(a);}
  return 0;
 },
 async set(args,io){
  if(!args.length){for(const [k,v] of[...this.vars].sort())await out(io,`${k}=${quote(v.value)}\n`);return 0;}
  for(let i=0;i<args.length;i++){
   const a=args[i];
   if(a==='--'){this.positional=args.slice(i+1);return 0;}
   if(a==='-o'||a==='+o'){const opt=args[++i];const on=a==='-o';if(opt==='pipefail')this.opts.pipefail=on;else if(opt==='errexit')this.opts.errexit=on;else if(opt==='nounset')this.opts.nounset=on;else if(opt==='xtrace')this.opts.xtrace=on;else if(opt==='noglob')this.opts.noglob=on;continue;}
   if(/^[-+][a-zA-Z]+$/.test(a)){for(const f of a.slice(1))this._setFlag(f,a[0]==='-');continue;}
   this.positional=args.slice(i);return 0;
  }
  return 0;
 },
 async shift(args){const n=args[0]?Number(args[0]):1;if(!(n>=0)||n>this.positional.length)return 1;this.positional=this.positional.slice(n);return 0;},
 async exit(args){throw new ExitSignal(args[0]!==undefined?(Number(args[0])&255):this.status);},
 async return(args){throw new ReturnSignal(args[0]!==undefined?(Number(args[0])&255):this.status);},
 async break(args){throw new LoopSignal('break',Math.max(1,Number(args[0]??1)));},
 async continue(args){throw new LoopSignal('continue',Math.max(1,Number(args[0]??1)));},
 async local(args){
  const frame=this._locals().at(-1);if(!frame)throw new CommandError('not in a function');
  for(const a of args.filter(a=>!a.startsWith('-'))){const eq=a.indexOf('='),name=eq<0?a:a.slice(0,eq);if(!frame.has(name))frame.set(name,this.vars.get(name)&&{...this.vars.get(name)!});this.set(name,eq<0?this.get(name)??'':a.slice(eq+1));}
  return 0;
 },
 async read(args,io){
  let raw=false,prompt='';const names:string[]=[];
  for(let i=0;i<args.length;i++){const a=args[i];if(a==='-r'){raw=true;continue;}if(a==='-p'){prompt=args[++i]??'';continue;}if(a==='-s')continue;if(a.startsWith('-')&&a.length>1)continue;names.push(a);}
  if(prompt)await io.err.write(prompt);
  let line=await io.in.readLine();const eof=line===null;line??='';
  if(!raw){while(line.endsWith('\\')&&!eof){const next=await io.in.readLine();if(next===null)break;line=line.slice(0,-1)+next;}line=line.replace(/\\(.)/g,'$1');}
  line=line.replace(/\r$/,'');
  if(!names.length){this.set('REPLY',line);return eof?1:0;}
  // IFS whitespace around fields is dropped; other IFS characters each end one field; the last name takes the rest.
  const ifs=this.get('IFS')??' \t\n',white=(c:string)=>' \t\n'.includes(c)&&ifs.includes(c),n=line.length;let i=0;
  const skip=()=>{while(i<n&&white(line![i]))i++;};skip();
  for(const [k,name] of names.entries()){
   if(k===names.length-1){let end=n;while(end>i&&white(line[end-1]))end--;this.set(name,line.slice(i,end));break;}
   const start=i;while(i<n&&!ifs.includes(line[i]))i++;this.set(name,line.slice(start,i));
   skip();if(i<n&&ifs.includes(line[i])&&!white(line[i])){i++;skip();}
  }
  return eof?1:0;
 },
 async eval(args,io){const source=args.join(' ');if(!source.trim())return 0;return this._eval(source,io);},
 async source(args,io){
  if(!args[0])throw new CommandError('filename argument required',2);
  const path=resolvePath(this.cwd,args[0]);let text:string;try{text=decode(this.fs.readFile(path));}catch(error){throw new CommandError(`can't open '${args[0]}': ${describeError(error)}`,1);}
  const saved=this.positional;if(args.length>1)this.positional=args.slice(1);
  try{return await this._eval(text,io);}catch(error){if(error instanceof ReturnSignal)return error.status;throw error;}finally{if(args.length>1)this.positional=saved;}
 },
 async exec(args,io){const status=await this.execArgv(args,io);throw new ExitSignal(status);},
 async wait(){return this._jobs();},
 async type(args,io){
  let status=0;
  for(const name of args.filter(a=>!a.startsWith('-'))){
   if(this.functions.has(name))await out(io,`${name} is a function\n`);else if(builtins[name])await out(io,`${name} is a shell builtin\n`);
   else if(this.host.commands.has(name))await out(io,`${name} is /usr/bin/${name}\n`);else{await io.err.write(`sh: type: ${name}: not found\n`);status=1;}
  }
  return status;
 },
 async command(args,io){
  if(args[0]==='-v'||args[0]==='-V'){
   let status=0;for(const name of args.slice(1)){if(this.functions.has(name)||builtins[name])await out(io,args[0]==='-v'?name+'\n':`${name} is a shell builtin\n`);else if(this.host.commands.has(name))await out(io,args[0]==='-v'?`/usr/bin/${name}\n`:`${name} is /usr/bin/${name}\n`);else status=1;}
   return status;
  }
  const rest=args[0]==='-p'?args.slice(1):args;if(!rest.length)return 0;return this.execArgv(rest,io,[],false);
 },
 async trap(args,io){
  if(!args.length){for(const [k,v] of Object.entries(this._traps()))await out(io,`trap -- ${quote(v)} ${k}\n`);return 0;}
  const [action,...signals]=args.length===1?['-',...args]:args;
  for(const s of signals){const name=s==='0'?'EXIT':s.replace(/^SIG/,'');if(name!=='EXIT')continue;if(action==='-'||action==='')delete this._traps().EXIT;else this._traps().EXIT=action;}
  return 0;
 },
 async let(args){let v=0;for(const a of args)v=arithmetic(a,{get:n=>this.get(n),set:(n,x)=>this.set(n,x)});return v!==0?0:1;},
 async umask(args,io){if(!args.length)await out(io,'0022\n');return 0;},
 alias:async()=>0,unalias:async()=>0,hash:async()=>0,ulimit:async()=>0,shopt:async()=>0,disown:async()=>0,
 async times(_args,io){await out(io,'0m0.000s 0m0.000s\n0m0.000s 0m0.000s\n');return 0;}
};
builtins['.']=builtins.source;
export const builtinNames=Object.keys(builtins);
