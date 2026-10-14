import {useLayoutEffect} from 'react';
import {track,suspendedResource} from '../pending';
/** URLs for project media and workspace files. They are relative to the scene document, which the player and the
 * export server both serve with these routes, so the same compiled scene works in both. */
const encodePath=(path:string)=>path.replace(/\\/g,'/').replace(/^\.?\/+/,'').replace(/^resources\//,'').split('/').map(encodeURIComponent).join('/');

/** An imported project asset (video, image or audio) by its asset ID. */
export const asset=(id:string)=>'media/'+encodeURIComponent(id);
export const useAsset=asset;
/** A file from the workspace resources/ folder, e.g. resource('logos/brand.png'). */
export const resource=(path:string)=>'files/'+encodePath(path);
export const staticFile=resource;

/** Reads a JSON or text file from resources/ before the frame is drawn. */
const texts=new Map<string,{value?:string;error?:Error;promise:Promise<void>;committed?:()=>void}>();
function load(path:string){
 let entry=texts.get(path);
 if(!entry){const created:{value?:string;error?:Error;promise:Promise<void>;committed?:()=>void}={promise:Promise.resolve()};created.promise=track(fetch(resource(path)).then(r=>{if(!r.ok)throw new Error(`resources/${path} was not found.`);return r.text();}).then(text=>{created.value=text;},error=>{created.error=error;}));created.committed=suspendedResource(created.promise);texts.set(path,created);entry=created;}
 if(entry.error)throw entry.error;if(entry.value===undefined)throw entry.promise;
 const ready=entry;useLayoutEffect(()=>{ready.committed?.();},[ready]);
 return entry.value;
}
export const useText=(path:string)=>load(path);
export const useJson=<T=unknown>(path:string):T=>JSON.parse(load(path)) as T;
