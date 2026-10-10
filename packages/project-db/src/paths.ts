import {relative,isAbsolute,resolve,sep} from 'node:path';
import type {Asset} from '@dream/footage';

export function persistPath(path:string,folder:string){
 const rel=relative(folder,path);
 return rel!==''&&rel!== '..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel)?`project:${rel.split(sep).join('/')}`:path;
}
export function hydratePath(path:string,folder:string){
 if(!path.startsWith('project:'))return path;
 const absolute=resolve(folder,path.slice(8)),rel=relative(folder,absolute);
 if(isAbsolute(rel)||rel==='..'||rel.startsWith(`..${sep}`))throw new Error('Invalid project media reference.');
 return absolute;
}
const fields=['originalPath','proxyPath','thumbnailPath','audioPath'] as const;
export function persistAsset(asset:Asset,folder:string){const result={...asset};for(const key of fields){const path=result[key];if(path)result[key]=persistPath(path,folder);}if(result.sequence)result.sequence={...result.sequence,directory:persistPath(result.sequence.directory,folder)};return result;}
export function hydrateAsset(asset:Asset,folder:string){const result={...asset};for(const key of fields){const path=result[key];if(path)result[key]=hydratePath(path,folder);}if(result.sequence)result.sequence={...result.sequence,directory:hydratePath(result.sequence.directory,folder)};return result;}
