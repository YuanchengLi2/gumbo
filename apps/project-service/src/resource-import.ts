import {existsSync,mkdirSync,readdirSync,readFileSync,statSync,writeFileSync,renameSync} from 'node:fs';
import {basename,dirname,extname,join,relative,sep} from 'node:path';
import {unzipSync} from 'fflate';
import {RESOURCE_FILE_LIMIT,RESOURCE_TOTAL_LIMIT} from './engine-compile';

const ARCHIVES=new Set(['.zip','.jar','.pak','.apk','.mcpack','.mcworld','.epub','.docx','.pptx','.xlsx','.cbz']);
const toPosix=(path:string)=>path.split(sep).join('/');
/** Shell-style patterns: ** crosses folders, * and ? stay within one name. Matching ignores case. */
export function globMatcher(patterns:string[]){
 const expressions=patterns.map(pattern=>{let source='';const p=pattern.replace(/\\/g,'/').replace(/^\.\//,'');for(let i=0;i<p.length;i++){const c=p[i];if(c==='*'&&p[i+1]==='*'){source+=p[i+2]==='/'?'(?:.*/)?':'.*';i+=p[i+2]==='/'?2:1;}else if(c==='*')source+='[^/]*';else if(c==='?')source+='[^/]';else source+=/[.+^${}()|[\]\\]/.test(c)?'\\'+c:c;}return new RegExp('^'+source+'$','i');});
 return(path:string)=>expressions.some(expression=>expression.test(path));
}
/** Pixel size of PNG, JPEG, GIF and WebP images from their headers, so the agent can choose sizes and filtering. */
export function imageSize(bytes:Uint8Array):{width:number;height:number}|undefined{
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(b.length>24&&b.readUInt32BE(0)===0x89504e47)return{width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 if(b.length>10&&b.toString('ascii',0,3)==='GIF')return{width:b.readUInt16LE(6),height:b.readUInt16LE(8)};
 if(b.length>30&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'){const kind=b.toString('ascii',12,16);if(kind==='VP8X')return{width:1+b.readUIntLE(24,3),height:1+b.readUIntLE(27,3)};if(kind==='VP8L'){const bits=b.readUInt32LE(21);return{width:(bits&0x3fff)+1,height:((bits>>14)&0x3fff)+1};}if(kind==='VP8 ')return{width:b.readUInt16LE(26)&0x3fff,height:b.readUInt16LE(28)&0x3fff};}
 if(b.length>4&&b[0]===0xff&&b[1]===0xd8){let i=2;while(i+9<b.length){if(b[i]!==0xff){i++;continue;}const marker=b[i+1],length=b.readUInt16BE(i+2);if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return{width:b.readUInt16BE(i+7),height:b.readUInt16BE(i+5)};i+=2+length;}}
}
function folderSize(root:string){let total=0;const walk=(dir:string)=>{if(!existsSync(dir))return;for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const path=join(dir,entry.name);if(entry.isDirectory())walk(path);else if(entry.isFile())total+=statSync(path).size;}};walk(root);return total;}

/** Copies matching files from a folder, an archive (zip, jar, pak and similar) or a single file into the workspace
 * resources/ folder, where scenes use them by name. Writes an index of what arrived (paths, sizes, image sizes). */
export function importResources(workspace:string,input:{source:string;include?:string[];into:string}){
 const name=input.into.replace(/\\/g,'/').replace(/^\.?\/*/,'').replace(/^resources\//,'').replace(/\/+$/,'');
 if(!name||name.split('/').some(part=>!part||part==='..'||part==='.'))throw new Error('into must be a folder name under resources/, for example resources/textures.');
 const target=join(workspace,'resources',...name.split('/')),matches=globMatcher(input.include?.length?input.include:['**/*']);
 let budget=RESOURCE_TOTAL_LIMIT-folderSize(join(workspace,'resources'));
 const files:{path:string;size:number;width?:number;height?:number}[]=[],skipped:string[]=[];
 const save=(rel:string,bytes:Uint8Array)=>{
  if(bytes.byteLength>RESOURCE_FILE_LIMIT){skipped.push(`${rel} (larger than 24 MB)`);return;}
  if(bytes.byteLength>budget){skipped.push(`${rel} (resources/ would exceed 96 MB)`);return;}
  const destination=join(target,...rel.split('/'));if(relative(target,destination).startsWith('..'))return;
  mkdirSync(dirname(destination),{recursive:true});const temp=destination+'.dream-write';writeFileSync(temp,bytes);renameSync(temp,destination);budget-=bytes.byteLength;
  files.push({path:`resources/${name}/${rel}`,size:bytes.byteLength,...imageSize(bytes)});
 };
 const stat=statSync(input.source);
 if(stat.isDirectory()){
  const walk=(dir:string)=>{for(const entry of readdirSync(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const path=join(dir,entry.name),rel=toPosix(relative(input.source,path));if(entry.isDirectory())walk(path);else if(entry.isFile()&&matches(rel)){if(files.length+skipped.length>=20000)return;save(rel,readFileSync(path));}}};walk(input.source);
 }else if(ARCHIVES.has(extname(input.source).toLowerCase())){
  // Only matching entries are decompressed, so a large game or document archive costs little.
  const entries=unzipSync(readFileSync(input.source),{filter:file=>!file.name.endsWith('/')&&matches(file.name)&&file.originalSize<=RESOURCE_FILE_LIMIT});
  for(const [rel,bytes] of Object.entries(entries)){if(rel.split('/').includes('..'))continue;save(rel,bytes);}
 }else if(matches(basename(input.source)))save(basename(input.source),readFileSync(input.source));
 files.sort((a,b)=>a.path.localeCompare(b.path));
 const index={source:input.source,include:input.include??['**/*'],files};
 mkdirSync(target,{recursive:true});writeFileSync(join(target,'index.json'),JSON.stringify(index,null,2));
 return{into:`resources/${name}`,imported:files.length,skipped:skipped.slice(0,40),totalMB:Math.round(files.reduce((n,f)=>n+f.size,0)/1048576*10)/10,index:`resources/${name}/index.json`,sample:files.slice(0,40),use:"Use these in scenes with resource('"+name+"/<path inside>') or useTexture(resource(...)); read index.json for the full list."};
}
