import {CommandError,type Command} from '../shell/types';
import {parseArgs} from './common';
import {posixRegex} from './regex';
import {escapeRegex,globRegex} from '../shell/pattern';
import {FileInput,Input} from '../shell/io';
import {describeError} from '../fs/types';
import {decode} from '../fs/util';
import {join} from '../path';

const spec={flags:'ivnclLrREFGPwxoqshHaIbzZUy',values:'efABCmd',lists:'ef',long:{'ignore-case':'i','invert-match':'v','line-number':'n',count:'c','files-with-matches':'l','files-without-match':'L',recursive:'r','dereference-recursive':'R','extended-regexp':'E','fixed-strings':'F','basic-regexp':'G','perl-regexp':'P','word-regexp':'w','line-regexp':'x','only-matching':'o',quiet:'q',silent:'q','no-messages':'s','no-filename':'h','with-filename':'H',text:'a','byte-offset':'b','null-data':'z',null:'Z','regexp=':'e','file=':'f','after-context=':'A','before-context=':'B','context=':'C','max-count=':'m','include=':'include','exclude=':'exclude','exclude-dir=':'excludeDir',color:'color','colour':'color','color=':'color','colour=':'color','line-buffered':'lineBuffered','label=':'label','binary-files=':'binaryFiles','devices=':'d'}};
/** grep with the GNU flags people pass: -rnoiwvlcqE, context lines, --include, several -e patterns. */
export const grep:Command=async ctx=>{
 const args=ctx.args.map(a=>/^-\d+$/.test(a)?'-C'+a.slice(1):a);
 const {opts,rest}=parseArgs('grep',args,spec as never);
 const extended=ctx.name==='egrep'||!!opts.E,fixed=ctx.name==='fgrep'||!!opts.F,perl=!!opts.P;
 const patterns:string[]=[...((opts.e as string[]|undefined)??[])];
 for(const file of (opts.f as string[]|undefined)??[]){try{patterns.push(...decode(ctx.fs.readFile(ctx.resolve(file))).split('\n').filter((l,k,a)=>k<a.length-1||l));}catch(error){throw new CommandError(`${file}: ${describeError(error)}`,2);}}
 if(!opts.e&&!opts.f){if(!rest.length)throw new CommandError('usage: grep [OPTION]... PATTERNS [FILE]...',2);patterns.push(...rest.shift()!.split('\n'));}
 const sources=patterns.map(p=>fixed?escapeRegex(p):perl?p:posixRegex(p,extended));
 let source=sources.length===1?sources[0]:sources.map(s=>`(?:${s})`).join('|');
 if(opts.x)source=`^(?:${source})$`;else if(opts.w)source=`(?<![\\w])(?:${source})(?![\\w])`;
 let re:RegExp;try{re=new RegExp(source,(opts.i||opts.y?'i':'')+'gu');}catch{try{re=new RegExp(source,(opts.i||opts.y?'i':'')+'g');}catch(error){throw new CommandError(`invalid regular expression: ${(error as Error).message}`,2);}}
 const recursive=!!(opts.r||opts.R),files=rest.length?rest:recursive?['.']:['-'];
 const showNames=opts.H||(!opts.h&&(files.length>1||recursive));
 const after=Number(opts.A??opts.C??0),before=Number(opts.B??opts.C??0),max=opts.m!==undefined?Number(opts.m):Infinity;
 const include=opts.include?globRegex(String(opts.include)):null,exclude=opts.exclude?globRegex(String(opts.exclude)):null,excludeDir=opts.excludeDir?globRegex(String(opts.excludeDir)):null;
 let matchedAny=false,error=false;
 const test=(line:string)=>{re.lastIndex=0;return re.test(line);};
 const searchOne=async(name:string,input:Input,binary:boolean)=>{
  let count=0,lineNo=0,byte=0,lastPrinted=0,pendingAfter=0;const ring:{line:string;no:number;byte:number}[]=[];const label=name==='-'?String(opts.label??'(standard input)'):name;
  const prefix=(no:number,offset:number,sep:string)=>(showNames?label+(opts.Z?'\0':sep):'')+(opts.n?no+sep:'')+(opts.b?offset+sep:'');
  const print=async(line:string,no:number,offset:number,sep:string)=>{if(lastPrinted&&no>lastPrinted+1&&(before||after))await ctx.out('--\n');await ctx.out(prefix(no,offset,sep)+line+'\n');lastPrinted=no;};
  const lines=opts.z?splitNull(input):input.lines();
  for await(const line of lines){
   lineNo++;const offset=byte;byte+=new TextEncoder().encode(line).length+1;
   const hit=test(line)!==!!opts.v;
   if(hit){
    count++;matchedAny=true;
    if(opts.q)return count;
    if(opts.l||opts.L)break;
    if(!opts.c){
     if(binary&&!opts.a){await ctx.out(`Binary file ${label} matches\n`);return count;}
     for(const r of ring)await print(r.line,r.no,r.byte,'-');ring.length=0;
     if(opts.o&&!opts.v){re.lastIndex=0;for(const m of line.matchAll(re))if(m[0])await ctx.out(prefix(lineNo,offset+m.index!,':')+m[0]+'\n');lastPrinted=lineNo;}
     else await print(line,lineNo,offset,':');
     pendingAfter=after;
    }
    if(count>=max)break;
   }else if(!opts.c&&!opts.l&&!opts.L){
    if(pendingAfter>0){pendingAfter--;await print(line,lineNo,offset,'-');}
    else if(before){ring.push({line,no:lineNo,byte:offset});if(ring.length>before)ring.shift();}
   }
  }
  if(opts.c)await ctx.out((showNames?label+':':'')+count+'\n');
  if(opts.l&&count)await ctx.out(label+(opts.Z?'\0':'\n'));
  if(opts.L&&!count)await ctx.out(label+(opts.Z?'\0':'\n'));
  return count;
 };
 const visit=async(file:string):Promise<boolean>=>{
  if(file==='-'){await searchOne('-',ctx.stdin,false);return opts.q?matchedAny:false;}
  const path=ctx.resolve(file);let stat;
  try{stat=ctx.fs.stat(path);}catch(e){if(!opts.s)await ctx.err(`grep: ${file}: ${describeError(e)}\n`);error=true;return false;}
  if(stat.type==='directory'){
   if(!recursive){if(!opts.s)await ctx.err(`grep: ${file}: Is a directory\n`);return false;}
   for(const name of ctx.fs.readdir(path)){
    // Names print as GNU grep prints them: "sub/a.js" for a bare -r, "./sub/a.js" under an explicit ".".
    const child=file==='.'&&!rest.length?name:(file.endsWith('/')?file:file+'/')+name;let s;try{s=ctx.fs.stat(ctx.resolve(child));}catch{continue;}
    if(s.type==='directory'){if(excludeDir?.test(name))continue;}else{if(include&&!include.test(name))continue;if(exclude?.test(name))continue;}
    if(await visit(child))return true;
   }
   return false;
  }
  if(include&&!include.test(file.split('/').pop()!)&&rest.includes(file)===false)return false;
  const input=new FileInput(ctx.fs,path);
  try{
   const head=await input.read();const binary=!!head&&head.subarray(0,8192).includes(0);
   if(binary&&opts.I)return false;
   const replay=new PrefixedInput(head,input);await searchOne(file,replay,binary);
  }finally{input.close();}
  return!!opts.q&&matchedAny;
 };
 for(const file of files){if(await visit(file))break;if(ctx.signal.aborted)break;}
 return opts.q&&matchedAny?0:error&&!(opts.q&&matchedAny)?2:matchedAny?0:1;
};
/** An input whose first chunk was already read (to sniff for binary data). */
class PrefixedInput extends Input{
 constructor(private first:Uint8Array|null,private inner:Input){super();}
 protected async pull(){if(this.first){const f=this.first;this.first=null;return f;}return this.inner.read();}
}
async function*splitNull(input:Input){const text=await input.text();const parts=text.split('\0');if(parts.at(-1)==='')parts.pop();yield*parts;}
export const grepTools:Record<string,Command>={grep,egrep:grep,fgrep:grep};
