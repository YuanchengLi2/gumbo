import {mediaAssetPath} from './media-paths';
import {mediaResponse} from './media-response';
export {mediaResponse} from './media-response';
import {protocol} from 'electron';import {createReadStream,statSync,existsSync} from 'node:fs';import {Readable} from 'node:stream';import {extname} from 'node:path';import type {Asset} from '@dream/footage';
export const registry=new Map<string,Asset>();
export function registerAssets(assets:Asset[]){registry.clear();for(const a of assets)registry.set(a.id,a);}
export function assetPath(id:string,variant='preview',frame:string|null=null){const asset=registry.get(id);if(!asset)throw new Error('Media does not belong to this project.');return mediaAssetPath(asset,variant,frame);}
export function installMediaProtocol(authorize?:(path:string)=>void){protocol.handle('dream-media',request=>{try{const url=new URL(request.url);const path=assetPath(url.hostname,url.pathname.slice(1)||'preview',url.searchParams.get('frame'));authorize?.(path);return mediaResponse(path,request.headers.get('range'));}catch(error){return new Response((error as Error).message,{status:404,headers:{'Content-Type':'text/plain','Access-Control-Allow-Origin':'*'}});}});}
