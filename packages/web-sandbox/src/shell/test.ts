import type {SandboxFS,FileStat} from '../fs/types';
import {CommandError} from './types';
import {globRegex} from './pattern';

const UNARY=new Set(['-e','-f','-d','-s','-r','-w','-x','-L','-h','-z','-n','-p','-S','-b','-c','-t','-O','-G','-a','-g','-u','-k','-N','-v']);
const BINARY=new Set(['=','==','!=','<','>','-eq','-ne','-lt','-le','-gt','-ge','-nt','-ot','-ef','=~']);
/** test, [ and [[: file checks, strings and integers. In [[ ]] (extended) the right side of == and != is a pattern
 * (indexes in `patterns`), =~ is a regex, and && || join; in test, -a and -o do. */
export function evalTest(args:string[],fs:SandboxFS,resolve:(path:string)=>string,options:{extended?:boolean;patterns?:Set<number>;vars?:(name:string)=>string|undefined;match?:(groups:string[])=>void}={}):boolean{
 const {extended=false}=options;let i=0;
 const stat=(path:string,link=false):FileStat|undefined=>{if(!path)return undefined;try{return link&&fs.lstat?fs.lstat(resolve(path)):fs.stat(resolve(path));}catch{return undefined;}};
 const int=(s:string)=>{const t=s.trim();if(!/^[-+]?\d+$/.test(t))throw new CommandError(`${s}: integer expression expected`,2);return Number(t);};
 const unary=(op:string,arg:string):boolean=>{
  switch(op){
   case'-z':return arg==='';case'-n':return arg!=='';
   case'-e':case'-a':return!!stat(arg);case'-f':return stat(arg)?.type==='file';case'-d':return stat(arg)?.type==='directory';
   case'-s':return(stat(arg)?.size??0)>0;case'-r':case'-w':case'-O':case'-G':case'-N':return!!stat(arg);
   case'-x':{const s=stat(arg);return!!s&&(s.type==='directory'||(s.mode&0o111)!==0);}
   case'-L':case'-h':return stat(arg,true)?.type==='symlink';
   case'-v':return options.vars?.(arg)!==undefined;
   default:return false;
  }
 };
 const binary=(a:string,op:string,b:string,index:number):boolean=>{
  switch(op){
   case'=':case'==':return extended&&options.patterns?.has(index)?globRegex(b,'s').test(a):a===b;
   case'!=':return extended&&options.patterns?.has(index)?!globRegex(b,'s').test(a):a!==b;
   case'<':return a<b;case'>':return a>b;
   case'-eq':return int(a)===int(b);case'-ne':return int(a)!==int(b);case'-lt':return int(a)<int(b);case'-le':return int(a)<=int(b);case'-gt':return int(a)>int(b);case'-ge':return int(a)>=int(b);
   case'-nt':return(stat(a)?.mtimeMs??-Infinity)>(stat(b)?.mtimeMs??-Infinity);case'-ot':return(stat(a)?.mtimeMs??Infinity)<(stat(b)?.mtimeMs??Infinity);
   case'-ef':return!!stat(a)&&resolve(a)===resolve(b);
   case'=~':{let re:RegExp;try{re=new RegExp(b);}catch{throw new CommandError(`invalid regex: ${b}`,2);}const m=re.exec(a);if(m)options.match?.([...m].map(s=>s??''));return!!m;}
  }
  throw new CommandError(`${op}: binary operator expected`,2);
 };
 const or=extended?'||':'-o',and=extended?'&&':'-a';
 const expr=():boolean=>{let v=conj();while(args[i]===or){i++;const r=conj();v=v||r;}return v;};
 const conj=():boolean=>{let v=neg();while(args[i]===and){i++;const r=neg();v=v&&r;}return v;};
 const neg=():boolean=>{if(args[i]==='!'&&i+1<args.length){i++;return!neg();}return primary();};
 const primary=():boolean=>{
  if(i>=args.length)throw new CommandError('argument expected',2);
  const a=args[i];
  if(a==='('&&args.length-i>1&&!(BINARY.has(args[i+1])&&i+2<args.length&&args[i+3]!==')')){i++;const v=expr();if(args[i]!==')')throw new CommandError("')' expected",2);i++;return v;}
  if(i+2<args.length&&BINARY.has(args[i+1])){const b=args[i+2],index=i+2;i+=3;return binary(a,args[i-2],b,index);}
  if(UNARY.has(a)&&i+1<args.length){i+=2;return unary(a,args[i-1]);}
  i++;return a!=='';
 };
 if(!args.length)return false;
 // test's classic argument-count rules, so `[ "$x" = -f ]` and `[ -n ]` read as POSIX says.
 if(!extended&&args.length===1)return args[0]!=='';
 if(!extended&&args.length===2){if(args[0]==='!')return args[1]==='';if(UNARY.has(args[0]))return unary(args[0],args[1]);throw new CommandError(`${args[0]}: unary operator expected`,2);}
 if(!extended&&args.length===3&&BINARY.has(args[1]))return binary(args[0],args[1],args[2],2);
 const value=expr();if(i<args.length)throw new CommandError(`${args[i]}: unexpected argument`,2);return value;
}
