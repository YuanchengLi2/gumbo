import type {Asset} from '@dream/footage';
import {mediaAssetPath} from '../../../desktop/src/main/media-paths';

/** The service worker's media routes for the open project's assets (public/sw.js): which file answers
 * /app/media/<asset>/<variant>, by the desktop's own rule (main/media-paths.ts). Written to IndexedDB, which the service
 * worker reads, whenever a state with the footage leaves the project worker. A variant whose file is missing is removed. */
const variants=['original','preview','play','audio','thumbnail'];
let writing=Promise.resolve(),written='',opened:Promise<IDBDatabase>|undefined;
export function syncRoutes(assets:Asset[]){writing=writing.then(()=>write(assets)).catch(error=>{written='';opened=undefined;console.warn('[routes]',error);});return writing;}
/** Every state the editor is sent waits for this, so it writes only when the routes changed (an edit by hand usually
 * changes none), through one connection kept open. */
async function write(assets:Asset[]){
 const rows:[string,string|undefined][]=[];
 for(const asset of assets)for(const variant of variants){let path:string|undefined;try{path=mediaAssetPath(asset,variant);}catch{}rows.push([`${asset.id}/${variant}`,path]);}
 const signature=JSON.stringify(rows);if(signature===written)return;
 const db=await (opened??=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('gumbo-media',1);r.onupgradeneeded=()=>r.result.createObjectStore('routes');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}));
 await new Promise<void>((resolve,reject)=>{const t=db.transaction('routes','readwrite'),store=t.objectStore('routes');for(const [key,path] of rows)path?store.put({path},key):store.delete(key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});
 written=signature;
}
