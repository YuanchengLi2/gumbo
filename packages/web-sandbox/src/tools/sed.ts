import {CommandError,type Command} from '../shell/types';
import {compileRegex} from './regex';
import {FileOutput} from '../shell/io';
import {describeError} from '../fs/types';
import {decode,encoder} from '../fs/util';
import {dirname,basename,join} from '../path';

type Address={t:'line';n:number}|{t:'last'}|{t:'re';re:RegExp|null}|{t:'step';first:number;step:number}|{t:'plus';n:number}|{t:'mult';n:number};
type Cmd={a1?:Address;a2?:Address;negate:boolean;name:string;text?:string;label?:string;re?:RegExp|null;replacement?:string;global?:boolean;nth?:number;print?:number;file?:string;from?:string;to?:string;end?:number;quit?:number;active?:boolean;endLine?:number};

/** Parses a sed script into commands; `{`…`}` blocks record where they end so a non-matching block is skipped whole. */
function parseScript(script:string,extended:boolean):Cmd[]{
 const cmds:Cmd[]=[],stack:number[]=[];let i=0;const s=script;
 const ws=()=>{while(i<s.length&&/[ \t]/.test(s[i]))i++;};
 const regexBody=(delim:string)=>{let out='';while(i<s.length&&s[i]!==delim){if(s[i]==='\\'&&i+1<s.length){if(s[i+1]===delim){out+=delim==='/'?'\\/':delim;i+=2;continue;}if(s[i+1]==='n'){out+='\\n';i+=2;continue;}out+=s[i]+s[i+1];i+=2;continue;}
  if(s[i]==='['){const start=i;i++;if(s[i]==='^')i++;if(s[i]===']')i++;while(i<s.length&&s[i]!==']'){if(s[i]==='['&&s[i+1]===':'){const e=s.indexOf(':]',i);if(e>0){i=e+2;continue;}}i++;}out+=s.slice(start,i+1);i++;continue;}
  out+=s[i++];}
  if(s[i]!==delim)throw new CommandError(`-e expression #1, char ${i}: unterminated address regex`,1);i++;return out;};
 const compile=(body:string,flags:string)=>body===''?null:compileRegex(body,extended,flags);
 const address=():Address|undefined=>{
  if(/\d/.test(s[i]??'')){const m=/^(\d+)(?:~(\d+))?/.exec(s.slice(i))!;i+=m[0].length;return m[2]!==undefined?{t:'step',first:Number(m[1]),step:Number(m[2])}:{t:'line',n:Number(m[1])};}
  if(s[i]==='$'){i++;return{t:'last'};}
  if(s[i]==='/'||s[i]==='\\'){const delim=s[i]==='\\'?s[++i]:'/';i++;const body=regexBody(delim);let flags='';while(s[i]==='I'||s[i]==='M'){flags+=s[i]==='I'?'i':'m';i++;}return{t:'re',re:compile(body,flags)};}
  return undefined;
 };
 const text=():string=>{
  // GNU one-liner "a text" and POSIX "a\<newline>text" with \ continuing lines.
  ws();if(s[i]==='\\'){i++;if(s[i]==='\n')i++;}else ws();
  let out='';while(i<s.length&&s[i]!=='\n'){if(s[i]==='\\'){const n=s[i+1];if(n==='\n'){out+='\n';i+=2;continue;}if(n==='t'){out+='\t';i+=2;continue;}out+=n??'';i+=2;continue;}out+=s[i++];}
  return out;
 };
 const word=()=>{ws();let out='';while(i<s.length&&!/[;\n}]/.test(s[i]))out+=s[i++];return out.trim();};
 const filename=()=>{ws();let out='';while(i<s.length&&s[i]!=='\n')out+=s[i++];return out;};
 while(i<s.length){
  while(i<s.length&&/[\s;]/.test(s[i]))i++;if(i>=s.length)break;
  if(s[i]==='#'){while(i<s.length&&s[i]!=='\n')i++;continue;}
  const cmd:Cmd={negate:false,name:''};cmd.a1=address();
  if(cmd.a1&&s[i]===','){i++;ws();if(s[i]==='+'||s[i]==='~'){const plus=s[i]==='+';i++;const m=/^\d+/.exec(s.slice(i));if(!m)throw new CommandError('expected number after address offset',1);i+=m[0].length;cmd.a2=plus?{t:'plus',n:Number(m[0])}:{t:'mult',n:Number(m[0])};}else{cmd.a2=address();if(!cmd.a2)throw new CommandError('unexpected `,\'',1);}}
  ws();while(s[i]==='!'){cmd.negate=!cmd.negate;i++;ws();}
  const name=s[i++];if(!name)throw new CommandError('missing command',1);cmd.name=name;
  switch(name){
   case'{':stack.push(cmds.length);break;
   case'}':{const open=stack.pop();if(open===undefined)throw new CommandError('unexpected `}\'',1);cmds[open].end=cmds.length;break;}
   case'a':case'i':case'c':cmd.text=text();break;
   case':':{cmd.label=word();if(!cmd.label)throw new CommandError('":" lacks a label',1);break;}
   case'b':case't':case'T':cmd.label=word();break;
   case'r':case'R':case'w':case'W':cmd.file=filename();break;
   case'q':case'Q':case'l':case'L':{ws();const m=/^\d+/.exec(s.slice(i));if(m){cmd.quit=Number(m[0]);i+=m[0].length;}break;}
   case's':{
    const delim=s[i++];if(!delim||delim==='\n'||delim==='\\')throw new CommandError('unterminated `s\' command',1);
    const body=regexBody(delim);let replacement='';while(i<s.length&&s[i]!==delim){if(s[i]==='\\'&&i+1<s.length){replacement+=s[i+1]===delim?delim:s[i]+s[i+1];i+=2;continue;}replacement+=s[i++];}
    if(s[i]!==delim)throw new CommandError("unterminated `s' command",1);i++;
    let flags='',global=false,nth=1,print=0;
    while(i<s.length&&/[gpiIm0-9eMw]/.test(s[i])){const c=s[i++];if(c==='g')global=true;else if(c==='p')print++;else if(c==='i'||c==='I')flags+='i';else if(c==='m'||c==='M')flags+='m';else if(/\d/.test(c)){const m=/^\d*/.exec(s.slice(i))![0];nth=Number(c+m);i+=m.length;}else if(c==='w'){cmd.file=filename();break;}}
    Object.assign(cmd,{re:compile(body,flags),replacement,global,nth,print});break;
   }
   case'y':{
    const delim=s[i++];const part=()=>{let out='';while(i<s.length&&s[i]!==delim){if(s[i]==='\\'){const n=s[i+1];out+=n==='n'?'\n':n==='t'?'\t':n;i+=2;continue;}out+=s[i++];}i++;return out;};
    const from=[...part()],to=[...part()];if(from.length!==to.length)throw new CommandError('strings for `y\' command are different lengths',1);cmd.from=from.join('\u0000');cmd.to=to.join('\u0000');break;
   }
   case'=':case'd':case'D':case'g':case'G':case'h':case'H':case'n':case'N':case'p':case'P':case'x':case'z':case'F':break;
   default:throw new CommandError(`unknown command: \`${name}'`,1);
  }
  cmds.push(cmd);
 }
 if(stack.length)throw new CommandError('unmatched `{\'',1);
 return cmds;
}
/** The replacement of s///: & and \1-\9, \n, and GNU's \U \L \u \l \E case changes. */
function replace(match:RegExpExecArray,replacement:string){
 let out='',mode:''|'U'|'L'='',once:''|'u'|'l'='';
 const add=(text:string)=>{for(const ch of text){let c=mode==='U'?ch.toUpperCase():mode==='L'?ch.toLowerCase():ch;if(once){c=once==='u'?c.toUpperCase():c.toLowerCase();once='';}out+=c;}};
 for(let i=0;i<replacement.length;i++){
  const c=replacement[i];
  if(c==='&'){add(match[0]);continue;}
  if(c!=='\\'){add(c);continue;}
  const n=replacement[++i];
  if(n===undefined){add('\\');break;}
  if(/\d/.test(n)){add(match[Number(n)]??'');continue;}
  if(n==='n'){add('\n');continue;}if(n==='t'){add('\t');continue;}if(n==='&'){add('&');continue;}
  if(n==='U'||n==='L'){mode=n;continue;}if(n==='E'){mode='';continue;}if(n==='u'||n==='l'){once=n;continue;}
  add(n);
 }
 return out;
}
export const sed:Command=async ctx=>{
 const scripts:string[]=[],files:string[]=[];let quiet=false,inPlace:string|undefined,extended=false,separate=false,nullData=false;
 const args=ctx.args;
 for(let k=0;k<args.length;k++){
  const a=args[k];
  if(a==='--'){files.push(...args.slice(k+1));break;}
  if(a==='-n'||a==='--quiet'||a==='--silent'){quiet=true;continue;}
  if(a==='-E'||a==='-r'||a==='--regexp-extended'){extended=true;continue;}
  if(a==='-s'||a==='--separate'){separate=true;continue;}
  if(a==='-z'||a==='--null-data'){nullData=true;continue;}
  if(a==='-u'||a==='--unbuffered'||a==='--posix'||a==='--debug'||a==='--sandbox'||a==='--follow-symlinks')continue;
  if(a==='-e'||a==='--expression'){scripts.push(args[++k]??'');continue;}
  if(a.startsWith('--expression=')){scripts.push(a.slice(13));continue;}
  if(a==='-f'||a==='--file'){const f=args[++k]??'';try{scripts.push(decode(ctx.fs.readFile(ctx.resolve(f))).replace(/^#n\n/,()=>{quiet=true;return'';}));}catch(error){throw new CommandError(`couldn't open file ${f}: ${describeError(error)}`,1);}continue;}
  if(a.startsWith('-i')||a.startsWith('--in-place')){inPlace=a.startsWith('--in-place=')?a.slice(11):a.startsWith('-i')?a.slice(2):'';if(a==='-i'&&args[k+1]==='')k++;continue;}
  if(/^-[nErsuz]+$/.test(a)&&a.length>2){for(const f of a.slice(1)){if(f==='n')quiet=true;if(f==='E'||f==='r')extended=true;if(f==='s')separate=true;if(f==='z')nullData=true;}continue;}
  if(/^-[nErsuz]*i/.test(a)){for(const f of a.slice(1,a.indexOf('i')))if(f==='n')quiet=true;else if(f==='E'||f==='r')extended=true;inPlace=a.slice(a.indexOf('i')+1);continue;}
  if(a.startsWith('-')&&a.length>1)throw new CommandError(`invalid option -- '${a.slice(1)}'`,1);
  files.push(a);
 }
 if(!scripts.length){if(!files.length)throw new CommandError('usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...',1);scripts.push(files.shift()!);}
 const cmds=parseScript(scripts.join('\n'),extended);
 const labels=new Map<string,number>();cmds.forEach((c,k)=>{if(c.name===':')labels.set(c.label!,k);});
 for(const c of cmds)if((c.name==='b'||c.name==='t'||c.name==='T')&&c.label&&!labels.has(c.label))throw new CommandError(`can't find label for jump to \`${c.label}'`,1);
 const sep=nullData?'\0':'\n',writers=new Map<string,FileOutput>();
 const writer=(file:string)=>{if(file==='/dev/stdout')return{write:(t:string)=>ctx.out(t)};let w=writers.get(file);if(!w){w=new FileOutput(ctx.fs,ctx.resolve(file),false);writers.set(file,w);}return w;};
 let status=0,lastRegex:RegExp|null=null;
 const run=async(lines:string[],emit:(text:string)=>Promise<void>,fileName:string):Promise<boolean>=>{
  let hold='',lineNo=0,index=0,quitting=false;
  for(const c of cmds){c.active=false;c.endLine=undefined;}
  const matchRe=(re:RegExp|null,text:string)=>{const r=re??lastRegex;if(!r)throw new CommandError('no previous regular expression',1);if(re)lastRegex=re;r.lastIndex=0;return r.test(text);};
  const matches=(a:Address,text:string)=>a.t==='line'?lineNo===a.n:a.t==='last'?index>=lines.length:a.t==='step'?(a.step<=0?lineNo===a.first:lineNo>=a.first&&(lineNo-a.first)%a.step===0):a.t==='re'?matchRe(a.re,text):false;
  const selected=(c:Cmd,text:string)=>{
   if(!c.a1)return true;
   if(!c.a2)return matches(c.a1,text);
   if(c.active){
    const a2=c.a2;let end=false;
    if(a2.t==='line')end=lineNo>=a2.n;else if(a2.t==='plus')end=lineNo>=c.endLine!;else if(a2.t==='mult')end=a2.n<=0||lineNo%a2.n===0;else end=matches(a2,text);
    if(a2.t==='line'&&lineNo>a2.n){c.active=false;return false;}
    if(end)c.active=false;return true;
   }
   if((c.a1.t==='line'&&c.a1.n===0)?false:matches(c.a1,text)){
    const a2=c.a2;c.active=true;
    if(a2.t==='line'&&a2.n<=lineNo)c.active=false;else if(a2.t==='plus'){c.endLine=lineNo+a2.n;if(a2.n===0)c.active=false;}else if(a2.t==='mult'&&(a2.n<=0||lineNo%a2.n===0))c.active=false;
    return true;
   }
   if(c.a1.t==='line'&&c.a1.n===0&&c.a2.t==='re'&&lineNo===1){c.active=!matches(c.a2,text);return true;}
   return false;
  };
  while(index<lines.length&&!quitting){
   let pattern=lines[index++];lineNo++;let appended:string[]=[],substituted=false,pc=0,deleted=false,restart=false;
   cycle:while(pc<cmds.length){
    const c=cmds[pc];
    if(c.name==='}'||c.name===':'){pc++;continue;}
    const hit=selected(c,pattern)!==c.negate;
    if(!hit){pc=c.name==='{'?c.end!+1:pc+1;continue;}
    switch(c.name){
     case'{':break;
     case'=':await emit(lineNo+'\n');break;
     case'a':appended.push(c.text!+'\n');break;
     case'i':await emit(c.text!+'\n');break;
     case'c':{if(!c.a2||!c.active)await emit(c.text!+'\n');deleted=true;break cycle;}
     case'd':deleted=true;break cycle;
     case'D':{const nl=pattern.indexOf('\n');if(nl<0){deleted=true;break cycle;}pattern=pattern.slice(nl+1);restart=true;break cycle;}
     case'g':pattern=hold;break;case'G':pattern+='\n'+hold;break;case'h':hold=pattern;break;case'H':hold+='\n'+pattern;break;case'x':[pattern,hold]=[hold,pattern];break;case'z':pattern='';break;
     case'F':await emit(fileName+'\n');break;
     case'l':{const width=c.quit??70;let out='';for(const ch of pattern){const code=ch.charCodeAt(0);out+=ch==='\\'?'\\\\':ch==='\t'?'\\t':ch==='\n'?'\\n':code<32||code===127?'\\'+code.toString(8).padStart(3,'0'):ch;}const parts=width>1?out.match(new RegExp(`.{1,${width-1}}`,'g'))??['']:[out];await emit(parts.join('\\\n')+'$\n');break;}
     case'n':{if(!quiet)await emit(pattern+sep);if(index>=lines.length){quitting=true;deleted=true;break cycle;}pattern=lines[index++];lineNo++;break;}
     case'N':{if(index>=lines.length){quitting=true;break cycle;}pattern+='\n'+lines[index++];lineNo++;break;}
     case'p':await emit(pattern+sep);break;
     case'P':await emit(pattern.split('\n')[0]+sep);break;
     case'q':case'Q':{if(c.name==='Q')deleted=true;quitting=true;if(c.quit!==undefined)status=c.quit;break cycle;}
     case'r':{try{appended.push(decode(ctx.fs.readFile(ctx.resolve(c.file!))));}catch{}break;}
     case'R':break;
     case'w':await writer(c.file!).write(pattern+'\n');break;
     case'W':await writer(c.file!).write(pattern.split('\n')[0]+'\n');break;
     case'b':pc=c.label?labels.get(c.label)!:cmds.length;continue;
     case't':if(substituted){substituted=false;pc=c.label?labels.get(c.label)!:cmds.length;continue;}break;
     case'T':if(!substituted){pc=c.label?labels.get(c.label)!:cmds.length;continue;}substituted=false;break;
     case'y':{const from=c.from!.split('\u0000'),to=c.to!.split('\u0000');pattern=[...pattern].map(ch=>{const k=from.indexOf(ch);return k<0?ch:to[k];}).join('');break;}
     case's':{
      const re=c.re??lastRegex;if(!re)throw new CommandError('no previous regular expression',1);if(c.re)lastRegex=c.re;
      const g=new RegExp(re.source,re.flags.replace('g','')+'g');let n=0,out='',last=0,did=false;
      for(let m=g.exec(pattern);m;m=g.exec(pattern)){
       n++;if(m[0]===''&&g.lastIndex===m.index)g.lastIndex++;
       if(n<c.nth!)continue;
       out+=pattern.slice(last,m.index)+replace(m,c.replacement!);last=m.index+m[0].length;did=true;
       if(!c.global)break;
      }
      if(did){pattern=out+pattern.slice(last);substituted=true;for(let k=0;k<c.print!;k++)await emit(pattern+sep);if(c.file)await writer(c.file).write(pattern+'\n');}
      break;
     }
    }
    pc++;
   }
   if(restart){index--;lines[index]=pattern;lineNo--;for(const text of appended)await emit(text);continue;}
   if(!deleted&&!quiet)await emit(pattern+sep);
   for(const text of appended)await emit(text);
  }
  return quitting;
 };
 const readLines=(text:string)=>{const lines=text.split(sep);if(lines.at(-1)==='')lines.pop();return lines;};
 try{
  if(inPlace!==undefined){
   if(!files.length)throw new CommandError('no input files',1);
   for(const file of files){
    const path=ctx.resolve(file);let text:string;try{text=decode(ctx.fs.readFile(path));}catch(error){await ctx.err(`sed: can't read ${file}: ${describeError(error)}\n`);status=2;continue;}
    let out='';await run(readLines(text),async t=>{out+=t;},file);
    if(inPlace)ctx.fs.writeFile(inPlace.includes('*')?join(dirname(path),inPlace.replace(/\*/g,basename(path))):path+inPlace,encoder.encode(text));
    ctx.fs.writeFile(path,encoder.encode(out));
   }
   return status;
  }
  const groups:{name:string;text:string}[]=[];
  for(const file of files.length?files:['-']){
   if(file==='-'){groups.push({name:'-',text:await ctx.stdin.text()});continue;}
   try{groups.push({name:file,text:decode(ctx.fs.readFile(ctx.resolve(file)))});}catch(error){await ctx.err(`sed: can't read ${file}: ${describeError(error)}\n`);status=2;}
  }
  const emit=(text:string)=>ctx.out(text);
  if(separate){for(const g of groups)if(await run(readLines(g.text),emit,g.name))break;}
  else await run(groups.flatMap(g=>readLines(g.text)),emit,groups[0]?.name??'-');
 }finally{for(const w of writers.values())w.close();}
 return status;
};
