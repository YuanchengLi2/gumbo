import type {SandboxFS} from '../fs/types';

/** POSIX character classes as the inside of a JS character class; shared by globs, grep/sed regexes and tr. */
export const posixClasses:Record<string,string>={alpha:'a-zA-Z',digit:'0-9',alnum:'a-zA-Z0-9',upper:'A-Z',lower:'a-z',space:' \\t\\n\\r\\f\\v',blank:' \\t',punct:'!-\\/:-@\\[-`{-~',xdigit:'0-9A-Fa-f',cntrl:'\\x00-\\x1f\\x7f',print:'\\x20-\\x7e',graph:'\\x21-\\x7e',word:'\\w'};
export const escapeRegex=(text:string)=>text.replace(/[\\^$.*+?()[\]{}|/]/g,'\\$&');
/** Escapes a literal for use inside a pattern, so quoted text never globs. */
export const escapeGlob=(text:string)=>text.replace(/[\\*?[\]]/g,'\\$&');
export const unescapeGlob=(pattern:string)=>pattern.replace(/\\(.)/gs,'$1');
export const hasGlob=(pattern:string)=>{for(let i=0;i<pattern.length;i++){const c=pattern[i];if(c==='\\'){i++;continue;}if(c==='*'||c==='?')return true;if(c==='['&&bracketEnd(pattern,i)>0)return true;}return false;};
function bracketEnd(p:string,start:number){let i=start+1;if(p[i]==='!'||p[i]==='^')i++;if(p[i]===']')i++;for(;i<p.length;i++){if(p[i]==='\\'){i++;continue;}if(p[i]==='['&&p[i+1]===':'){const end=p.indexOf(':]',i+2);if(end>0){i=end+1;continue;}}if(p[i]===']')return i;}return-1;}
/** A bracket expression's inside, from glob or POSIX regex syntax, as a JS character class. */
export function bracketClass(inner:string,regex=false){
 let out='',i=0;if((inner[0]==='!'&&!regex)||inner[0]==='^'){out='^';i=1;}
 for(;i<inner.length;i++){
  const c=inner[i];
  if(c==='['&&inner[i+1]===':'){const end=inner.indexOf(':]',i+2);if(end>0){out+=posixClasses[inner.slice(i+2,end)]??'';i=end+1;continue;}}
  if(c==='['&&(inner[i+1]==='='||inner[i+1]==='.')){const end=inner.indexOf(inner[i+1]+']',i+2);if(end>0){out+=escapeRegex(inner.slice(i+2,end));i=end+1;continue;}}
  if(c==='\\'){out+='\\\\';continue;}
  out+=c===']'||c==='['||c==='^'?'\\'+c:c;
 }
 return'['+out+']';
}
/** A shell pattern as RegExp source. In pathname mode * and ? never match "/". */
export function globSource(pattern:string,pathname=false){
 let re='';
 for(let i=0;i<pattern.length;i++){
  const c=pattern[i];
  if(c==='\\'){re+=escapeRegex(pattern[++i]??'\\');continue;}
  if(c==='*'){while(pattern[i+1]==='*')i++;re+=pathname?'[^/]*':'[\\s\\S]*';continue;}
  if(c==='?'){re+=pathname?'[^/]':'[\\s\\S]';continue;}
  if(c==='['){const end=bracketEnd(pattern,i);if(end>0){re+=bracketClass(pattern.slice(i+1,end));i=end;continue;}}
  re+=escapeRegex(c);
 }
 return re;
}
export const globRegex=(pattern:string,flags='',pathname=false)=>new RegExp('^(?:'+globSource(pattern,pathname)+')$',flags);
/** Expands a pathname pattern against the file system: segment by segment, hidden names only when the segment starts
 * with a literal ".", sorted. Returns [] when nothing matches (the caller keeps the word as it was). */
export function glob(fs:SandboxFS,cwd:string,pattern:string):string[]{
 const absolute=pattern.startsWith('/'),segments=pattern.split('/').filter((s,i)=>s||i===0);
 let found:string[]=[absolute?'/':''];
 for(const [index,segment] of segments.entries()){
  if(absolute&&index===0&&!segment)continue;
  const next:string[]=[];
  if(!hasGlob(segment)){const name=unescapeGlob(segment);for(const base of found){const path=join(base,name);if(index===segments.length-1?exists(fs,cwd,path):isDir(fs,cwd,path))next.push(path);}}
  else{const re=globRegex(segment,'',true),hidden=segment.startsWith('.');
   for(const base of found){let names:string[];try{names=fs.readdir(full(cwd,base||'.'));}catch{continue;}
    for(const name of names)if((hidden||!name.startsWith('.'))&&re.test(name)){const path=join(base,name);if(index===segments.length-1||isDir(fs,cwd,path))next.push(path);}}}
  found=next;if(!found.length)return[];
 }
 return found.sort((a,b)=>a<b?-1:a>b?1:0);
}
const join=(base:string,name:string)=>base===''?name:base.endsWith('/')?base+name:base+'/'+name;
const full=(cwd:string,path:string)=>path.startsWith('/')?path:(cwd.endsWith('/')?cwd:cwd+'/')+path;
const exists=(fs:SandboxFS,cwd:string,path:string)=>{try{fs.stat(full(cwd,path));return true;}catch{return false;}};
const isDir=(fs:SandboxFS,cwd:string,path:string)=>{try{return fs.stat(full(cwd,path)).type==='directory';}catch{return false;}};
