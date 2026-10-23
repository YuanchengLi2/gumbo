import {CommandError,type Command,type CommandContext} from '../shell/types';
import {parseArgs,inputs,allLines,count} from './common';
import {format,escape,numberArg} from './format';
import {compileRegex} from './regex';
import {posixClasses} from '../shell/pattern';
import {FileOutput,type Output} from '../shell/io';
import {encoder,decode} from '../fs/util';
import {describeError} from '../fs/types';

const cat:Command=async ctx=>{
 const {opts,rest}=parseArgs('cat',ctx.args,{flags:'nbsEAvTuet',long:{number:'n','number-nonblank':'b','squeeze-blank':'s','show-ends':'E','show-all':'A','show-tabs':'T'}});
 const state={status:0},ends=opts.E||opts.A||opts.e,tabs=opts.T||opts.A||opts.t;
 if(!opts.n&&!opts.b&&!opts.s&&!ends&&!tabs){for await(const {input} of inputs(ctx,rest,state))for await(const chunk of input.chunks())await ctx.stdout.write(chunk);return state.status;}
 let n=0,blank=false;
 for await(let line of allLines(ctx,rest,state)){
  if(opts.s&&!line){if(blank)continue;blank=true;}else blank=false;
  if(tabs)line=line.replace(/\t/g,'^I');if(ends)line+='$';
  if(opts.b?line!==''&&line!=='$':opts.n)line=String(++n).padStart(6)+'\t'+line;
  await ctx.out(line+'\n');
 }
 return state.status;
};
/** Lines or bytes from the start; -n -K means all but the last K. */
const head:Command=async ctx=>{
 const {opts,rest}=parseArgs('head',ctx.args,{flags:'qv',values:'nc',numeric:'n',long:{lines:'n',bytes:'c',quiet:'q',silent:'q',verbose:'v'}});
 const state={status:0},files=rest.length?rest:['-'];let first=true;
 for await(const {name,input} of inputs(ctx,rest,state)){
  if((files.length>1&&!opts.q)||opts.v){await ctx.out(`${first?'':'\n'}==> ${name==='-'?'standard input':name} <==\n`);}first=false;
  if(opts.c){const {sign,n}=count(String(opts.c),'bytes');const data=await input.readAll();await ctx.stdout.write(sign==='-'?data.subarray(0,Math.max(0,data.length-n)):data.subarray(0,n));continue;}
  const {sign,n}=count(String(opts.n??'10'),'lines');
  if(sign==='-'){const lines:string[]=[];for await(const line of input.lines())lines.push(line);for(const line of lines.slice(0,Math.max(0,lines.length-n)))await ctx.out(line+'\n');continue;}
  let k=0;if(n===0)continue;
  for await(const line of input.lines()){await ctx.out(line+'\n');if(++k>=n)break;}
 }
 return state.status;
};
/** Lines or bytes from the end; +K starts at line K. */
const tail:Command=async ctx=>{
 // The old form `tail +5 file` means from line 5; after -n or -c a +N is that option's value.
 const args=ctx.args.map((a,i)=>/^\+\d+$/.test(a)&&!/^-[nc]$|^--(lines|bytes)$/.test(ctx.args[i-1]??'')?'-n'+a:a);
 const {opts,rest}=parseArgs('tail',args,{flags:'qvfFr',values:'ncs',numeric:'n',long:{lines:'n',bytes:'c',quiet:'q',silent:'q',verbose:'v',follow:'f',retry:'F','sleep-interval':'s','pid=':'pid'}});
 const state={status:0},files=rest.length?rest:['-'];let first=true;
 for await(const {name,input} of inputs(ctx,rest,state)){
  if((files.length>1&&!opts.q)||opts.v){await ctx.out(`${first?'':'\n'}==> ${name==='-'?'standard input':name} <==\n`);}first=false;
  if(opts.c){const {sign,n}=count(String(opts.c),'bytes');const data=await input.readAll();await ctx.stdout.write(sign==='+'?data.subarray(Math.max(0,n-1)):data.subarray(Math.max(0,data.length-n)));continue;}
  const {sign,n}=count(String(opts.n??'10'),'lines');
  if(sign==='+'){let k=0;for await(const line of input.lines())if(++k>=n)await ctx.out(line+'\n');continue;}
  const ring:string[]=[];for await(const line of input.lines()){ring.push(line);if(ring.length>n)ring.shift();}
  if(opts.r)ring.reverse();if(n>0)await ctx.out(ring.join('\n')+(ring.length?'\n':''));
 }
 return state.status;
};
const wc:Command=async ctx=>{
 const {opts,rest}=parseArgs('wc',ctx.args,{flags:'lwcmL',long:{lines:'l',words:'w',bytes:'c',chars:'m','max-line-length':'L'}});
 const pick=opts.l||opts.w||opts.c||opts.m||opts.L?opts:{l:true,w:true,c:true};const state={status:0},rows:[number[],string][]=[],total=[0,0,0,0,0];
 for await(const {name,input} of inputs(ctx,rest,state)){
  let lines=0,words=0,bytes=0,chars=0,longest=0,inWord=false,lineLength=0;const decoder=new TextDecoder();
  for await(const chunk of input.chunks()){
   bytes+=chunk.length;const text=decoder.decode(chunk,{stream:true});chars+=[...text].length;
   for(const c of text){if(c==='\n'){lines++;longest=Math.max(longest,lineLength);lineLength=0;}else lineLength++;const space=c===' '||c==='\n'||c==='\t'||c==='\r'||c==='\v'||c==='\f';if(space)inWord=false;else if(!inWord){inWord=true;words++;}}
  }
  longest=Math.max(longest,lineLength);const row=[lines,words,chars,bytes,longest];row.forEach((v,k)=>total[k]=k===4?Math.max(total[k],v):total[k]+v);rows.push([row,name==='-'?'':name]);
 }
 if(rows.length>1)rows.push([total,'total']);
 const columns=(row:number[])=>[pick.l&&row[0],pick.w&&row[1],pick.m&&row[2],pick.c&&row[3],pick.L&&row[4]].filter(v=>v!==false&&v!==undefined) as number[];
 const single=rows.length===1&&columns(rows[0][0]).length===1,width=single?0:Math.max(1,...rows.flatMap(([row])=>columns(row).map(v=>String(v).length)));
 for(const [row,name] of rows)await ctx.out(columns(row).map(v=>String(v).padStart(width)).join(' ')+(name?' '+name:'')+'\n');
 return state.status;
};
/** sort with keys: -k F[.C][flags][,F[.C][flags]], -t, -n -g -h -V -M -f -r -u -b -s, -o, -c. */
const sort:Command=async ctx=>{
 const {opts,rest}=parseArgs('sort',ctx.args,{flags:'nrufbghVMscCRdiz',values:'ktoST',lists:'k',long:{numeric:'n','numeric-sort':'n',reverse:'r',unique:'u','ignore-case':'f','ignore-leading-blanks':'b','general-numeric-sort':'g','human-numeric-sort':'h','version-sort':'V','month-sort':'M',stable:'s',check:'c','random-sort':'R','dictionary-order':'d','zero-terminated':'z','key=':'k','field-separator=':'t','output=':'o','buffer-size=':'S','temporary-directory=':'T','parallel=':'parallel'}});
 const state={status:0},lines:string[]=[];
 for await(const {input} of inputs(ctx,rest,state)){if(opts.z){for(const part of(await input.text()).split('\0'))lines.push(part);if(lines.at(-1)==='')lines.pop();}else for await(const line of input.lines())lines.push(line);}
 const sep=opts.t as string|undefined;if(sep!==undefined&&sep.length!==1&&sep!=='\\0')throw new CommandError('multi-character tab',2);
 const global={n:!!opts.n,r:!!opts.r,f:!!opts.f,b:!!opts.b,g:!!opts.g,h:!!opts.h,V:!!opts.V,M:!!opts.M,d:!!opts.d,R:!!opts.R};
 type Key={f1:number;c1:number;f2:number;c2:number;flags:typeof global};
 const keys:Key[]=((opts.k as string[]|undefined)??[]).map(spec=>{
  const m=/^(\d+)(?:\.(\d+))?([bdfgiMhnRrV]*)(?:,(\d+)(?:\.(\d+))?([bdfgiMhnRrV]*))?$/.exec(spec);if(!m)throw new CommandError(`invalid key specification '${spec}'`,2);
  const own=(m[3]??'')+(m[6]??''),flags=own?Object.fromEntries(Object.keys(global).map(k=>[k,own.includes(k)])) as typeof global:global;
  return{f1:Number(m[1]),c1:Number(m[2]??1),f2:m[4]?Number(m[4]):Infinity,c2:m[5]?Number(m[5]):0,flags};
 });
 const fields=(line:string)=>{if(sep!==undefined){const parts=line.split(sep);let at=0;return parts.map(p=>{const r={text:p,start:at};at+=p.length+1;return r;});}const out:{text:string;start:number}[]=[];const re=/\s*\S+/g;let m;while((m=re.exec(line)))out.push({text:m[0],start:m.index});return out;};
 const keyText=(line:string,key:Key)=>{
  const f=fields(line);if(key.f1>f.length)return'';const startField=f[key.f1-1];let start=startField.start;
  let lead=startField.text;if(key.flags.b||sep===undefined&&key.flags.b)lead=lead.replace(/^\s+/,'');start+=startField.text.length-lead.length+key.c1-1;
  let end:number;if(key.f2===Infinity||key.f2>f.length)end=line.length;else{const e=f[key.f2-1];end=key.c2?e.start+(key.flags.b?e.text.length-e.text.replace(/^\s+/,'').length:0)+key.c2:e.start+e.text.length;}
  return line.slice(start,Math.max(start,end));
 };
 const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
 const human=(s:string)=>{const m=/^\s*([-+]?\d*\.?\d+)\s*([kKMGTPE]?)/.exec(s);if(!m)return-Infinity;return Number(m[1])*1024**(' KMGTPE'.indexOf(m[2].toUpperCase())>0?' KMGTPE'.indexOf(m[2].toUpperCase()):0);};
 const numeric=(s:string)=>{const m=/^\s*[-+]?(\d+\.?\d*|\.\d+)/.exec(s);return m?Number(m[0]):0;};
 const version=(a:string,b:string)=>{const pa=a.match(/\d+|\D+/g)??[],pb=b.match(/\d+|\D+/g)??[];for(let i=0;i<Math.max(pa.length,pb.length);i++){const x=pa[i]??'',y=pb[i]??'';if(x===y)continue;if(/^\d/.test(x)&&/^\d/.test(y))return Number(x)-Number(y)||x.length-y.length;return x<y?-1:1;}return 0;};
 const compareBy=(a:string,b:string,flags:typeof global)=>{
  if(flags.b){a=a.replace(/^\s+/,'');b=b.replace(/^\s+/,'');}
  if(flags.d){a=a.replace(/[^\w\s]/g,'');b=b.replace(/[^\w\s]/g,'');}
  let r:number;
  if(flags.n)r=numeric(a)-numeric(b);
  else if(flags.g){const x=Number.parseFloat(a),y=Number.parseFloat(b);r=(isNaN(x)?-Infinity:x)-(isNaN(y)?-Infinity:y);if(isNaN(r))r=0;}
  else if(flags.h)r=human(a)-human(b);
  else if(flags.V)r=version(a,b);
  else if(flags.M)r=months.indexOf(a.trim().slice(0,3).toLowerCase())-months.indexOf(b.trim().slice(0,3).toLowerCase());
  else{if(flags.f){a=a.toUpperCase();b=b.toUpperCase();}r=a<b?-1:a>b?1:0;}
  return flags.r?-r:r;
 };
 const compare=(a:string,b:string)=>{
  for(const key of keys){const r=compareBy(keyText(a,key),keyText(b,key),key.flags);if(r)return r;}
  if(!keys.length){const r=compareBy(a,b,global);if(r)return r;if(global.n||global.g||global.h||global.f||global.M)return opts.s||opts.u?0:global.r?(a<b?1:a>b?-1:0):(a<b?-1:a>b?1:0);return 0;}
  if(opts.s||opts.u)return 0;return global.r?(a<b?1:a>b?-1:0):(a<b?-1:a>b?1:0);
 };
 if(opts.c||opts.C){for(let i=1;i<lines.length;i++){const r=compare(lines[i-1],lines[i]);if(r>0||(opts.u&&r===0)){if(!opts.C)await ctx.err(`sort: -:${i+1}: disorder: ${lines[i]}\n`);return 1;}}return 0;}
 if(global.R){for(let i=lines.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[lines[i],lines[j]]=[lines[j],lines[i]];}}else lines.sort(compare);
 let sorted=lines;if(opts.u)sorted=lines.filter((line,i)=>i===0||compare(lines[i-1],line)!==0);
 const end=opts.z?'\0':'\n',text=sorted.map(l=>l+end).join('');
 if(opts.o){const out=new FileOutput(ctx.fs,ctx.resolve(String(opts.o)),false);try{await out.write(text);}finally{out.close();}}else await ctx.out(text);
 return state.status;
};
const uniq:Command=async ctx=>{
 const {opts,rest}=parseArgs('uniq',ctx.args,{flags:'cduiDz',values:'fsw',long:{count:'c',repeated:'d',unique:'u','ignore-case':'i','skip-fields=':'f','skip-chars=':'s','check-chars=':'w','all-repeated':'D'}});
 const skipFields=Number(opts.f??0),skipChars=Number(opts.s??0),check=opts.w!==undefined?Number(opts.w):Infinity;
 const key=(line:string)=>{let s=line;for(let k=0;k<skipFields;k++)s=s.replace(/^\s*\S+/,'');s=s.slice(skipChars).slice(0,check);return opts.i?s.toLowerCase():s;};
 const state={status:0};let out:Output=ctx.stdout,file:FileOutput|undefined;
 if(rest[1]){file=new FileOutput(ctx.fs,ctx.resolve(rest[1]),false);out=file;}
 try{
  let prev:string|null=null,prevKey='',n=0;const group:string[]=[];
  const flush=async()=>{if(prev===null)return;if((opts.d||opts.D)&&n<2)return;if(opts.u&&n>1)return;if(opts.D){for(const l of group)await out.write(l+'\n');return;}await out.write(opts.c?`${String(n).padStart(7)} ${prev}\n`:prev+'\n');};
  for await(const line of allLines(ctx,rest.slice(0,1),state)){const k=key(line);if(prev!==null&&k===prevKey){n++;if(opts.D)group.push(line);continue;}await flush();prev=line;prevKey=k;n=1;group.length=0;group.push(line);}
  await flush();
 }finally{file?.close();}
 return state.status;
};
/** A list like 1,3-5,7- as a membership test (1-based). */
function ranges(list:string,what:string){
 const parts=list.split(/[,\s]+/).filter(Boolean).map(p=>{const m=/^(\d*)(-?)(\d*)$/.exec(p);if(!m||(!m[1]&&!m[3]))throw new CommandError(`invalid ${what} list '${list}'`,2);const a=m[1]?Number(m[1]):1,b=m[2]?m[3]?Number(m[3]):Infinity:a;if(a<1)throw new CommandError(`${what}s are numbered from 1`,2);return[a,b] as const;});
 return(n:number)=>parts.some(([a,b])=>n>=a&&n<=b);
}
const cut:Command=async ctx=>{
 const {opts,rest}=parseArgs('cut',ctx.args,{flags:'snz',values:'dfcb',long:{'delimiter=':'d','fields=':'f','characters=':'c','bytes=':'b','only-delimited':'s',complement:'complement','output-delimiter=':'output'}});
 const list=(opts.f??opts.c??opts.b) as string|undefined;if(!list)throw new CommandError('you must specify a list of bytes, characters, or fields',2);
 const inList=ranges(list,opts.f?'field':'byte'),pick=(n:number)=>opts.complement?!inList(n):inList(n),state={status:0};
 const delim=opts.d!==undefined?String(opts.d):'\t';if(opts.f&&delim.length!==1)throw new CommandError('the delimiter must be a single character',2);
 const outDelim=opts.output!==undefined?String(opts.output):delim;
 for await(const line of allLines(ctx,rest,state)){
  if(opts.f){if(!line.includes(delim)){if(!opts.s)await ctx.out(line+'\n');continue;}await ctx.out(line.split(delim).filter((_,k)=>pick(k+1)).join(outDelim)+'\n');continue;}
  const chars=opts.b?[...encoder.encode(line)].map(b=>String.fromCharCode(b)):[...line];const kept=chars.filter((_,k)=>pick(k+1)).join('');
  await ctx.out((opts.b?decode(Uint8Array.from(kept,c=>c.charCodeAt(0))):kept)+'\n');
 }
 return state.status;
};
/** tr's sets: ranges, [:classes:], [c*n], and escapes, as a list of characters. */
function trSet(spec:string):string[]{
 const out:string[]=[];let i=0;
 const char=()=>{if(spec[i]==='\\'&&i+1<spec.length){const r=escape(spec,i);i=r.end;return r.text;}return spec[i++];};
 while(i<spec.length){
  if(spec.startsWith('[:',i)){const end=spec.indexOf(':]',i+2);if(end>0){const name=spec.slice(i+2,end),cls=posixClasses[name];if(!cls)throw new CommandError(`invalid character class '${name}'`,2);const re=new RegExp('['+cls+']');for(let c=0;c<128;c++)if(re.test(String.fromCharCode(c)))out.push(String.fromCharCode(c));i=end+2;continue;}}
  if(spec[i]==='['&&/^\[(.|\\.)\*(\d*)\]/.test(spec.slice(i))){const m=/^\[(.|\\.)\*(\d*)\]/.exec(spec.slice(i))!;const c=m[1].length>1?escape(m[1],0).text:m[1];if(m[2])out.push(...Array(Number(m[2])).fill(c));else out.push('\u0000repeat:'+c);i+=m[0].length;continue;}
  const c=char();
  if(spec[i]==='-'&&i+1<spec.length){i++;const d=char();for(let k=c.codePointAt(0)!;k<=d.codePointAt(0)!;k++)out.push(String.fromCodePoint(k));continue;}
  out.push(c);
 }
 return out;
}
const tr:Command=async ctx=>{
 const {opts,rest}=parseArgs('tr',ctx.args,{flags:'dscCt',long:{delete:'d','squeeze-repeats':'s',complement:'c',truncate:'t'}});
 if(!rest.length)throw new CommandError('missing operand',2);
 let set1=trSet(rest[0]);const complement=opts.c||opts.C;let set2=rest[1]!==undefined?trSet(rest[1]):[];
 const filler=set2.find(c=>c.startsWith('\u0000repeat:'));set2=set2.filter(c=>!c.startsWith('\u0000repeat:'));set1=set1.filter(c=>!c.startsWith('\u0000repeat:'));
 const in1=new Set(set1),map=new Map<string,string>();
 if(!opts.d&&rest[1]!==undefined&&!complement){if(opts.t)set1=set1.slice(0,set2.length);const pad=filler?filler.slice(8):set2.at(-1)??'';set1.forEach((c,k)=>map.set(c,set2[k]??pad));}
 const squeeze=new Set(rest[1]!==undefined?set2:set1);const member=(c:string)=>complement?!in1.has(c):in1.has(c);
 let last='';const decoder=new TextDecoder();
 for await(const chunk of ctx.stdin.chunks()){
  let out='';
  for(const c of decoder.decode(chunk,{stream:true})){
   let r=c;
   if(opts.d&&member(c)){continue;}
   if(!opts.d&&rest[1]!==undefined&&member(c))r=complement?(set2.at(-1)??c):(map.get(c)??c);
   if(opts.s&&r===last&&(rest[1]!==undefined?squeeze.has(r):member(r)))continue;
   out+=r;last=r;
  }
  if(out)await ctx.out(out);
 }
 return 0;
};
const tee:Command=async ctx=>{
 const {opts,rest}=parseArgs('tee',ctx.args,{flags:'ai',long:{append:'a','ignore-interrupts':'i'}});
 const outs:FileOutput[]=[];let status=0;
 for(const file of rest){try{outs.push(new FileOutput(ctx.fs,ctx.resolve(file),!!opts.a));}catch(error){await ctx.err(`tee: ${file}: ${describeError(error)}\n`);status=1;}}
 try{for await(const chunk of ctx.stdin.chunks()){for(const out of outs)await out.write(chunk);await ctx.stdout.write(chunk.slice());}}finally{outs.forEach(o=>o.close());}
 return status;
};
const printf:Command=async ctx=>{
 if(!ctx.args.length)throw new CommandError('usage: printf FORMAT [ARGUMENT]...',2);
 const [fmt,...values]=ctx.args[0]==='--'?ctx.args.slice(1):ctx.args;let i=0,status=0;
 for(;;){
  const r=format(fmt??'',()=>values[i++],{escapes:true,onBadNumber:v=>{void ctx.err(`printf: ${v}: invalid number\n`);status=1;}});
  await ctx.out(r.text);if(r.stop||!r.used||i>=values.length)break;
 }
 return status;
};
const seq:Command=async ctx=>{
 const args=ctx.args.slice();const opts:{s:string;w:boolean;f?:string}={s:'\n',w:false};
 while(args.length&&/^-[swf]/.test(args[0])&&!/^-\d/.test(args[0])){const a=args.shift()!;if(a==='-w')opts.w=true;else if(a.startsWith('-s'))opts.s=a.length>2?a.slice(2):args.shift()??'';else if(a.startsWith('-f'))opts.f=a.length>2?a.slice(2):args.shift();}
 if(!args.length||args.length>3)throw new CommandError('usage: seq [-w] [-s SEP] [-f FORMAT] [FIRST [INCREMENT]] LAST',2);
 const nums=args.map(a=>{const n=Number(a);if(!Number.isFinite(n))throw new CommandError(`invalid floating point argument: '${a}'`,2);return n;});
 const [first,step,last]=nums.length===1?[1,1,nums[0]]:nums.length===2?[nums[0],1,nums[1]]:nums;if(step===0)throw new CommandError(`invalid Zero increment value: '0'`,2);
 const decimals=Math.max(...args.map(a=>(a.split('.')[1]??'').replace(/e.*$/i,'').length));
 const text=(n:number)=>opts.f?format(opts.f,()=>n).text:n.toFixed(decimals);
 const width=opts.w?Math.max(text(first).length,text(last).length):0;
 const parts:string[]=[];let size=0;
 for(let k=0;;k++){const n=first+k*step;if(step>0?n>last+1e-10:n<last-1e-10)break;let t=text(n);if(width)t=t.startsWith('-')?'-'+t.slice(1).padStart(width-1,'0'):t.padStart(width,'0');parts.push(t);size+=t.length+1;
  if(size>65536){await ctx.out(parts.join(opts.s)+opts.s);parts.length=0;size=0;}}
 if(parts.length)await ctx.out(parts.join(opts.s)+'\n');
 return 0;
};
/** expr: arithmetic, comparisons, : regex match, length, substr, index; exit 1 when the result is 0 or empty. */
const expr:Command=async ctx=>{
 const t=ctx.args;let i=0;
 type V=string;const num=(v:V)=>{if(!/^-?\d+$/.test(v.trim()))throw new CommandError('non-integer argument',2);return Number(v);};
 const or=():V=>{let a=and();while(t[i]==='|'){i++;const b=and();a=a!==''&&a!=='0'?a:b;}return a;};
 const and=():V=>{let a=cmp();while(t[i]==='&'){i++;const b=cmp();a=a!==''&&a!=='0'&&b!==''&&b!=='0'?a:'0';}return a;};
 const cmp=():V=>{let a=add();while(['=','==','!=','<','<=','>','>='].includes(t[i])){const op=t[i++],b=add();const both=/^-?\d+$/.test(a)&&/^-?\d+$/.test(b);const x:number|string=both?Number(a):a,y:number|string=both?Number(b):b;const r=op==='='||op==='=='?x===y:op==='!='?x!==y:op==='<'?x<y:op==='<='?x<=y:op==='>'?x>y:x>=y;a=r?'1':'0';}return a;};
 const add=():V=>{let a=mul();while(t[i]==='+'||t[i]==='-'){const op=t[i++],b=mul();a=String(op==='+'?num(a)+num(b):num(a)-num(b));}return a;};
 const mul=():V=>{let a=match();while(t[i]==='*'||t[i]==='/'||t[i]==='%'){const op=t[i++],b=match();if(op!=='*'&&num(b)===0)throw new CommandError('division by zero',2);a=String(op==='*'?num(a)*num(b):op==='/'?Math.trunc(num(a)/num(b)):num(a)%num(b));}return a;};
 const regexMatch=(s:V,re:V)=>{const m=compileRegex(re.startsWith('^')?re.slice(1):re,false).exec(s);if(!m||m.index!==0)return/\\\(/.test(re)?'':'0';return m[1]!==undefined?m[1]:String(m[0].length);};
 const match=():V=>{let a=primary();while(t[i]===':'){i++;a=regexMatch(a,primary());}return a;};
 const primary=():V=>{
  const tok=t[i++];if(tok===undefined)throw new CommandError('syntax error: missing argument',2);
  if(tok==='('){const v=or();if(t[i++]!==')')throw new CommandError("syntax error: expecting ')'",2);return v;}
  if(tok==='length')return String([...(t[i++]??'')].length);
  if(tok==='substr'){const s=t[i++]??'',p=num(t[i++]??''),n=num(t[i++]??'');return p<1||n<1?'':[...s].slice(p-1,p-1+n).join('');}
  if(tok==='index'){const s=t[i++]??'',chars=t[i++]??'';const k=[...s].findIndex(c=>chars.includes(c));return String(k+1);}
  if(tok==='match'){const s=t[i++]??'',re=t[i++]??'';return regexMatch(s,re);}
  if(tok==='+')return t[i++]??'';
  return tok;
 };
 const v=or();if(i<t.length)throw new CommandError(`syntax error: unexpected argument '${t[i]}'`,2);
 await ctx.out(v+'\n');return v===''||v==='0'?1:0;
};
const rev:Command=async ctx=>{const state={status:0};for await(const line of allLines(ctx,ctx.args,state))await ctx.out([...line].reverse().join('')+'\n');return state.status;};
const nl:Command=async ctx=>{
 const {opts,rest}=parseArgs('nl',ctx.args,{values:'bwsv',long:{'body-numbering=':'b','number-width=':'w','number-separator=':'s','starting-line-number=':'v'}});
 const all=opts.b==='a',width=Number(opts.w??6),sep=opts.s!==undefined?String(opts.s):'\t',state={status:0};let n=Number(opts.v??1);
 for await(const line of allLines(ctx,rest,state))await ctx.out(all||line.trim()?String(n++).padStart(width)+sep+line+'\n':' '.repeat(width)+sep.replace(/./g,' ')+'\n');
 return state.status;
};
const paste:Command=async ctx=>{
 const {opts,rest}=parseArgs('paste',ctx.args,{flags:'s',values:'d',long:{'delimiters=':'d',serial:'s'}});
 const delims=[...String(opts.d??'\t').replace(/\\t/g,'\t').replace(/\\n/g,'\n').replace(/\\0/g,'')];const state={status:0},files:string[][]=[];
 for(const file of rest.length?rest:['-']){const lines:string[]=[];for await(const line of allLines(ctx,[file],state))lines.push(line);files.push(lines);}
 const d=(k:number)=>delims.length?delims[k%delims.length]:'';
 if(opts.s){for(const lines of files)await ctx.out(lines.map((l,k)=>(k?d(k-1):'')+l).join('')+'\n');return state.status;}
 const rows=Math.max(0,...files.map(f=>f.length));for(let r=0;r<rows;r++)await ctx.out(files.map((f,k)=>(k?d(k-1):'')+(f[r]??'')).join('')+'\n');
 return state.status;
};
const yes:Command=async ctx=>{const line=(ctx.args.length?ctx.args.join(' '):'y')+'\n',block=line.repeat(Math.max(1,Math.floor(8192/line.length)));for(;;){if(ctx.signal.aborted)return 130;await ctx.out(block);}};
const base64:Command=async ctx=>{
 const {opts,rest}=parseArgs('base64',ctx.args,{flags:'di',values:'w',long:{decode:'d','ignore-garbage':'i','wrap=':'w'}});const state={status:0};
 for await(const {input} of inputs(ctx,rest,state)){
  const data=await input.readAll();
  if(opts.d){const text=decode(data).replace(/[^A-Za-z0-9+/=_-]/g,'').replace(/-/g,'+').replace(/_/g,'/');const bin=atob(text.padEnd(Math.ceil(text.length/4)*4,'='));await ctx.stdout.write(Uint8Array.from(bin,c=>c.charCodeAt(0)));continue;}
  let bin='';for(let k=0;k<data.length;k+=32768)bin+=String.fromCharCode(...data.subarray(k,k+32768));const encoded=btoa(bin),wrap=Number(opts.w??76);
  await ctx.out((wrap>0?encoded.match(new RegExp(`.{1,${wrap}}`,'g'))?.join('\n')??'':encoded)+'\n');
 }
 return state.status;
};
export const textTools:Record<string,Command>={cat,head,tail,wc,sort,uniq,cut,tr,tee,printf,seq,expr,rev,nl,paste,yes,base64};
export {numberArg};
