import {CommandError,type Command,type CommandContext} from '../shell/types';
import {parseArgs,humanSize,modeString} from './common';
import {describeError,errorCode,type FileStat} from '../fs/types';
import {tryStat,copyFile,removeTree,mkdirp,walk,decode} from '../fs/util';
import {join,basename as base,dirname as dir,normalize,relative} from '../path';
import {globRegex} from '../shell/pattern';
import {compileRegex} from './regex';
import {format} from './format';
import {strftime} from './awk';

const fail=async(ctx:CommandContext,message:string)=>{await ctx.err(`${ctx.name}: ${message}\n`);};
const lstat=(ctx:CommandContext,path:string)=>ctx.fs.lstat?.(path)??ctx.fs.stat(path);
const dateText=(ms:number)=>{const d=new Date(ms),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const old=Date.now()-ms>180*86400000||ms>Date.now()+3600000;return`${months[d.getMonth()]} ${String(d.getDate()).padStart(2)} ${old?String(d.getFullYear()).padStart(5):String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0')}`;};

const ls:Command=async ctx=>{
 const {opts,rest}=parseArgs('ls',ctx.args,{flags:'laA1RhtSrdFpUnogGisc',long:{all:'a','almost-all':'A',recursive:'R','human-readable':'h',reverse:'r',directory:'d',classify:'F',color:'color','color=':'color','group-directories-first':'gdf','full-time':'full','sort=':'sortBy','time-style=':'timeStyle'}});
 const long=opts.l||opts.n||opts.o||opts.g,state={status:0};
 const decorate=(name:string,s:FileStat)=>name+(opts.F||opts.p?(s.type==='directory'?'/':s.type==='symlink'&&opts.F?'@':opts.F&&(s.mode&0o111)?'*':''):'');
 const sortEntries=(entries:{name:string;stat:FileStat}[])=>{
  if(!opts.U){entries.sort((a,b)=>opts.t?b.stat.mtimeMs-a.stat.mtimeMs||(a.name<b.name?-1:1):opts.S?b.stat.size-a.stat.size||(a.name<b.name?-1:1):a.name<b.name?-1:a.name>b.name?1:0);if(opts.gdf)entries.sort((a,b)=>+(b.stat.type==='directory')-+(a.stat.type==='directory'));}
  if(opts.r)entries.reverse();return entries;
 };
 const line=async(name:string,s:FileStat,path:string)=>{
  if(!long){await ctx.out(decorate(name,s)+'\n');return;}
  const size=opts.h?humanSize(s.size):String(s.size),link=s.type==='symlink'&&ctx.fs.readlink?' -> '+ctx.fs.readlink(path):'';
  await ctx.out(`${modeString(s)} 1 ${opts.g?'':'user '}${opts.o?'':'user '}${size.padStart(8)} ${dateText(s.mtimeMs)} ${decorate(name,s)}${link}\n`);
 };
 const listDir=async(path:string,label:string,header:boolean)=>{
  if(header)await ctx.out(`${label}:\n`);
  let names:string[];try{names=ctx.fs.readdir(path);}catch(error){await fail(ctx,`cannot open directory '${label}': ${describeError(error)}`);state.status=2;return;}
  const entries=sortEntries(names.filter(n=>opts.a||opts.A||!n.startsWith('.')).map(name=>{let stat:FileStat;try{stat=lstat(ctx,join(path,name));}catch{stat={type:'file',size:0,mtimeMs:0,mode:0};}return{name,stat};}));
  if(opts.a)entries.unshift({name:'.',stat:ctx.fs.stat(path)},{name:'..',stat:ctx.fs.stat(dir(path))});
  if(long)await ctx.out(`total ${Math.ceil(entries.reduce((n,e)=>n+e.stat.size,0)/1024)}\n`);
  for(const e of entries)await line(e.name,e.stat,join(path,e.name));
  if(opts.R)for(const e of entries)if(e.stat.type==='directory'&&e.name!=='.'&&e.name!=='..'){await ctx.out('\n');await listDir(join(path,e.name),label==='.'?e.name:join(label,e.name),true);}
 };
 const targets=rest.length?rest:['.'],files:{name:string;stat:FileStat;path:string}[]=[],dirs:{name:string;path:string}[]=[];
 for(const t of targets){const path=ctx.resolve(t);let s:FileStat;try{s=ctx.fs.stat(path);}catch(error){await fail(ctx,`cannot access '${t}': ${describeError(error)}`);state.status=2;continue;}if(s.type==='directory'&&!opts.d)dirs.push({name:t,path});else files.push({name:t,stat:s,path});}
 for(const f of sortEntries(files as never) as typeof files)await line(f.name,f.stat,f.path);
 for(const [k,d] of dirs.entries()){if(k||files.length)await ctx.out('\n');await listDir(d.path,d.name,targets.length>1||!!opts.R);}
 return state.status;
};
/** find with the usual tests and actions; expressions join with -a/-o/!/( ). */
type FindNode={k:'and';a:FindNode;b:FindNode}|{k:'or';a:FindNode;b:FindNode}|{k:'not';a:FindNode}|{k:'test';name:string;arg?:string;args?:string[]};
const find:Command=async ctx=>{
 const args=ctx.args;let i=0;const paths:string[]=[];
 while(i<args.length&&!args[i].startsWith('-')&&args[i]!=='!'&&args[i]!=='(')paths.push(args[i++]);
 if(!paths.length)paths.push('.');
 const takes=new Set(['-name','-iname','-path','-ipath','-wholename','-regex','-iregex','-type','-maxdepth','-mindepth','-size','-mtime','-mmin','-newer','-perm','-user','-group','-printf','-fprint','-links','-atime','-ctime','-amin','-cmin','-xtype','-regextype','-samefile','-inum','-uid','-gid']);
 let maxDepth=Infinity,minDepth=0,depthFirst=false;let hasAction=false;
 const primary=():FindNode=>{
  const a=args[i++];if(a===undefined)throw new CommandError('expected an expression',1);
  if(a==='('||a==='\\('){const e=or();if(args[i++]!==')')throw new CommandError("missing ')'",1);return e;}
  if(a==='!'||a==='-not')return{k:'not',a:primary()};
  if(a==='-exec'||a==='-execdir'||a==='-ok'||a==='-okdir'){const cmd:string[]=[];while(i<args.length&&args[i]!==';'&&args[i]!=='+')cmd.push(args[i++]);const end=args[i++];if(end===undefined)throw new CommandError(`missing argument to '${a}'`,1);hasAction=true;return{k:'test',name:a,args:cmd,arg:end};}
  if(a==='-maxdepth'){maxDepth=Number(args[i++]);return{k:'test',name:'-true'};}
  if(a==='-mindepth'){minDepth=Number(args[i++]);return{k:'test',name:'-true'};}
  if(a==='-depth'||a==='-d'){depthFirst=true;return{k:'test',name:'-true'};}
  if(a==='-print'||a==='-print0'||a==='-delete'||a==='-ls'||a==='-printf'||a==='-quit')hasAction=true;
  if(a==='-delete')depthFirst=true;
  if(takes.has(a)){const v=args[i++];if(v===undefined)throw new CommandError(`missing argument to '${a}'`,1);return{k:'test',name:a,arg:v};}
  if(['-print','-print0','-delete','-ls','-quit','-true','-false','-empty','-prune','-follow','-L','-H','-P','-xdev','-mount','-noleaf','-readable','-writable','-executable','-nouser','-nogroup'].includes(a))return{k:'test',name:a};
  throw new CommandError(`unknown predicate '${a}'`,1);
 };
 const and=():FindNode=>{let a=primary();while(i<args.length&&args[i]!==')'&&args[i]!=='-o'&&args[i]!=='-or'&&args[i]!==','){if(args[i]==='-a'||args[i]==='-and')i++;a={k:'and',a,b:primary()};}return a;};
 const or=():FindNode=>{let a=and();while(args[i]==='-o'||args[i]==='-or'||args[i]===','){i++;a={k:'or',a,b:and()};}return a;};
 let expr:FindNode=i<args.length?or():{k:'test',name:'-true'};
 if(i<args.length)throw new CommandError(`paths must precede expression: '${args[i]}'`,1);
 if(!hasAction)expr={k:'and',a:expr,b:{k:'test',name:'-print'}};
 const batches=new Map<FindNode,string[]>();let status=0,quit=false,pruned=false;
 const sizeTest=(spec:string,size:number)=>{const m=/^([-+]?)(\d+)([bckwMG]?)$/.exec(spec);if(!m)throw new CommandError(`invalid -size argument '${spec}'`,1);const unit={b:512,c:1,k:1024,w:2,M:1<<20,G:1<<30,'':512}[m[3] as 'b'];const n=Number(m[2]),v=Math.ceil(size/unit);return m[1]==='+'?v>n:m[1]==='-'?v<n:v===n;};
 const numTest=(spec:string,value:number)=>{const n=Number(spec.replace(/^[-+]/,''));return spec.startsWith('+')?value>n:spec.startsWith('-')?value<n:Math.floor(value)===n;};
 const evaluate=async(node:FindNode,path:string,shown:string,s:FileStat,depth:number):Promise<boolean>=>{
  if(node.k==='and')return await evaluate(node.a,path,shown,s,depth)&&await evaluate(node.b,path,shown,s,depth);
  if(node.k==='or')return await evaluate(node.a,path,shown,s,depth)||await evaluate(node.b,path,shown,s,depth);
  if(node.k==='not')return!(await evaluate(node.a,path,shown,s,depth));
  const name=base(shown)||shown,arg=node.arg??'';
  switch(node.name){
   case'-true':case'-follow':case'-L':case'-H':case'-P':case'-xdev':case'-mount':case'-noleaf':case'-readable':case'-writable':return true;
   case'-false':case'-nouser':case'-nogroup':return false;
   case'-executable':return s.type==='directory'||(s.mode&0o111)!==0;
   case'-name':return globRegex(arg,'s').test(name);
   case'-iname':return globRegex(arg,'si').test(name);
   case'-path':case'-wholename':return globRegex(arg,'s').test(shown);
   case'-ipath':return globRegex(arg,'si').test(shown);
   case'-regex':{const re=compileRegex(arg,true);const m=re.exec(shown);return!!m&&m.index===0&&m[0].length===shown.length;}
   case'-iregex':{const re=compileRegex(arg,true,'i');const m=re.exec(shown);return!!m&&m.index===0&&m[0].length===shown.length;}
   case'-regextype':return true;
   case'-type':case'-xtype':return arg.split(',').some(t=>t==='f'?s.type==='file':t==='d'?s.type==='directory':t==='l'?s.type==='symlink':false);
   case'-size':return sizeTest(arg,s.size);
   case'-empty':return s.type==='directory'?ctx.fs.readdir(path).length===0:s.size===0;
   case'-mtime':case'-atime':case'-ctime':return numTest(arg,(Date.now()-s.mtimeMs)/86400000);
   case'-mmin':case'-amin':case'-cmin':return numTest(arg,(Date.now()-s.mtimeMs)/60000);
   case'-newer':{const other=tryStat(ctx.fs,ctx.resolve(arg));if(!other)throw new CommandError(`'${arg}': No such file or directory`,1);return s.mtimeMs>other.mtimeMs;}
   case'-perm':{const want=parseInt(arg.replace(/^[-/]/,''),8);return arg.startsWith('-')?(s.mode&want)===want:arg.startsWith('/')?(s.mode&want)!==0:(s.mode&0o7777)===want;}
   case'-user':case'-group':case'-uid':case'-gid':case'-links':case'-inum':case'-samefile':return true;
   case'-prune':pruned=true;return true;
   case'-quit':quit=true;return true;
   case'-print':await ctx.out(shown+'\n');return true;
   case'-print0':await ctx.out(shown+'\0');return true;
   case'-fprint':return true;
   case'-ls':await ctx.out(`${modeString(s)} 1 user user ${String(s.size).padStart(8)} ${dateText(s.mtimeMs)} ${shown}\n`);return true;
   case'-printf':await ctx.out(findPrintf(arg,shown,s,depth));return true;
   case'-delete':{try{if(s.type==='directory')ctx.fs.rmdir(path);else ctx.fs.unlink(path);}catch(error){await fail(ctx,`cannot delete '${shown}': ${describeError(error)}`);status=1;return false;}return true;}
   case'-exec':case'-execdir':case'-ok':case'-okdir':{
    const target=node.name.endsWith('dir')?'./'+name:shown,cwd=node.name.endsWith('dir')?dir(path):ctx.cwd;
    if(arg==='+'){const list=batches.get(node)??[];list.push(target);batches.set(node,list);return true;}
    const argv=node.args!.map(a=>a.replaceAll('{}',target));return await ctx.exec(argv,{cwd})===0;
   }
  }
  return false;
 };
 for(const start of paths){
  const root=ctx.resolve(start);if(!tryStat(ctx.fs,root)){await fail(ctx,`'${start}': No such file or directory`);status=1;continue;}
  const visit=async(path:string,shown:string,depth:number)=>{
   if(quit||ctx.signal.aborted)return;
   let s:FileStat;try{s=lstat(ctx,path);}catch{return;}
   pruned=false;
   if(!depthFirst&&depth>=minDepth)await evaluate(expr,path,shown,s,depth);
   if(s.type==='directory'&&depth<maxDepth&&!pruned){let names:string[]=[];try{names=ctx.fs.readdir(path);}catch(error){await fail(ctx,`'${shown}': ${describeError(error)}`);status=1;}for(const name of names)await visit(join(path,name),shown==='/'?'/'+name:shown.replace(/\/$/,'')+'/'+name,depth+1);}
   if(depthFirst&&depth>=minDepth)await evaluate(expr,path,shown,s,depth);
  };
  await visit(root,start,0);
 }
 for(const [node,list] of batches){const argv:string[]=[];for(const a of (node as {args:string[]}).args)if(a==='{}')argv.push(...list);else argv.push(a);if(await ctx.exec(argv)!==0)status=1;}
 return status;
};
function findPrintf(fmt:string,shown:string,s:FileStat,depth:number){
 return fmt.replace(/\\([ntr0\\])|%([-+ #0]*\d*(?:\.\d+)?)?([pfhsdmMtTkPy%]|T[A-Za-z@]|t[A-Za-z@])/g,(_,esc,flags,conv)=>{
  if(esc)return({n:'\n',t:'\t',r:'\r','0':'\0','\\':'\\'} as Record<string,string>)[esc];
  const pad=(v:string|number)=>flags?format('%'+flags+(typeof v==='number'?'d':'s'),()=>v).text:String(v);
  switch(conv[0]){
   case'p':return pad(shown);case'f':return pad(base(shown));case'h':return pad(dir(shown));case's':return pad(s.size);case'd':return pad(depth);case'k':return pad(Math.ceil(s.size/1024));
   case'm':return pad((s.mode&0o7777).toString(8));case'M':return pad(modeString(s));case'y':return pad(s.type==='directory'?'d':s.type==='symlink'?'l':'f');
   case'P':return pad(shown.split('/').slice(1).join('/'));case'%':return'%';
   case't':case'T':return conv.length>1?strftime('%'+(conv[1]==='@'?'s':conv[1]),new Date(s.mtimeMs)):new Date(s.mtimeMs).toString();
  }
  return'';
 });
}
const mkdir:Command=async ctx=>{
 const {opts,rest}=parseArgs('mkdir',ctx.args,{flags:'pv',values:'m',long:{parents:'p',verbose:'v','mode=':'m'}});
 if(!rest.length)throw new CommandError('missing operand',1);let status=0;
 for(const d of rest){
  const path=ctx.resolve(d);
  try{if(opts.p){mkdirp(ctx.fs,path);}else ctx.fs.mkdir(path,false);if(opts.v)await ctx.out(`mkdir: created directory '${d}'\n`);}
  catch(error){await fail(ctx,`can't create directory '${d}': ${errorCode(error)==='EEXIST'?'File exists':describeError(error)}`);status=1;}
 }
 return status;
};
const rmdir:Command=async ctx=>{
 const {opts,rest}=parseArgs('rmdir',ctx.args,{flags:'pv',long:{parents:'p',verbose:'v','ignore-fail-on-non-empty':'ignore'}});let status=0;
 for(const d of rest){let path=ctx.resolve(d);try{ctx.fs.rmdir(path);if(opts.p){let rel=normalize(d);while((rel=dir(rel))!=='.'&&rel!=='/'){path=ctx.resolve(rel);ctx.fs.rmdir(path);}}}catch(error){if(opts.ignore&&errorCode(error)==='ENOTEMPTY')continue;await fail(ctx,`'${d}': ${describeError(error)}`);status=1;}}
 return status;
};
const rm:Command=async ctx=>{
 const {opts,rest}=parseArgs('rm',ctx.args,{flags:'rRfvdiI',long:{recursive:'r',force:'f',verbose:'v',dir:'d',interactive:'i','one-file-system':'x','no-preserve-root':'npr','preserve-root':'pr'}});
 if(!rest.length&&!opts.f)throw new CommandError('missing operand',1);let status=0;
 for(const t of rest){
  const path=ctx.resolve(t);
  if(path==='/'&&!opts.npr){await fail(ctx,"it is dangerous to operate recursively on '/'");status=1;continue;}
  if(/(^|\/)\.\.?$/.test(t)){await fail(ctx,`refusing to remove '.' or '..' directory: skipping '${t}'`);status=1;continue;}
  let s:FileStat;try{s=lstat(ctx,path);}catch(error){if(!opts.f){await fail(ctx,`cannot remove '${t}': ${describeError(error)}`);status=1;}continue;}
  try{
   if(s.type==='directory'){if(opts.r||opts.R)removeTree(ctx.fs,path);else if(opts.d)ctx.fs.rmdir(path);else{await fail(ctx,`cannot remove '${t}': Is a directory`);status=1;continue;}}
   else ctx.fs.unlink(path);
   if(opts.v)await ctx.out(`removed '${t}'\n`);
  }catch(error){await fail(ctx,`cannot remove '${t}': ${describeError(error)}`);status=1;}
 }
 return status;
};
const touch:Command=async ctx=>{
 const {opts,rest}=parseArgs('touch',ctx.args,{flags:'camh',values:'drt',long:{'no-create':'c','date=':'d','reference=':'r'}});
 let when=Date.now();
 if(opts.r){const s=tryStat(ctx.fs,ctx.resolve(String(opts.r)));if(!s)throw new CommandError(`failed to get attributes of '${opts.r}': No such file or directory`,1);when=s.mtimeMs;}
 if(opts.d){const t=Date.parse(String(opts.d));if(isNaN(t))throw new CommandError(`invalid date format '${opts.d}'`,1);when=t;}
 if(opts.t){const m=/^(?:(\d\d)?(\d\d))?(\d\d)(\d\d)(\d\d)(\d\d)(?:\.(\d\d))?$/.exec(String(opts.t));if(!m)throw new CommandError(`invalid date format '${opts.t}'`,1);when=new Date(Number((m[1]??'20')+(m[2]??String(new Date().getFullYear()).slice(2))),Number(m[3])-1,Number(m[4]),Number(m[5]),Number(m[6]),Number(m[7]??0)).getTime();}
 let status=0;
 for(const f of rest){
  const path=ctx.resolve(f);
  try{if(!tryStat(ctx.fs,path)){if(opts.c)continue;ctx.fs.writeFile(path,new Uint8Array());}ctx.fs.utimes?.(path,when);}
  catch(error){await fail(ctx,`cannot touch '${f}': ${describeError(error)}`);status=1;}
 }
 return status;
};
/** cp and mv share the "into a folder or onto a name" rules. */
function targets(ctx:CommandContext,rest:string[],targetDir?:string){
 if(targetDir)return{sources:rest,dest:ctx.resolve(targetDir),into:true};
 if(rest.length<2)throw new CommandError(rest.length?`missing destination file operand after '${rest[0]}'`:'missing file operand',1);
 const dest=ctx.resolve(rest[rest.length-1]),destStat=tryStat(ctx.fs,dest),sources=rest.slice(0,-1);
 if(sources.length>1&&destStat?.type!=='directory')throw new CommandError(`target '${rest[rest.length-1]}' is not a directory`,1);
 return{sources,dest,into:destStat?.type==='directory'};
}
const cp:Command=async ctx=>{
 const {opts,rest}=parseArgs('cp',ctx.args,{flags:'rRafnvpuidlsLPHT',values:'t',long:{recursive:'r',archive:'a',force:'f','no-clobber':'n',verbose:'v',preserve:'p','preserve=':'p',update:'u','target-directory=':'t','no-target-directory':'T','no-dereference':'P',dereference:'L',interactive:'i','parents':'parents'}});
 const {sources,dest,into}=targets(ctx,rest,opts.t as string|undefined);let status=0;
 for(const src of sources){
  const from=ctx.resolve(src),s=tryStat(ctx.fs,from);if(!s){await fail(ctx,`cannot stat '${src}': No such file or directory`);status=1;continue;}
  const to=into?join(dest,base(from)):dest;
  if(normalize(to)===normalize(from)){await fail(ctx,`'${src}' and '${to}' are the same file`);status=1;continue;}
  if(s.type==='directory'){
   if(!(opts.r||opts.R||opts.a)){await fail(ctx,`-r not specified; omitting directory '${src}'`);status=1;continue;}
   if((to+'/').startsWith(from+'/')){await fail(ctx,`cannot copy a directory, '${src}', into itself, '${to}'`);status=1;continue;}
   for(const entry of walk(ctx.fs,from)){const target=join(to,relative(from,entry.path));if(entry.stat.type==='directory')mkdirp(ctx.fs,target);else{const existing=tryStat(ctx.fs,target);if(existing&&(opts.n||(opts.u&&existing.mtimeMs>=entry.stat.mtimeMs)))continue;copyFile(ctx.fs,entry.path,target);}}
  }else{
   const existing=tryStat(ctx.fs,to);if(existing?.type==='directory'){await fail(ctx,`cannot overwrite directory '${to}' with non-directory`);status=1;continue;}
   if(existing&&(opts.n||(opts.u&&existing.mtimeMs>=s.mtimeMs)))continue;
   try{copyFile(ctx.fs,from,to);}catch(error){await fail(ctx,`cannot create regular file '${to}': ${describeError(error)}`);status=1;continue;}
  }
  if(opts.v)await ctx.out(`'${src}' -> '${to}'\n`);
 }
 return status;
};
const mv:Command=async ctx=>{
 const {opts,rest}=parseArgs('mv',ctx.args,{flags:'fnviuT',values:'t',long:{force:'f','no-clobber':'n',verbose:'v',interactive:'i',update:'u','target-directory=':'t','no-target-directory':'T'}});
 const {sources,dest,into}=targets(ctx,rest,opts.t as string|undefined);let status=0;
 for(const src of sources){
  const from=ctx.resolve(src),s=tryStat(ctx.fs,from);if(!s){await fail(ctx,`cannot stat '${src}': No such file or directory`);status=1;continue;}
  const to=into?join(dest,base(from)):dest;if(normalize(to)===normalize(from))continue;
  if((to+'/').startsWith(from+'/')){await fail(ctx,`cannot move '${src}' to a subdirectory of itself, '${to}'`);status=1;continue;}
  const existing=tryStat(ctx.fs,to);if(existing&&opts.n)continue;if(existing&&opts.u&&existing.mtimeMs>=s.mtimeMs)continue;
  try{
   if(existing&&existing.type!=='directory'&&s.type!=='directory')ctx.fs.unlink(to);
   try{ctx.fs.rename(from,to);}
   catch(error){if(errorCode(error)!=='EXDEV'&&errorCode(error)!=='EPERM'&&errorCode(error)!=='ENOTSUP')throw error;if(s.type==='directory'){for(const e of walk(ctx.fs,from)){const t=join(to,relative(from,e.path));if(e.stat.type==='directory')mkdirp(ctx.fs,t);else copyFile(ctx.fs,e.path,t);}}else copyFile(ctx.fs,from,to);removeTree(ctx.fs,from);}
   if(opts.v)await ctx.out(`renamed '${src}' -> '${to}'\n`);
  }catch(error){await fail(ctx,`cannot move '${src}' to '${to}': ${describeError(error)}`);status=1;}
 }
 return status;
};
/** ln -s makes a symlink where the file system has them; a hard link is a copy (the sandbox has no inodes to share). */
const ln:Command=async ctx=>{
 const {opts,rest}=parseArgs('ln',ctx.args,{flags:'sfnvrT',values:'t',long:{symbolic:'s',force:'f','no-dereference':'n',verbose:'v',relative:'r','target-directory=':'t'}});
 const {sources,dest,into}=targets(ctx,rest.length===1?[rest[0],'.']:rest,opts.t as string|undefined);let status=0;
 for(const src of sources){
  const to=into?join(dest,base(src)):dest;
  try{if(opts.f&&tryStat(ctx.fs,to))ctx.fs.unlink(to);if(opts.s){if(!ctx.fs.symlink)throw new CommandError('symbolic links are not supported by this file system',1);ctx.fs.symlink(src,to);}else copyFile(ctx.fs,ctx.resolve(src),to);if(opts.v)await ctx.out(`'${to}' -> '${src}'\n`);}
  catch(error){if(error instanceof CommandError)throw error;await fail(ctx,`failed to create link '${to}': ${describeError(error)}`);status=1;}
 }
 return status;
};
const basename:Command=async ctx=>{
 const {opts,rest}=parseArgs('basename',ctx.args,{flags:'az',values:'s',long:{multiple:'a','suffix=':'s',zero:'z'}});
 if(!rest.length)throw new CommandError('missing operand',1);
 const names=opts.a||opts.s?rest:[rest[0]],suffix=opts.s!==undefined?String(opts.s):opts.a?undefined:rest[1];
 for(const n of names)await ctx.out(base(n,suffix)+(opts.z?'\0':'\n'));return 0;
};
const dirname:Command=async ctx=>{if(!ctx.args.length)throw new CommandError('missing operand',1);for(const n of ctx.args.filter(a=>a!=='-z'))await ctx.out(dir(n.replace(/\/+$/,'')||'/')+'\n');return 0;};
const realpath:Command=async ctx=>{
 const {opts,rest}=parseArgs(ctx.name,ctx.args,{flags:'femnqsvzLP',values:'',long:{canonicalize:'f','canonicalize-existing':'e','canonicalize-missing':'m','relative-to=':'relative',quiet:'q','no-newline':'n'}});
 let status=0;
 for(const p of rest){
  if(ctx.name==='readlink'&&!opts.f&&!opts.e&&!opts.m){try{await ctx.out(ctx.fs.readlink!(ctx.resolve(p))+(opts.n?'':'\n'));}catch{status=1;}continue;}
  const path=ctx.resolve(p);if((ctx.name==='realpath'&&!opts.m||opts.e)&&!tryStat(ctx.fs,path)){if(!opts.q)await fail(ctx,`${p}: No such file or directory`);status=1;continue;}
  await ctx.out((opts.relative?relative(ctx.resolve(String(opts.relative)),path):path)+(opts.n?'':'\n'));
 }
 return status;
};
const du:Command=async ctx=>{
 const {opts,rest}=parseArgs('du',ctx.args,{flags:'shackmbSxL0',values:'d',long:{summarize:'s','human-readable':'h',all:'a',total:'c','max-depth=':'d',bytes:'b','apparent-size':'apparent','si':'si',separate:'S'}});
 const unit=opts.b?1:opts.m?1<<20:1024,show=(n:number)=>opts.h?humanSize(n):String(Math.ceil(n/unit)),maxDepth=opts.s?0:opts.d!==undefined?Number(opts.d):Infinity;
 let grand=0,status=0;
 for(const t of rest.length?rest:['.']){
  const root=ctx.resolve(t);if(!tryStat(ctx.fs,root)){await fail(ctx,`cannot access '${t}': No such file or directory`);status=1;continue;}
  const size=async(path:string,shown:string,depth:number):Promise<number>=>{
   const s=lstat(ctx,path);if(s.type!=='directory'){if(opts.a&&depth<=maxDepth&&depth>0)await ctx.out(`${show(s.size)}\t${shown}\n`);return s.size;}
   let total=0;for(const name of ctx.fs.readdir(path))total+=await size(join(path,name),shown.replace(/\/$/,'')+'/'+name,depth+1);
   if(depth<=maxDepth)await ctx.out(`${show(total)}\t${shown}\n`);return total;
  };
  const s=ctx.fs.stat(root);const total=s.type==='directory'?await size(root,t,0):(await ctx.out(`${show(s.size)}\t${t}\n`),s.size);grand+=total;
 }
 if(opts.c)await ctx.out(`${show(grand)}\ttotal\n`);
 return status;
};
const stat:Command=async ctx=>{
 const {opts,rest}=parseArgs('stat',ctx.args,{flags:'LtfZ',values:'c',long:{'format=':'c','printf=':'printf',dereference:'L',terse:'t'}});
 let status=0;
 for(const f of rest){
  const path=ctx.resolve(f);let s:FileStat;try{s=opts.L?ctx.fs.stat(path):lstat(ctx,path);}catch(error){await fail(ctx,`cannot stat '${f}': ${describeError(error)}`);status=1;continue;}
  const fmt=(opts.c!==undefined?String(opts.c)+'\n':opts.printf!==undefined?String(opts.printf).replace(/\\n/g,'\n').replace(/\\t/g,'\t'):null);
  const kind=s.type==='directory'?'directory':s.type==='symlink'?'symbolic link':s.size?'regular file':'regular empty file';
  const iso=(ms:number)=>{const d=new Date(ms),p=(n:number,w=2)=>String(n).padStart(w,'0');const off=-d.getTimezoneOffset();return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}000000 ${off>=0?'+':'-'}${p(Math.floor(Math.abs(off)/60))}${p(Math.abs(off)%60)}`;};
  if(fmt===null){await ctx.out(`  File: ${f}\n  Size: ${s.size}\t\tBlocks: ${Math.ceil(s.size/512)}\tIO Block: 4096   ${kind}\nAccess: (${(s.mode&0o7777).toString(8).padStart(4,'0')}/${modeString(s)})  Uid: ( 1000/    user)   Gid: ( 1000/    user)\nModify: ${iso(s.mtimeMs)}\n`);continue;}
  await ctx.out(fmt.replace(/%([-0-9]*)([nNsYyFaAUGbBioXxZzWwhdtT%])/g,(_,width,c)=>{
   const v=c==='n'?f:c==='N'?`'${f}'`:c==='s'?String(s.size):c==='Y'||c==='X'||c==='Z'?String(Math.floor(s.mtimeMs/1000)):c==='y'||c==='x'||c==='z'?iso(s.mtimeMs):c==='F'?kind:c==='a'?(s.mode&0o7777).toString(8):c==='A'?modeString(s):c==='U'||c==='G'?'user':c==='b'?String(Math.ceil(s.size/512)):c==='B'?'512':c==='o'?'4096':c==='i'?'0':c==='h'?'1':c==='%'?'%':c==='W'||c==='w'?'0':c==='d'||c==='t'||c==='T'?'0':'';
   return width?(width.startsWith('-')?v.padEnd(Number(width.slice(1))):v.padStart(Number(width))):v;
  }));
 }
 return status;
};
const mktemp:Command=async ctx=>{
 const {opts,rest}=parseArgs('mktemp',ctx.args,{flags:'dqut',values:'p',long:{directory:'d',quiet:'q','dry-run':'u','tmpdir=':'p','tmpdir':'p','suffix=':'suffix'}});
 const template=rest[0]??'tmp.XXXXXXXXXX';
 if(!/X{3,}/.test(template))throw new CommandError(`too few X's in template '${template}'`,1);
 // The folder prints as given: TMPDIR for no template or -t, -p's folder, the template's own folder, or none (here).
 const shown=opts.p!==undefined?String(opts.p):!rest[0]||opts.t?String(ctx.env.TMPDIR??'/tmp'):template.includes('/')?dir(template):'';
 const folder=ctx.resolve(shown||'.');mkdirp(ctx.fs,folder);
 for(let attempt=0;attempt<100;attempt++){
  const name=base(template).replace(/X{3,}(?=[^X]*$)/,x=>Array.from({length:x.length},()=>'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random()*62)]).join(''))+String(opts.suffix??'');
  const path=join(folder,name);if(tryStat(ctx.fs,path))continue;
  if(!opts.u){if(opts.d)ctx.fs.mkdir(path,false);else ctx.fs.writeFile(path,new Uint8Array());}
  await ctx.out((shown?(shown.endsWith('/')?shown:shown+'/')+name:name)+'\n');return 0;
 }
 throw new CommandError('failed to create file',1);
};
/** diff: normal or unified (-u) output from a longest-common-subsequence over lines; -q, -r, -N, -i, -b, -w, -B. */
const diff:Command=async ctx=>{
 const {opts,rest}=parseArgs('diff',ctx.args,{flags:'uqrNibwBaesyc',values:'U',long:{unified:'u','unified=':'U',brief:'q',recursive:'r','new-file':'N','ignore-case':'i','ignore-space-change':'b','ignore-all-space':'w','ignore-blank-lines':'B',text:'a','report-identical-files':'s','strip-trailing-cr':'cr','label=':'label','color':'color','color=':'color','no-dereference':'nd'}});
 if(rest.length!==2)throw new CommandError(`missing operand after '${rest[0]??'diff'}'`,2);
 const context=opts.U!==undefined?Number(opts.U):opts.u?3:-1;
 const norm=(l:string)=>{if(opts.cr)l=l.replace(/\r$/,'');if(opts.i)l=l.toLowerCase();if(opts.w)l=l.replace(/\s+/g,'');else if(opts.b)l=l.replace(/\s+/g,' ').replace(/ $/,'');return l;};
 const read=async(name:string)=>{if(name==='-')return ctx.stdin.text();return decode(ctx.fs.readFile(ctx.resolve(name)));};
 let status=0;
 const compareFiles=async(a:string,b:string,labelA:string,labelB:string)=>{
  const sa=a==='-'?undefined:tryStat(ctx.fs,ctx.resolve(a)),sb=b==='-'?undefined:tryStat(ctx.fs,ctx.resolve(b));
  if(a!=='-'&&!sa&&!opts.N){await fail(ctx,`${a}: No such file or directory`);return 2;}if(b!=='-'&&!sb&&!opts.N){await fail(ctx,`${b}: No such file or directory`);return 2;}
  const ta=sa||a==='-'?await read(a):'',tb=sb||b==='-'?await read(b):'';
  if(ta===tb){if(opts.s)await ctx.out(`Files ${labelA} and ${labelB} are identical\n`);return 0;}
  const la=ta.split('\n'),lb=tb.split('\n');const endA=la.at(-1)==='',endB=lb.at(-1)==='';if(endA)la.pop();if(endB)lb.pop();
  const ops=lcsDiff(la.map(norm),lb.map(norm));
  if(!ops.some(o=>o.t!=='=')&&(!opts.B))return 0;
  if(opts.B&&ops.every(o=>o.t==='='||(o.t==='-'?la[o.a]:lb[o.b]).trim()==='')){return 0;}
  if(opts.q){await ctx.out(`Files ${labelA} and ${labelB} differ\n`);return 1;}
  if(context>=0){
   const time=(s:FileStat|undefined)=>s?new Date(s.mtimeMs).toISOString().replace('T',' ').replace('Z',' +0000'):new Date(0).toISOString().replace('T',' ').replace('Z',' +0000');
   let out=`--- ${labelA}\t${time(sa)}\n+++ ${labelB}\t${time(sb)}\n`;
   for(const hunk of hunks(ops,context)){
    const aStart=hunk[0].a,bStart=hunk[0].b,aLen=hunk.filter(o=>o.t!=='+').length,bLen=hunk.filter(o=>o.t!=='-').length;
    out+=`@@ -${aLen?aStart+1:aStart}${aLen===1?'':','+aLen} +${bLen?bStart+1:bStart}${bLen===1?'':','+bLen} @@\n`;
    for(const o of hunk){out+=(o.t==='='?' '+la[o.a]:o.t==='-'?'-'+la[o.a]:'+'+lb[o.b])+'\n';if(o.t==='-'&&o.a===la.length-1&&!endA||o.t==='+'&&o.b===lb.length-1&&!endB||o.t==='='&&o.a===la.length-1&&!endA)out+='\\ No newline at end of file\n';}
   }
   await ctx.out(out);return 1;
  }
  let out='';
  for(let k=0;k<ops.length;){
   if(ops[k].t==='='){k++;continue;}
   let j=k;while(j<ops.length&&ops[j].t!=='=')j++;const group=ops.slice(k,j),dels=group.filter(o=>o.t==='-'),adds=group.filter(o=>o.t==='+');
   const range=(s:number,n:number)=>n<=1?String(s+1):`${s+1},${s+n}`;
   const aPos=dels.length?dels[0].a:group[0].a,bPos=adds.length?adds[0].b:group[0].b;
   out+=(dels.length&&adds.length?`${range(aPos,dels.length)}c${range(bPos,adds.length)}`:dels.length?`${range(aPos,dels.length)}d${bPos}`:`${aPos}a${range(bPos,adds.length)}`)+'\n';
   for(const o of dels)out+='< '+la[o.a]+'\n';if(dels.length&&adds.length)out+='---\n';for(const o of adds)out+='> '+lb[o.b]+'\n';
   k=j;
  }
  await ctx.out(out);return 1;
 };
 const [a,b]=rest,sa=a==='-'?undefined:tryStat(ctx.fs,ctx.resolve(a)),sb=b==='-'?undefined:tryStat(ctx.fs,ctx.resolve(b));
 if(sa?.type==='directory'&&sb?.type==='directory'){
  const walkDir=async(da:string,db:string)=>{
   const na=new Set(ctx.fs.readdir(ctx.resolve(da))),nb=new Set(ctx.fs.readdir(ctx.resolve(db)));
   for(const name of[...new Set([...na,...nb])].sort()){
    const pa=join(da,name),pb=join(db,name);
    if(!nb.has(name)&&!opts.N){await ctx.out(`Only in ${da}: ${name}\n`);status=Math.max(status,1);continue;}
    if(!na.has(name)&&!opts.N){await ctx.out(`Only in ${db}: ${name}\n`);status=Math.max(status,1);continue;}
    const ta=tryStat(ctx.fs,ctx.resolve(pa)),tb=tryStat(ctx.fs,ctx.resolve(pb));
    if(ta?.type==='directory'&&tb?.type==='directory'){if(opts.r)await walkDir(pa,pb);else await ctx.out(`Common subdirectories: ${pa} and ${pb}\n`);continue;}
    if(!opts.q&&context<0)await ctx.out(`diff ${pa} ${pb}\n`);else if(context>=0)await ctx.out(`diff -u ${pa} ${pb}\n`);
    status=Math.max(status,await compareFiles(pa,pb,pa,pb));
   }
  };
  await walkDir(a,b);return status;
 }
 const fa=sa?.type==='directory'?join(a,base(b)):a,fb=sb?.type==='directory'?join(b,base(a)):b;
 return compareFiles(fa,fb,String(opts.label??fa),fb);
};
type Op={t:'='|'-'|'+';a:number;b:number};
/** Line diff by LCS on the trimmed middle; large inputs fall back to a greedy match so memory stays bounded. */
function lcsDiff(a:string[],b:string[]):Op[]{
 let start=0;while(start<a.length&&start<b.length&&a[start]===b[start])start++;
 let endA=a.length,endB=b.length;while(endA>start&&endB>start&&a[endA-1]===b[endB-1]){endA--;endB--;}
 const ops:Op[]=[];for(let k=0;k<start;k++)ops.push({t:'=',a:k,b:k});
 const n=endA-start,m=endB-start;
 if(n*m>25_000_000){for(let k=start;k<endA;k++)ops.push({t:'-',a:k,b:start});for(let k=start;k<endB;k++)ops.push({t:'+',a:endA,b:k});}
 else{
  const dp=Array.from({length:n+1},()=>new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=a[start+i]===b[start+j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
  let i=0,j=0;
  while(i<n||j<m){
   if(i<n&&j<m&&a[start+i]===b[start+j]){ops.push({t:'=',a:start+i,b:start+j});i++;j++;}
   else if(j<m&&(i>=n||dp[i][j+1]>dp[i+1][j])){ops.push({t:'+',a:start+i,b:start+j});j++;}
   else{ops.push({t:'-',a:start+i,b:start+j});i++;}
  }
 }
 for(let k=0;k<a.length-endA;k++)ops.push({t:'=',a:endA+k,b:endB+k});
 return ops;
}
function hunks(ops:Op[],context:number):Op[][]{
 const out:Op[][]=[];let k=0;
 while(k<ops.length){
  while(k<ops.length&&ops[k].t==='=')k++;if(k>=ops.length)break;
  let start=Math.max(0,k-context),end=k;
  for(;;){while(end<ops.length&&ops[end].t!=='=')end++;let next=end;while(next<ops.length&&ops[next].t==='=')next++;if(next<ops.length&&next-end<=context*2){end=next;continue;}end=Math.min(ops.length,end+context);break;}
  out.push(ops.slice(start,end));k=end;
 }
 return out;
}
const cmp:Command=async ctx=>{
 const {opts,rest}=parseArgs('cmp',ctx.args,{flags:'sl',long:{silent:'s',quiet:'s',verbose:'l'}});
 if(rest.length<2)throw new CommandError('missing operand',2);
 let a:Uint8Array,b:Uint8Array;try{a=ctx.fs.readFile(ctx.resolve(rest[0]));b=ctx.fs.readFile(ctx.resolve(rest[1]));}catch(error){await fail(ctx,describeError(error));return 2;}
 let line=1;for(let i=0;i<Math.min(a.length,b.length);i++){if(a[i]!==b[i]){if(!opts.s)await ctx.out(`${rest[0]} ${rest[1]} differ: byte ${i+1}, line ${line}\n`);return 1;}if(a[i]===10)line++;}
 if(a.length!==b.length){if(!opts.s)await ctx.err(`cmp: EOF on ${a.length<b.length?rest[0]:rest[1]} after byte ${Math.min(a.length,b.length)}\n`);return 1;}
 return 0;
};
export const fileTools:Record<string,Command>={ls,find,mkdir,rmdir,rm,touch,cp,mv,ln,basename,dirname,realpath,readlink:realpath,du,stat,mktemp,diff,cmp};
