import {mediaAssetPath} from './media-paths';
import {mediaResponse} from './media-response';
export {mediaResponse} from './media-response';
import {protocol} from 'electron';import {createReadStream,statSync,existsSync} from 'node:fs';import {Readable} from 'node:stream';import {extname} from 'node:path';import type {Asset} from '@dream/footage';
export const registry=new Map<string,Asset>();
// The media the protocols serve: the open project's, and that of any project finishing a request in the background,
// whose frames the editor window still draws for its agent. The open project's win if an id is in both.
const owners=new Map<string,Asset[]>();
const rebuild=()=>{registry.clear();for(const [owner,assets] of owners)if(owner!=='open')for(const a of assets)registry.set(a.id,a);for(const a of owners.get('open')??[])registry.set(a.id,a);};
export function registerAssets(assets:Asset[],owner='open'){owners.set(owner,assets);rebuild();}
export function releaseAssets(owner:string){if(owners.delete(owner))rebuild();}
export function assetPath(id:string,variant='preview',frame:string|null=null){const asset=registry.get(id);if(!asset)throw new Error('Media does not belong to this project.');return mediaAssetPath(asset,variant,frame);}
export function installMediaProtocol(authorize?:(path:string)=>void){protocol.handle('dream-media',request=>{try{const url=new URL(request.url);const path=assetPath(url.hostname,url.pathname.slice(1)||'preview',url.searchParams.get('frame'));authorize?.(path);return mediaResponse(path,request.headers.get('range'));}catch(error){return new Response((error as Error).message,{status:404,headers:{'Content-Type':'text/plain','Access-Control-Allow-Origin':'*'}});}});}
