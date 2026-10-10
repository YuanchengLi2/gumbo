import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync,realpathSync} from 'node:fs';
import {dirname,join,resolve,relative,isAbsolute,parse} from 'node:path';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import type {FileGrant} from '@dream/contracts';

export function canonicalPath(input:string):string {
 if(!isAbsolute(input)||input.includes('\0')||(process.platform==='win32'&&(/^[\\/]{2}/.test(input)||input.slice(2).includes(':'))))throw new Error('Choose an absolute path on a local drive.');
 let existing=resolve(input),suffix:string[]=[];
 while(!existsSync(existing)){const parent=dirname(existing);if(parent===existing)throw new Error('This drive is unavailable.');suffix.unshift(relative(parent,existing));existing=parent;}
 return resolve(realpathSync.native(existing),...suffix);
}
export function within(root:string,target:string){const fold=(p:string)=>process.platform==='win32'?p.toLowerCase():p;const rel=relative(fold(root),fold(target));return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../');}
export function atomicJson(path:string,value:unknown){mkdirSync(dirname(path),{recursive:true});const temporary=path+'.tmp';writeFileSync(temporary,JSON.stringify(value,null,2));renameSync(temporary,path);}
export class FileAccess {
 private grants:FileGrant[]=[];private projects=new Set<string>();private listeners=new Set<()=>void>();
 private file:string;
 constructor(profile:string,private knownLocations:{name:string;path:string}[]=['Desktop','Downloads','Documents','Pictures','Videos','Music'].map(name=>({name,path:join(homedir(),name)}))){this.file=join(profile,'file-access.json');try{this.grants=JSON.parse(readFileSync(this.file,'utf8'));}catch{}}
 list(){return this.grants.filter(g=>!g.revokedAt).map(g=>({...g}));}
 grant(scope:FileGrant['scope'],path?:string,write=false){const canonical=path?canonicalPath(path):undefined;const prior=this.list().find(g=>g.scope===scope&&g.path===canonical&&(!write||g.write));if(prior)return prior;const grant:FileGrant={id:randomUUID(),scope,path:canonical,write,createdAt:new Date().toISOString()};this.grants.push(grant);atomicJson(this.file,this.grants);return grant;}
 project(path:string){this.projects.add(canonicalPath(path));}
 revoke(id:string){const grant=this.grants.find(g=>g.id===id);if(grant){grant.revokedAt=new Date().toISOString();atomicJson(this.file,this.grants);this.listeners.forEach(fn=>fn());}}
 onRevoke(fn:()=>void){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
 hasComputer(){return this.list().some(g=>g.scope==='computer');}
 locations(){this.roots();const seen=new Set<string>();return this.knownLocations.flatMap(location=>{try{const path=this.assert(location.path);if(!existsSync(path)||seen.has(path.toLowerCase()))return[];seen.add(path.toLowerCase());return[{name:location.name,path}];}catch{return[];}});}
 assert(path:string,write=false){const target=canonicalPath(path);if([...this.projects].some(root=>within(root,target)))return target;const allowed=this.list().some(g=>(!write||g.write)&&(g.scope==='computer'||g.path&&(g.scope==='project'?within(g.path,target):g.path===target)));if(!allowed)throw new Error('FILE_PERMISSION_REQUIRED: Allow computer file access or choose this file first.');return target;}
 roots(){if(!this.hasComputer())throw new Error('FILE_PERMISSION_REQUIRED: Allow computer file access first.');if(process.platform!=='win32')return ['/'];return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(letter=>letter+':\\').filter(path=>existsSync(path));}
}
