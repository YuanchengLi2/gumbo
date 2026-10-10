import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Asset} from '@dream/footage';
import type {TimelineDocument} from '@dream/timeline';

export type GlBackend='angle'|'swangle';
const WEBGL_MISSING=/WebGL is unavailable/i;

/** Whether the timeline uses an engine scene that draws 3D (needs WebGL in the export browser). */
export function usesWebGl(timeline:TimelineDocument,assets:readonly Asset[]){
 const ids=new Set([...timeline.spine.map(c=>c.assetId),...timeline.attached.map(i=>i.source?.assetId).filter(Boolean) as string[]]);
 return assets.some(a=>ids.has(a.id)&&a.scene?.format==='engine'&&a.scene.engine?.chunks.includes('three'));
}

/** Runs an export with a working WebGL backend. Tried lazily on the first 3D export (hardware ANGLE, then software
 * SwiftShader), and the backend that worked is remembered in userData/preflight.json. */
export async function withWebGl<T>(userData:string,needed:boolean,run:(gl?:GlBackend)=>Promise<T>):Promise<T>{
 if(!needed)return run(undefined);
 const file=join(userData,'preflight.json');let saved:{gl?:GlBackend}={};try{if(existsSync(file))saved=JSON.parse(readFileSync(file,'utf8'));}catch{}
 const order:GlBackend[]=saved.gl==='swangle'?['swangle','angle']:['angle','swangle'];let last:unknown;
 for(const gl of order){
  try{const result=await run(gl);if(saved.gl!==gl){mkdirSync(dirname(file),{recursive:true});writeFileSync(file,JSON.stringify({...saved,gl,checkedAt:new Date().toISOString()}));}return result;}
  catch(error){if(!WEBGL_MISSING.test(String((error as Error)?.message)))throw error;last=error;}
 }
 throw new Error('This video contains a 3D scene, but WebGL is not available for export on this computer, even with software rendering. '+String((last as Error)?.message??''));
}
