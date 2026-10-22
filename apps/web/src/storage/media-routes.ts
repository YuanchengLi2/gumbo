/** What the service worker serves under /app/media/<asset>/<kind>: a file in this browser's private storage (OPFS path)
 * or a file the user granted where it already is on their computer (a File System Access handle). Kept in IndexedDB,
 * which both the page and the service worker can read; public/sw.js reads the same store. */
export type MediaRoute={opfs:string}|{handle:FileSystemFileHandle};
const DB='gumbo-media',STORE='routes';
function open():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const request=indexedDB.open(DB,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function run<T>(mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>):Promise<T>{const db=await open();try{return await new Promise<T>((resolve,reject)=>{const request=work(db.transaction(STORE,mode).objectStore(STORE));request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}}
/** `kind` is what the editor asks for: original, preview, play, audio, thumbnail, waveform. */
export const setMediaRoute=(assetId:string,kind:string,route:MediaRoute)=>run('readwrite',store=>store.put(route,`${assetId}/${kind}`));
export const removeMediaRoute=(assetId:string,kind:string)=>run('readwrite',store=>store.delete(`${assetId}/${kind}`));
export const mediaRoute=(assetId:string,kind:string)=>run<MediaRoute|undefined>('readonly',store=>store.get(`${assetId}/${kind}`));
