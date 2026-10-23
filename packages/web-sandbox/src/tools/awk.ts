import {CommandError,type Command,type CommandContext} from '../shell/types';
import {compileRegex} from './regex';
import {format,numberText,type Arg} from './format';
import {FileInput,FileOutput,StringOutput,BytesInput,type Input} from '../shell/io';
import {describeError} from '../fs/types';
import {decode,encoder} from '../fs/util';

/** A string from input (fields, getline, split, ARGV, ENVIRON): compares as a number when it looks like one. */
class StrNum{constructor(public s:string){}}
type V=number|string|StrNum;
const UNINIT=new StrNum('');
type Arr=Map<string,V>;
type Node={k:string;[key:string]:any};
class AwkSyntax extends Error{}
class Next{}class NextFile{}class Exit{constructor(public status:number){}}class Break{}class Continue{}class Return{constructor(public value:V){}}

// ---------- lexer
const KEYWORDS=new Set(['BEGIN','END','function','func','if','else','while','for','do','break','continue','next','nextfile','exit','return','delete','in','getline','print','printf']);
const BUILTINS=new Set(['length','substr','index','split','sub','gsub','match','sprintf','sin','cos','atan2','exp','log','sqrt','int','rand','srand','tolower','toupper','system','close','fflush','gensub','systime','strftime','asort','asorti']);
type Tok={t:string;v:string;line:number};
function lex(src:string):Tok[]{
 const out:Tok[]=[];let i=0,line=1;
 const regexOk=()=>{const p=out[out.length-1];if(!p)return true;if(['num','str','ere','name','funcname',')',']','$','incr','decr'].includes(p.t))return false;if(p.t==='builtin')return false;return true;};
 while(i<src.length){
  const c=src[i];
  if(c==='\\'&&src[i+1]==='\n'){i+=2;line++;continue;}
  if(c==='\\'&&src[i+1]==='\r'&&src[i+2]==='\n'){i+=3;line++;continue;}
  if(c===' '||c==='\t'||c==='\r'){i++;continue;}
  if(c==='#'){while(i<src.length&&src[i]!=='\n')i++;continue;}
  if(c==='\n'){out.push({t:'nl',v:'\n',line});line++;i++;continue;}
  if(c==='"'){let s='';i++;while(i<src.length&&src[i]!=='"'){if(src[i]==='\\'){const n=src[i+1];i+=2;const map:Record<string,string>={n:'\n',t:'\t',r:'\r','\\':'\\','"':'"','/':'/',a:'\x07',b:'\b',f:'\f',v:'\v'};if(n in map)s+=map[n];else if(/[0-7]/.test(n)){let o=n;while(o.length<3&&/[0-7]/.test(src[i]))o+=src[i++];s+=String.fromCharCode(parseInt(o,8));}else if(n==='\n'){line++;}else s+='\\'+n;continue;}s+=src[i++];}if(src[i]!=='"')throw new AwkSyntax('unterminated string');i++;out.push({t:'str',v:s,line});continue;}
  if(c==='/'&&regexOk()){let s='';i++;let inClass=false;while(i<src.length&&(src[i]!=='/'||inClass)){if(src[i]==='\n')throw new AwkSyntax('unterminated regexp');if(src[i]==='\\'&&i+1<src.length){s+=src[i]+src[i+1];i+=2;continue;}if(src[i]==='[')inClass=true;else if(src[i]===']')inClass=false;s+=src[i++];}if(src[i]!=='/')throw new AwkSyntax('unterminated regexp');i++;out.push({t:'ere',v:s,line});continue;}
  const num=/^(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/.exec(src.slice(i));
  if(num&&/[\d.]/.test(c)){out.push({t:'num',v:num[0],line});i+=num[0].length;continue;}
  const name=/^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
  if(name){const w=name[0];i+=w.length;if(KEYWORDS.has(w))out.push({t:w==='func'?'function':w,v:w,line});else if(BUILTINS.has(w))out.push({t:'builtin',v:w,line});else out.push({t:src[i]==='('?'funcname':'name',v:w,line});continue;}
  const ops=['**=','**','+=','-=','*=','/=','%=','^=','==','<=','>=','!=','++','--','&&','||','>>','!~'];
  const op=ops.find(o=>src.startsWith(o,i));
  if(op){i+=op.length;out.push({t:op==='++'?'incr':op==='--'?'decr':op==='**'?'^':op==='**='?'^=':op,v:op,line});continue;}
  if('{}()[];,+-*/%^!><|?:~$='.includes(c)){out.push({t:c,v:c,line});i++;continue;}
  throw new AwkSyntax(`unexpected character '${c}'`);
 }
 out.push({t:'eof',v:'',line});return out;
}
// ---------- parser
function parseProgram(src:string){
 const toks=lex(src);let p=0;
 const peek=(o=0)=>toks[p+o],next=()=>toks[p++],is=(t:string)=>toks[p].t===t;
 const fail=(msg:string):never=>{throw new AwkSyntax(`syntax error at source line ${toks[p].line}: ${msg} near "${toks[p].v||toks[p].t}"`);};
 const expect=(t:string)=>{if(!is(t))fail(`expected "${t}"`);return next();};
 const nl=()=>{while(is('nl'))p++;};
 const term=()=>{while(is('nl')||is(';'))p++;};
 const items:{pattern?:Node;pattern2?:Node;begin?:boolean;end?:boolean;action?:Node}[]=[];const functions=new Map<string,{params:string[];body:Node}>();
 // expressions, lowest precedence first; noIn stops at "in" (for (x in a)), noGt makes > a redirect (print).
 let noGt=0,noIn=0;
 const expr=():Node=>ternary();
 const isLvalue=(n:Node)=>n.k==='var'||n.k==='field'||n.k==='index';
 const ternary=():Node=>{
  const c=or();
  if(is('?')){next();nl();const a=ternary();nl();expect(':');nl();const b=ternary();return{k:'cond',c,a,b};}
  if(isLvalue(c)&&['=','+=','-=','*=','/=','%=','^='].includes(peek().t)){const op=next().t;nl();return{k:'assign',op,target:c,value:ternary()};}
  return c;
 };
 const or=():Node=>{let a=and();while(is('||')){next();nl();a={k:'or',a,b:and()};}return a;};
 const and=():Node=>{let a=inop();while(is('&&')){next();nl();a={k:'and',a,b:inop()};}return a;};
 const inop=():Node=>{let a=match();while(is('in')&&!noIn){next();const name=expect('name').v;a={k:'in',subs:a.k==='group'?a.list:[a],name};}return a;};
 const match=():Node=>{let a=compare();while(is('~')||is('!~')){const neg=next().t==='!~';a={k:'match',neg,a,re:compare()};}return a;};
 const compare=():Node=>{
  let a=pipeGetline();
  for(;;){const t=peek().t;if(['<','<=','!=','==','>=',...(noGt?[]:['>'])].includes(t)){next();a={k:'cmp',op:t,a,b:pipeGetline()};}else break;}
  return a;
 };
 const pipeGetline=():Node=>{let a=concat();while(is('|')&&peek(1).t==='getline'){next();next();const target=lvalueOpt();a={k:'getline',from:'cmd',src:a,target};}return a;};
 // Juxtaposition concatenates; + - and ! never start a concatenated operand (a -1 is subtraction).
 const startsOperand=(t:Tok)=>['num','str','ere','name','funcname','builtin','$','(','incr','decr'].includes(t.t);
 const concat=():Node=>{let a=additive();while(startsOperand(peek()))a={k:'concat',a,b:additive()};return a;};
 const additive=():Node=>{let a=mul();while(is('+')||is('-')){const op=next().t;a={k:'bin',op,a,b:mul()};}return a;};
 const mul=():Node=>{let a=unary();while(is('*')||is('/')||is('%')){const op=next().t;a={k:'bin',op,a,b:unary()};}return a;};
 const unary=():Node=>{if(is('!')){next();return{k:'not',a:unary()};}if(is('-')){next();return{k:'neg',a:unary()};}if(is('+')){next();return{k:'pos',a:unary()};}return power();};
 const power=():Node=>{const a=postfix();if(is('^')){next();return{k:'bin',op:'^',a,b:unaryPow()};}return a;};
 const unaryPow=():Node=>{if(is('-')){next();return{k:'neg',a:unaryPow()};}if(is('+')){next();return unaryPow();}if(is('!')){next();return{k:'not',a:unaryPow()};}return power();};
 const postfix=():Node=>{const a=primary();if(isLvalue(a)&&(is('incr')||is('decr'))){const op=next().t;return{k:'incdec',target:a,delta:op==='incr'?1:-1,post:true};}return a;};
 const lvalueOpt=():Node|undefined=>{if(is('$')){next();return{k:'field',index:primaryNoPost()};}if(is('name')){const name=next().v;if(is('[')){next();const subs=exprList(']');expect(']');return{k:'index',name,subs};}return{k:'var',name};}return undefined;};
 // Newlines may follow a comma; inside ( ) and [ ] also the brackets. A print list keeps its ending newline.
 const exprList=(end:string)=>{const inside=end===')'||end===']',list:Node[]=[];if(inside)nl();if(is(end))return list;for(;;){list.push(expr());if(inside)nl();if(is(',')){next();nl();continue;}break;}return list;};
 const primaryNoPost=():Node=>{if(is('incr')||is('decr')){const delta=next().t==='incr'?1:-1;return{k:'incdec',target:lvalueOpt()??fail('expected a variable'),delta,post:false};}if(is('-')){next();return{k:'neg',a:primaryNoPost()};}return primary();};
 const primary=():Node=>{
  const t=next();
  switch(t.t){
   case'num':return{k:'num',v:t.v.startsWith('0x')||t.v.startsWith('0X')?parseInt(t.v,16):Number(t.v)};
   case'str':return{k:'str',v:t.v};
   case'ere':return{k:'regex',v:t.v};
   case'$':return{k:'field',index:primaryNoPost()};
   case'incr':case'decr':{const target=lvalueOpt();if(!target)fail('expected a variable after ++/--');return{k:'incdec',target,delta:t.t==='incr'?1:-1,post:false};}
   case'(':{const saveGt=noGt,saveIn=noIn;noGt=0;noIn=0;const list=exprList(')');expect(')');noGt=saveGt;noIn=saveIn;if(list.length>1){if(!is('in')&&!noGt)fail('expected "in" after a parenthesized list');return{k:'group',list};}return{k:'paren',a:list[0]};}
   case'name':{if(is('[')){next();const subs=exprList(']');expect(']');return{k:'index',name:t.v,subs};}return{k:'var',name:t.v};}
   case'funcname':{expect('(');const args=exprList(')');expect(')');return{k:'call',name:t.v,args};}
   case'builtin':{
    if(is('(')){next();const args=exprList(')');expect(')');return{k:'builtin',name:t.v,args};}
    if(t.v==='length')return{k:'builtin',name:'length',args:[]};
    fail(`${t.v} needs arguments`);
   }
   case'getline':{const target=lvalueOpt();if(is('<')){next();const file=primaryNoPost();return{k:'getline',from:'file',src:file,target};}return{k:'getline',from:'main',target};}
   case'-':return{k:'neg',a:unary()};
   case'!':return{k:'not',a:unary()};
  }
  p--;return fail('unexpected token');
 };
 // ---------- statements
 const simpleOrBlock=():Node=>{nl();return statement();};
 const endStatement=()=>{if(is(';')||is('nl')){next();term();return;}if(is('}')||is('eof'))return;fail('expected a newline or ";"');};
 const output=():{mode?:string;dest?:Node}=>{if(is('>')||is('>>')||is('|')){const mode=next().t;const saveGt=noGt;noGt=1;const dest=concat();noGt=saveGt;return{mode,dest};}return{};};
 const block=():Node=>{expect('{');term();const body:Node[]=[];while(!is('}')){if(is('eof'))fail('missing "}"');body.push(statement());term();}expect('}');return{k:'block',body};};
 const statement=():Node=>{
  const t=peek();
  switch(t.t){
   case'{':return block();
   case';':next();return{k:'block',body:[]};
   case'if':{next();expect('(');const c=expr();expect(')');const a=simpleOrBlock();term();let b:Node|undefined;if(is('else')){next();b=simpleOrBlock();}return{k:'if',c,a,b};}
   case'while':{next();expect('(');const c=expr();expect(')');if(is(';')){next();return{k:'while',c,body:{k:'block',body:[]}};}return{k:'while',c,body:simpleOrBlock()};}
   case'do':{next();const body=simpleOrBlock();term();expect('while');expect('(');const c=expr();expect(')');endStatement();return{k:'do',c,body};}
   case'for':{
    next();expect('(');
    if(peek().t==='name'&&peek(1).t==='in'&&peek(3)?.t===')'){const v=next().v;next();const arr=expect('name').v;expect(')');return{k:'forin',v,arr,body:simpleOrBlock()};}
    const init=is(';')?undefined:simple();expect(';');nl();const c=is(';')?undefined:expr();expect(';');nl();const step=is(')')?undefined:simple();expect(')');
    if(is(';')){next();return{k:'for',init,c,step,body:{k:'block',body:[]}};}
    return{k:'for',init,c,step,body:simpleOrBlock()};
   }
   case'break':next();endStatement();return{k:'break'};
   case'continue':next();endStatement();return{k:'continue'};
   case'next':next();endStatement();return{k:'next'};
   case'nextfile':next();endStatement();return{k:'nextfile'};
   case'exit':{next();const v=is(';')||is('nl')||is('}')||is('eof')?undefined:expr();endStatement();return{k:'exit',v};}
   case'return':{next();const v=is(';')||is('nl')||is('}')||is('eof')?undefined:expr();endStatement();return{k:'return',v};}
   case'delete':{next();const name=expect('name').v;let subs:Node[]|undefined;if(is('[')){next();subs=exprList(']');expect(']');}endStatement();return{k:'delete',name,subs};}
   case'print':case'printf':{
    next();noGt++;let args:Node[]=[];
    if(!(is(';')||is('nl')||is('}')||is('>')||is('>>')||is('|')||is('eof'))){args=exprList('\u0000');if(args.length===1&&args[0].k==='group')args=args[0].list;}
    noGt--;const out=output();endStatement();return{k:t.t,args,...out};
   }
  }
  const s=simple();endStatement();return s;
 };
 const simple=():Node=>({k:'expr',e:expr()});
 term();
 while(!is('eof')){
  if(is('function')){next();const name=next();if(name.t!=='name'&&name.t!=='funcname')fail('expected a function name');expect('(');const params:string[]=[];while(!is(')')){nl();params.push(expect('name').v);nl();if(is(','))next();}expect(')');nl();functions.set(name.v,{params,body:block()});term();continue;}
  if(is('BEGIN')){next();nl();items.push({begin:true,action:block()});term();continue;}
  if(is('END')){next();nl();items.push({end:true,action:block()});term();continue;}
  let pattern:Node|undefined,pattern2:Node|undefined;
  if(!is('{')){pattern=expr();if(is(',')){next();nl();pattern2=expr();}}
  const action=is('{')?block():undefined;items.push({pattern,pattern2,action});term();
 }
 return{items,functions};
}
// ---------- values
const looksNumeric=(s:string)=>/^\s*[-+]?(?:(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|0[xX][0-9a-fA-F]+|inf(?:inity)?|nan)\s*$/i.test(s)&&!/^\s*[-+]?0[xX]/.test(s);
function toNum(v:V):number{
 if(typeof v==='number')return v;const s=typeof v==='string'?v:v.s;
 const m=/^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(s);if(m)return Number(m[0]);
 const special=/^\s*([-+]?)(inf|nan)/i.exec(s);if(special&&/^\s*[-+]/.test(s))return special[2].toLowerCase()==='inf'?(special[1]==='-'?-Infinity:Infinity):NaN;
 return 0;
}
const isNumeric=(v:V)=>typeof v==='number'||(v instanceof StrNum&&(v===UNINIT||looksNumeric(v.s)));
const truthy=(v:V)=>typeof v==='number'?v!==0:typeof v==='string'?v!=='':v===UNINIT?false:looksNumeric(v.s)?toNum(v)!==0:v.s!=='';

export const awk:Command=async ctx=>{
 let fs:string|undefined,src:string|undefined;const assigns:[string,string][]=[],files:string[]=[];
 const args=ctx.args;let k=0;
 for(;k<args.length;k++){
  const a=args[k];
  if(a==='--'){k++;break;}
  if(a==='-F'){fs=args[++k];continue;}if(a.startsWith('-F')){fs=a.slice(2);continue;}
  if(a==='-v'){const kv=args[++k]??'';const eq=kv.indexOf('=');if(eq<1)throw new CommandError(`invalid -v argument '${kv}'`,2);assigns.push([kv.slice(0,eq),kv.slice(eq+1)]);continue;}
  if(a.startsWith('-v')&&a.includes('=')){const kv=a.slice(2);const eq=kv.indexOf('=');assigns.push([kv.slice(0,eq),kv.slice(eq+1)]);continue;}
  if(a==='-f'){const f=args[++k]??'';try{src=(src?src+'\n':'')+decode(ctx.fs.readFile(ctx.resolve(f)));}catch(error){throw new CommandError(`can't open source file ${f}: ${describeError(error)}`,2);}continue;}
  if(a==='--posix'||a==='--traditional'||a==='-P'||a==='-W'||a==='--re-interval'||a==='--lint')continue;
  if(a.startsWith('-')&&a.length>1&&src===undefined&&!/^-\d/.test(a))throw new CommandError(`unknown option ${a}`,2);
  break;
 }
 if(src===undefined){if(k>=args.length)throw new CommandError("usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]",2);src=args[k++];}
 files.push(...args.slice(k));
 let program:ReturnType<typeof parseProgram>;
 try{program=parseProgram(src);}catch(error){if(error instanceof AwkSyntax)throw new CommandError(error.message,2);throw error;}
 return new Awk(ctx,program,fs,assigns,files).run();
};
const unescapeAssign=(s:string)=>s.replace(/\\(.)/g,(_,c)=>({n:'\n',t:'\t',r:'\r','\\':'\\'} as Record<string,string>)[c]??'\\'+c);

class Awk{
 globals=new Map<string,V|Arr>();frames:Map<string,V|Arr>[]=[];
 fields:string[]=[''];nf=0;fieldsDirty=false;record='';
 private out='';private outputs=new Map<string,{kind:'file';out:FileOutput}|{kind:'pipe';buffer:StringOutput;cmd:string}>();
 private readers=new Map<string,Input>();private regexCache=new Map<string,RegExp>();
 private rangeActive=new Map<number,boolean>();private status=0;private seed=0;private rand=mulberry(0);
 private mainInput:{files:string[];index:number;current?:Input;name:string;records?:AsyncGenerator<string>;sawFile?:boolean;usedStdin?:boolean};
 constructor(private ctx:CommandContext,private program:ReturnType<typeof parseProgram>,fs:string|undefined,assigns:[string,string][],files:string[]){
  const g=this.globals;
  g.set('FS',fs===undefined?' ':fs==='t'?'\t':unescapeAssign(fs));g.set('OFS',' ');g.set('ORS','\n');g.set('RS','\n');g.set('NR',0);g.set('NF',0);g.set('FNR',0);g.set('SUBSEP','\x1c');g.set('CONVFMT','%.6g');g.set('OFMT','%.6g');g.set('RSTART',0);g.set('RLENGTH',-1);g.set('FILENAME','');
  g.set('ENVIRON',new Map(Object.entries(ctx.env).map(([k,v])=>[k,new StrNum(v)])));
  g.set('ARGV',new Map([['0',new StrNum('awk')],...files.map((f,i)=>[String(i+1),new StrNum(f)] as [string,V])]));g.set('ARGC',files.length+1);
  for(const [name,value] of assigns)g.set(name,new StrNum(unescapeAssign(value)));
  this.mainInput={files,index:0,name:''};
 }
 async run():Promise<number>{
  const {items}=this.program;let exited=false;
  try{
   try{for(const item of items)if(item.begin)await this.exec(item.action!);}
   catch(e){if(e instanceof Exit){exited=true;this.status=e.status;}else throw e;}
   const main=items.filter(i=>!i.begin&&!i.end);
   if(!exited&&(main.length||items.some(i=>i.end))){
    try{
     for(let record=await this.nextMain();record!==null;record=await this.nextMain()){
      if(this.ctx.signal.aborted)throw this.ctx.signal.reason;
      this.setRecord(record);
      try{
       for(const [index,item] of main.entries()){
        if(!(await this.selected(item,index)))continue;
        if(item.action)await this.exec(item.action);else await this.print([],undefined,undefined);
       }
      }catch(e){if(e instanceof Next)continue;if(e instanceof NextFile){this.mainInput.current?.close();this.mainInput.current=undefined;this.mainInput.records=undefined;continue;}throw e;}
      if(this.out.length>65536)await this.flush();
     }
    }catch(e){if(e instanceof Exit){this.status=e.status;}else throw e;}
   }
   try{for(const item of items)if(item.end)await this.exec(item.action!);}catch(e){if(e instanceof Exit)this.status=e.status;else throw e;}
  }finally{await this.flush();await this.closeAll();}
  return this.status;
 }
 private async selected(item:{pattern?:Node;pattern2?:Node},index:number){
  if(!item.pattern)return true;
  if(!item.pattern2)return truthy(await this.eval(item.pattern));
  if(this.rangeActive.get(index)){if(truthy(await this.eval(item.pattern2)))this.rangeActive.set(index,false);return true;}
  if(truthy(await this.eval(item.pattern))){if(!truthy(await this.eval(item.pattern2)))this.rangeActive.set(index,true);return true;}
  return false;
 }
 // ---------- records and fields
 private str(v:V,fmt='CONVFMT'):string{if(typeof v==='string')return v;if(v instanceof StrNum)return v.s;if(Number.isInteger(v)&&Math.abs(v)<1e16)return String(v);if(Number.isNaN(v))return'nan';if(!Number.isFinite(v))return v>0?'inf':'-inf';return format(this.get(fmt) as string,()=>v).text;}
 private get(name:string):V|Arr{
  if(name==='NF'){this.syncFields();return this.nf;}
  const frame=this.frames.at(-1);if(frame?.has(name))return frame.get(name)!;
  return this.globals.get(name)??UNINIT;
 }
 private scalar(name:string):V{const v=this.get(name);if(v instanceof Map)throw new CommandError(`can't use array ${name} in scalar context`,2);return v;}
 private set(name:string,v:V){
  const frame=this.frames.at(-1);if(frame?.has(name)){if(frame.get(name) instanceof Map)throw new CommandError(`can't assign to ${name}; it's an array`,2);frame.set(name,v);return;}
  if(this.globals.get(name) instanceof Map)throw new CommandError(`can't assign to ${name}; it's an array`,2);
  // A new FS splits from the next record on: split this one with the old FS first.
  if(name==='FS')this.syncFields();
  this.globals.set(name,v);if(name==='NF')this.setNF(toNum(v));
 }
 private array(name:string):Arr{
  const frame=this.frames.at(-1);
  if(frame?.has(name)){const v=frame.get(name);if(v instanceof Map)return v;if(v!==UNINIT)throw new CommandError(`can't use scalar ${name} as array`,2);const a:Arr=new Map();frame.set(name,a);const ref=(frame as any).__refs?.get(name);if(ref)ref(a);return a;}
  const v=this.globals.get(name);if(v instanceof Map)return v;if(v!==undefined&&v!==UNINIT)throw new CommandError(`can't use scalar ${name} as array`,2);const a:Arr=new Map();this.globals.set(name,a);return a;
 }
 private setRecord(text:string){this.record=text;this.fieldsDirty=true;}
 private syncFields(){if(!this.fieldsDirty)return;this.fieldsDirty=false;const parts=this.split(this.record,this.scalar('FS'));this.fields=[this.record,...parts];this.nf=parts.length;this.globals.set('NF',this.nf);}
 private split(text:string,fsValue:V,paragraph=this.str(this.scalar('RS'))===''):string[]{
  const fsText=this.str(fsValue);
  if(fsText===' '){const t=text.replace(/^[ \t\n]+|[ \t\n]+$/g,'');return t?t.split(/[ \t\n]+/):[];}
  if(text==='')return[];
  if(fsText==='')return[...text];
  let parts:string[];
  if(fsText.length===1&&fsText!=='\\')parts=text.split(fsText);else parts=text.split(this.regex(fsText));
  if(paragraph&&fsText!=='\n')parts=parts.flatMap(p=>p.split('\n'));
  return parts;
 }
 private field(i:number):V{if(i<0)throw new CommandError(`trying to access out of range field ${i}`,2);this.syncFields();if(i===0)return new StrNum(this.record);return i<=this.nf?new StrNum(this.fields[i]):UNINIT;}
 private setField(i:number,v:string){
  if(i===0){this.setRecord(v);return;}
  this.syncFields();while(this.nf<i){this.fields.push('');this.nf++;}this.fields[i]=v;this.rebuild();
 }
 private setNF(n:number){this.syncFields();n=Math.max(0,Math.trunc(n));while(this.nf<n){this.fields.push('');this.nf++;}this.fields.length=n+1;this.nf=n;this.globals.set('NF',n);this.rebuild();}
 private rebuild(){this.record=this.fields.slice(1,this.nf+1).join(this.str(this.scalar('OFS')));this.fields[0]=this.record;this.globals.set('NF',this.nf);}
 private regex(source:string){let re=this.regexCache.get(source);if(!re){re=compileRegex(source,true);this.regexCache.set(source,re);}return re;}
 private dynRegex(n:Node):Promise<RegExp>|RegExp{if(n.k==='regex')return this.regex(n.v);return this.eval(n).then(v=>this.regex(this.str(v)));}
 // ---------- input
 private async readRecord(input:Input):Promise<string|null>{
  const rs=this.str(this.scalar('RS'));
  if(rs==='\n'){const line=await input.readLine();return line;}
  const reader=(input as any).__awkRecords as AsyncGenerator<string>|undefined??((input as any).__awkRecords=this.records(input,rs));
  const r=await reader.next();return r.done?null:r.value;
 }
 private async*records(input:Input,rs:string):AsyncGenerator<string>{
  let buffer='';const decoder=new TextDecoder();
  const sep=rs===''?/\n\n+/:rs.length===1?null:this.regex(rs);
  if(rs==='')buffer='';
  for(let chunk=await input.read();chunk;chunk=await input.read()){
   buffer+=decoder.decode(chunk,{stream:true});if(rs==='')buffer=buffer.replace(/^\n+/,'');
   for(;;){let idx:number,len:number;if(sep){sep.lastIndex=0;const m=sep.exec(buffer);if(!m||m.index+m[0].length===buffer.length)break;idx=m.index;len=m[0].length;}else{idx=buffer.indexOf(rs);if(idx<0)break;len=1;}yield buffer.slice(0,idx);buffer=buffer.slice(idx+len);}
  }
  buffer+=decoder.decode();if(rs==='')buffer=buffer.replace(/\n+$/,'');if(sep&&rs!==''){sep.lastIndex=0;buffer=buffer.replace(new RegExp('(?:'+sep.source+')$'),'');}
  if(buffer!=='')yield buffer;
 }
 /** The next main-input record: ARGV's files in turn (var=value operands assign as they are reached), stdin when there
  * are no files. */
 private async nextMain():Promise<string|null>{
  const m=this.mainInput;
  for(;;){
   if(!m.current&&!(await this.openNext()))return null;
   const record=await this.readRecord(m.current!);
   if(record===null){if(m.current!==this.ctx.stdin)m.current!.close();m.current=undefined;continue;}
   this.globals.set('NR',toNum(this.scalar('NR'))+1);this.globals.set('FNR',toNum(this.scalar('FNR'))+1);
   return record;
  }
 }
 private async openNext():Promise<boolean>{
  const m=this.mainInput,argv=this.globals.get('ARGV') as Arr,argc=toNum(this.scalar('ARGC'));
  while(m.index<argc-1){
   const arg=argv.get(String(++m.index)),name=arg===undefined?'':this.str(arg);if(!name)continue;
   const eq=/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(name);if(eq){this.set(eq[1],new StrNum(unescapeAssign(eq[2])));continue;}
   m.sawFile=true;
   if(name==='-'||name==='/dev/stdin')m.current=this.ctx.stdin;
   else{try{m.current=new FileInput(this.ctx.fs,this.ctx.resolve(name));}catch(error){await this.flush();await this.ctx.err(`awk: can't open file ${name}: ${describeError(error)}\n`);this.status=2;continue;}}
   m.name=name;this.globals.set('FILENAME',name);this.globals.set('FNR',0);return true;
  }
  if(!m.sawFile&&!m.usedStdin){m.usedStdin=true;m.current=this.ctx.stdin;m.name='';this.globals.set('FNR',0);return true;}
  return false;
 }
 // ---------- output
 private async flush(){if(this.out){const text=this.out;this.out='';await this.ctx.out(text);}}
 private async write(text:string,mode?:string,dest?:Node){
  if(!mode){this.out+=text;return;}
  const name=this.str(await this.eval(dest!));
  if(name==='/dev/stdout'||name==='-'){this.out+=text;return;}
  if(name==='/dev/stderr'){await this.flush();await this.ctx.err(text);return;}
  let o=this.outputs.get(name);
  if(!o){if(mode==='|')o={kind:'pipe',buffer:new StringOutput(),cmd:name};else{try{o={kind:'file',out:new FileOutput(this.ctx.fs,this.ctx.resolve(name),mode==='>>')};}catch(error){throw new CommandError(`can't redirect to ${name}: ${describeError(error)}`,2);}}this.outputs.set(name,o);}
  if(o.kind==='file')await o.out.write(text);else await o.buffer.write(text);
 }
 private async closeOne(name:string):Promise<number>{
  const o=this.outputs.get(name);
  if(o){this.outputs.delete(name);if(o.kind==='file'){o.out.close();return 0;}await this.flush();return this.ctx.script(o.cmd,{io:{in:new BytesInput(o.buffer.bytes())}});}
  const r=this.readers.get(name);if(r){r.close();this.readers.delete(name);return 0;}
  return-1;
 }
 private async closeAll(){for(const name of[...this.outputs.keys()])await this.closeOne(name);for(const r of this.readers.values())r.close();this.readers.clear();}
 private async print(args:Node[],mode?:string,dest?:Node){
  let text:string;
  if(!args.length){this.syncFields();text=this.record;}
  else{const parts:string[]=[];for(const a of args){const v=await this.eval(a);parts.push(typeof v==='number'?this.str(v,'OFMT'):this.str(v));}text=parts.join(this.str(this.scalar('OFS')));}
  await this.write(text+this.str(this.scalar('ORS')),mode,dest);
 }
 private sprintf(fmt:string,values:V[]){let i=0;return format(fmt,():Arg=>{const v=values[i++];if(v===undefined)return undefined;if(typeof v==='number')return v;if(v instanceof StrNum&&v!==UNINIT&&looksNumeric(v.s))return toNum(v);return this.str(v);},{awk:true}).text;}
 // ---------- statements
 private async exec(n:Node):Promise<void>{
  switch(n.k){
   case'block':for(const s of n.body)await this.exec(s);return;
   case'expr':await this.eval(n.e);return;
   case'print':return this.print(n.args,n.mode,n.dest);
   case'printf':{if(!n.args.length)throw new CommandError('printf: no format',2);const values=[];for(const a of n.args)values.push(await this.eval(a));await this.write(this.sprintf(this.str(values[0]),values.slice(1)),n.mode,n.dest);return;}
   case'if':if(truthy(await this.eval(n.c)))await this.exec(n.a);else if(n.b)await this.exec(n.b);return;
   case'while':{let guard=0;while(truthy(await this.eval(n.c))){try{await this.exec(n.body);}catch(e){if(e instanceof Break)break;if(e instanceof Continue)continue;throw e;}if(++guard%10000===0)await this.tick();}return;}
   case'do':{let guard=0;do{try{await this.exec(n.body);}catch(e){if(e instanceof Break)break;if(e instanceof Continue)continue;throw e;}if(++guard%10000===0)await this.tick();}while(truthy(await this.eval(n.c)));return;}
   case'for':{let guard=0;if(n.init)await this.exec(n.init);while(!n.c||truthy(await this.eval(n.c))){try{await this.exec(n.body);}catch(e){if(e instanceof Break)break;if(!(e instanceof Continue))throw e;}if(n.step)await this.exec(n.step);if(++guard%10000===0)await this.tick();}return;}
   case'forin':{const arr=this.array(n.arr);for(const key of[...arr.keys()]){if(!arr.has(key))continue;this.set(n.v,new StrNum(key));try{await this.exec(n.body);}catch(e){if(e instanceof Break)break;if(!(e instanceof Continue))throw e;}}return;}
   case'break':throw new Break();case'continue':throw new Continue();case'next':throw new Next();case'nextfile':throw new NextFile();
   case'exit':throw new Exit(n.v?Math.trunc(toNum(await this.eval(n.v)))&255:this.status);
   case'return':throw new Return(n.v?await this.eval(n.v):UNINIT);
   case'delete':{const arr=this.array(n.name);if(!n.subs)arr.clear();else arr.delete(await this.key(n.subs));return;}
  }
  throw new CommandError(`unknown statement ${n.k}`,2);
 }
 private async tick(){if(this.ctx.signal.aborted)throw this.ctx.signal.reason;await new Promise(r=>setTimeout(r,0));}
 private async key(subs:Node[]){const parts:string[]=[];for(const s of subs)parts.push(this.str(await this.eval(s)));return parts.join(this.str(this.scalar('SUBSEP')));}
 private async assignTo(target:Node,v:V){
  if(target.k==='var')this.set(target.name,v);
  else if(target.k==='field')this.setField(Math.trunc(toNum(await this.eval(target.index))),this.str(v));
  else if(target.k==='index')this.array(target.name).set(await this.key(target.subs),v);
  return v;
 }
 private async read(target:Node):Promise<V>{
  if(target.k==='var')return this.scalar(target.name);
  if(target.k==='field')return this.field(Math.trunc(toNum(await this.eval(target.index))));
  const arr=this.array(target.name),key=await this.key(target.subs);if(!arr.has(key))arr.set(key,UNINIT);return arr.get(key)!;
 }
 // ---------- expressions
 private async eval(n:Node):Promise<V>{
  switch(n.k){
   case'num':return n.v;case'str':return n.v;
   case'regex':{this.syncFields();return this.regex(n.v).test(this.record)?1:0;}
   case'paren':return this.eval(n.a);
   case'group':return this.key(n.list);
   case'var':case'field':case'index':return this.read(n);
   case'assign':{
    if(n.op==='=')return this.assignTo(n.target,await this.eval(n.value));
    const b=toNum(await this.eval(n.value)),a=toNum(await this.read(n.target));return this.assignTo(n.target,this.arith(n.op.slice(0,-1),a,b));
   }
   case'cond':return truthy(await this.eval(n.c))?this.eval(n.a):this.eval(n.b);
   case'or':return truthy(await this.eval(n.a))||truthy(await this.eval(n.b))?1:0;
   case'and':return truthy(await this.eval(n.a))&&truthy(await this.eval(n.b))?1:0;
   case'in':return this.array(n.name).has(await this.key(n.subs))?1:0;
   case'match':{const s=this.str(await this.eval(n.a)),re=await this.dynRegex(n.re);return re.test(s)!==n.neg?1:0;}
   case'cmp':{
    const a=await this.eval(n.a),b=await this.eval(n.b);let r:number;
    if(isNumeric(a)&&isNumeric(b)){const x=toNum(a),y=toNum(b);r=x<y?-1:x>y?1:0;}else{const x=this.str(a),y=this.str(b);r=x<y?-1:x>y?1:0;}
    switch(n.op){case'<':return r<0?1:0;case'<=':return r<=0?1:0;case'>':return r>0?1:0;case'>=':return r>=0?1:0;case'==':return r===0?1:0;case'!=':return r!==0?1:0;}
    return 0;
   }
   case'concat':return this.str(await this.eval(n.a))+this.str(await this.eval(n.b));
   case'bin':return this.arith(n.op,toNum(await this.eval(n.a)),toNum(await this.eval(n.b)));
   case'not':return truthy(await this.eval(n.a))?0:1;
   case'neg':return-toNum(await this.eval(n.a));
   case'pos':return toNum(await this.eval(n.a));
   case'incdec':{const old=toNum(await this.read(n.target)),v=old+n.delta;await this.assignTo(n.target,v);return n.post?old:v;}
   case'getline':return this.getline(n);
   case'call':return this.call(n.name,n.args);
   case'builtin':return this.builtin(n.name,n.args);
  }
  throw new CommandError(`unknown expression ${n.k}`,2);
 }
 private arith(op:string,a:number,b:number):number{
  switch(op){case'+':return a+b;case'-':return a-b;case'*':return a*b;case'/':if(b===0)throw new CommandError('division by zero',2);return a/b;case'%':if(b===0)throw new CommandError('division by zero in %',2);return a%b;case'^':return a**b;}
  throw new CommandError('bad operator '+op,2);
 }
 private async getline(n:Node):Promise<V>{
  let record:string|null;
  if(n.from==='main'){await this.flush();record=await this.nextMain();if(record===null)return 0;}
  else{
   const name=this.str(await this.eval(n.src));let reader=this.readers.get(name);
   if(!reader){
    if(n.from==='file'){if(name==='-'||name==='/dev/stdin')reader=this.ctx.stdin;else{try{reader=new FileInput(this.ctx.fs,this.ctx.resolve(name));}catch{return-1;}}}
    else{await this.flush();const out=new StringOutput();await this.ctx.script(name,{io:{out}});reader=new BytesInput(out.bytes());}
    this.readers.set(name,reader);
   }
   record=await this.readRecord(reader);if(record===null)return 0;
   if(n.from==='cmd')this.globals.set('NR',toNum(this.scalar('NR'))+1);
  }
  if(n.target)await this.assignTo(n.target,new StrNum(record));else this.setRecord(record);
  return 1;
 }
 private async call(name:string,args:Node[]):Promise<V>{
  const fn=this.program.functions.get(name);if(!fn)throw new CommandError(`calling undefined function ${name}`,2);
  if(this.frames.length>500)throw new CommandError('function call nesting is too deep',2);
  const frame=new Map<string,V|Arr>(),refs=new Map<string,(a:Arr)=>void>();
  for(const [i,param] of fn.params.entries()){
   const a=args[i];
   if(!a){frame.set(param,UNINIT);continue;}
   if(a.k==='var'){const v=this.get(a.name);if(v instanceof Map){frame.set(param,v);continue;}if(v===UNINIT){frame.set(param,UNINIT);const owner=this.frames.at(-1)?.has(a.name)?this.frames.at(-1)!:this.globals;refs.set(param,arr=>owner.set(a.name,arr));continue;}}
   frame.set(param,await this.eval(a));
  }
  (frame as any).__refs=refs;this.frames.push(frame);
  try{await this.exec(fn.body);return UNINIT;}
  catch(e){if(e instanceof Return)return e.value;throw e;}
  finally{this.frames.pop();}
 }
 private async builtin(name:string,args:Node[]):Promise<V>{
  const s=async(i:number)=>this.str(await this.eval(args[i]));const num=async(i:number)=>toNum(await this.eval(args[i]));
  switch(name){
   case'length':{if(!args.length){this.syncFields();return[...this.record].length;}const a=args[0];if(a.k==='var'){const v=this.get(a.name);if(v instanceof Map)return v.size;}return[...await s(0)].length;}
   case'substr':{const str=[...await s(0)];let m=Math.round(await num(1));let len=args.length>2?Math.round(await num(2)):Infinity;if(Number.isNaN(len))len=0;let start=m;if(start<1){len+=start-1;start=1;}if(len<=0)return'';return str.slice(start-1,len===Infinity?undefined:start-1+len).join('');}
   case'index':{const hay=await s(0),needle=await s(1);const i=hay.indexOf(needle);return i<0?0:[...hay.slice(0,i)].length+1;}
   case'split':{
    const text=await s(0),arrName=args[1];if(arrName?.k!=='var')throw new CommandError('split: second argument is not an array',2);
    const arr=this.array(arrName.name);arr.clear();
    let parts:string[];if(args[2]){const sep=args[2].k==='regex'?args[2].v:await s(2);parts=args[2].k==='regex'?(text===''?[]:text.split(this.regex(sep))):this.split(text,sep,false);}else parts=this.split(text,this.scalar('FS'),false);
    parts.forEach((p,i)=>arr.set(String(i+1),new StrNum(p)));return parts.length;
   }
   case'sub':case'gsub':{
    const re=await this.dynRegex(args[0]),repl=await s(1),target=args[2]??{k:'field',index:{k:'num',v:0}};
    const text=this.str(await this.read(target));let count=0;
    const g=new RegExp(re.source,re.flags.replace('g','')+'g');let out='',last=0;
    for(let m=g.exec(text);m;m=g.exec(text)){
     count++;out+=text.slice(last,m.index)+repl.replace(/\\\\|\\&|&/g,t=>t==='&'?m![0]:t==='\\&'?'&':'\\');last=m.index+m[0].length;
     if(m[0]===''){if(m.index<text.length)out+=text[m.index];last=m.index+1;g.lastIndex=m.index+1;}
     if(name==='sub')break;
    }
    if(count){out+=text.slice(last);await this.assignTo(target,out);}
    return count;
   }
   case'gensub':{
    const re=await this.dynRegex(args[0]),repl=await s(1),how=await s(2),target=args[3]?await s(3):(this.syncFields(),this.record);
    const global=/^[gG]/.test(how),nth=global?0:Math.max(1,Math.trunc(toNum(how))||1);let n=0;
    return target.replace(new RegExp(re.source,re.flags.replace('g','')+'g'),(...m)=>{n++;if(!global&&n!==nth)return m[0];const groups=m.slice(0,-2);return repl.replace(/\\(\d)|\\&|&/g,(t,d)=>d!==undefined?groups[Number(d)]??'':t==='&'?groups[0]:'&');});
   }
   case'match':{
    const str=await s(0),re=await this.dynRegex(args[1]),m=re.exec(str);
    if(args[2]?.k==='var'){const arr=this.array(args[2].name);arr.clear();if(m)m.forEach((g,i)=>{if(g!==undefined){arr.set(String(i),new StrNum(g));arr.set(i+'\x1cstart',[...str.slice(0,m.index)].length+1+(i?str.slice(m.index).indexOf(g):0));arr.set(i+'\x1clength',[...g].length);}});}
    if(!m){this.globals.set('RSTART',0);this.globals.set('RLENGTH',-1);return 0;}
    const start=[...str.slice(0,m.index)].length+1;this.globals.set('RSTART',start);this.globals.set('RLENGTH',[...m[0]].length);return start;
   }
   case'sprintf':{if(!args.length)return'';const values:V[]=[];for(const a of args)values.push(await this.eval(a));return this.sprintf(this.str(values[0]),values.slice(1));}
   case'sin':return Math.sin(await num(0));case'cos':return Math.cos(await num(0));case'atan2':return Math.atan2(await num(0),await num(1));
   case'exp':return Math.exp(await num(0));case'log':return Math.log(await num(0));case'sqrt':return Math.sqrt(await num(0));case'int':return Math.trunc(await num(0));
   case'rand':return this.rand();
   case'srand':{const old=this.seed;this.seed=args.length?await num(0):Math.floor(Date.now()/1000);this.rand=mulberry(this.seed);return old;}
   case'tolower':return(await s(0)).toLowerCase();case'toupper':return(await s(0)).toUpperCase();
   case'system':{await this.flush();const cmd=await s(0);return this.ctx.script(cmd);}
   case'close':return this.closeOne(await s(0));
   case'fflush':await this.flush();return 0;
   case'systime':return Math.floor(Date.now()/1000);
   case'strftime':{const fmt=args.length?await s(0):'%a %b %e %H:%M:%S %Z %Y',t=args.length>1?await num(1):Date.now()/1000;return strftime(fmt,new Date(t*1000),args.length>2&&truthy(await this.eval(args[2])));}
   case'asort':case'asorti':{
    const src=args[0]?.k==='var'?this.array(args[0].name):new Map();const values=name==='asort'?[...src.values()]:[...src.keys()].map(k=>new StrNum(k));
    values.sort((a,b)=>isNumeric(a)&&isNumeric(b)?toNum(a)-toNum(b):this.str(a)<this.str(b)?-1:this.str(a)>this.str(b)?1:0);
    const dest=args[1]?.k==='var'?this.array(args[1].name):src;dest.clear();values.forEach((v,i)=>dest.set(String(i+1),v));return values.length;
   }
  }
  throw new CommandError(`unknown function ${name}`,2);
 }
}
function mulberry(seed:number){let a=Math.floor(seed*1000)>>>0||0x9e3779b9;return()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
/** The common strftime fields, for awk's strftime and date +FORMAT. */
export function strftime(fmt:string,d:Date,utc=false):string{
 const get=(local:()=>number,u:()=>number)=>utc?u():local();
 const Y=get(()=>d.getFullYear(),()=>d.getUTCFullYear()),m=get(()=>d.getMonth(),()=>d.getUTCMonth()),D=get(()=>d.getDate(),()=>d.getUTCDate()),H=get(()=>d.getHours(),()=>d.getUTCHours()),M=get(()=>d.getMinutes(),()=>d.getUTCMinutes()),S=get(()=>d.getSeconds(),()=>d.getUTCSeconds()),w=get(()=>d.getDay(),()=>d.getUTCDay());
 const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'],months=['January','February','March','April','May','June','July','August','September','October','November','December'];
 const p=(n:number,w=2,c='0')=>String(n).padStart(w,c);const start=Date.UTC(Y,0,1),yday=Math.floor((Date.UTC(Y,m,D)-start)/86400000)+1;
 const offset=utc?0:-d.getTimezoneOffset(),z=(offset>=0?'+':'-')+p(Math.floor(Math.abs(offset)/60))+p(Math.abs(offset)%60);
 return fmt.replace(/%([a-zA-Z%])/g,(_,c)=>{switch(c){
  case'Y':return String(Y);case'y':return p(Y%100);case'm':return p(m+1);case'd':return p(D);case'e':return p(D,2,' ');case'H':return p(H);case'I':return p(H%12||12);case'M':return p(M);case'S':return p(S);
  case'p':return H<12?'AM':'PM';case'a':return days[w].slice(0,3);case'A':return days[w];case'b':case'h':return months[m].slice(0,3);case'B':return months[m];case'j':return p(yday,3);
  case'Z':return utc?'UTC':'';case'z':return z;case's':return String(Math.floor(d.getTime()/1000));case'n':return'\n';case't':return'\t';case'%':return'%';case'u':return String(w||7);case'w':return String(w);
  case'F':return`${Y}-${p(m+1)}-${p(D)}`;case'T':return`${p(H)}:${p(M)}:${p(S)}`;case'D':return`${p(m+1)}/${p(D)}/${p(Y%100)}`;case'R':return`${p(H)}:${p(M)}`;case'c':return`${days[w].slice(0,3)} ${months[m].slice(0,3)} ${p(D,2,' ')} ${p(H)}:${p(M)}:${p(S)} ${Y}`;
  case'N':return p(d.getMilliseconds()*1e6,9);default:return'%'+c;}});
}
