import type {Asset} from '@dream/footage';
import {mediaAssetPath} from '../../../desktop/src/main/media-paths';

/** The service worker's media routes for the open project's assets (public/sw.js): which file answers
 * /app/media/<asset>/<variant>, by the desktop's own rule (main/media-paths.ts). Written to IndexedDB, which the service
 * worker reads, whenever a state with the footage leaves the project worker. A variant whose file is missing is removed. */
const variants=['original','preview','play','audio','thumbnail'];
let writing=Promise.resolve();
export function syncRoutes(assets:Asset[]){writing=writing.then(()=>write(assets)).catch(error=>console.warn('[routes]',error));return writing;}
async function write(assets:Asset[]){
 const rows:[string,string|undefined][]=[];
 for(const asset of assets)for(const variant of variants){let path:string|undefined;try{path=mediaAssetPath(asset,variant);}catch{}rows.push([`${asset.id}/${variant}`,path]);}
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('gumbo-media',1);r.onupgradeneeded=()=>r.result.createObjectStore('routes');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 try{await new Promise<void>((resolve,reject)=>{const t=db.transaction('routes','readwrite'),store=t.objectStore('routes');for(const [key,path] of rows)path?store.put({path},key):store.delete(key);t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);});}
 finally{db.close();}
}
