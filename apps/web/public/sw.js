/* Gumbo's service worker: the web app's dream-media:// and dream-engine://. The editor asks for media by asset and
 * kind (/app/media/<asset>/<kind>, any ?revision=… ignored); the route, kept in IndexedDB by the page
 * (src/storage/media-routes.ts), names a file in this browser's private storage (OPFS) or a file the user granted on
 * their computer. Responses honour Range, which video players and mediabunny use to seek, and are marked same-origin
 * for cross-origin isolation. /app/media/opfs/<path> serves an OPFS file directly. Engine scene documents come in a
 * later phase. */
const scope=new URL(self.registration.scope).pathname;
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));

const types={mp4:'video/mp4',mov:'video/quicktime',m4v:'video/mp4',webm:'video/webm',mkv:'video/x-matroska',mp3:'audio/mpeg',m4a:'audio/mp4',aac:'audio/aac',wav:'audio/wav',ogg:'audio/ogg',opus:'audio/ogg',flac:'audio/flac',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',json:'application/json',html:'text/html',txt:'text/plain'};
const typeOf=file=>file.type||types[(file.name.split('.').pop()||'').toLowerCase()]||'application/octet-stream';

function route(assetId,kind){return new Promise((resolve,reject)=>{const request=indexedDB.open('gumbo-media',1);request.onupgradeneeded=()=>request.result.createObjectStore('routes');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,get=db.transaction('routes').objectStore('routes').get(`${assetId}/${kind}`);get.onsuccess=()=>{db.close();resolve(get.result);};get.onerror=()=>{db.close();reject(get.error);};};});}
async function opfsFile(path){let dir=await navigator.storage.getDirectory();const parts=path.split('/').filter(Boolean).map(decodeURIComponent);for(const part of parts.slice(0,-1))dir=await dir.getDirectoryHandle(part);return(await dir.getFileHandle(parts.at(-1))).getFile();}
async function fileFor(found){if(!found)return null;if(found.opfs)return opfsFile(found.opfs);if(found.handle){if(await found.handle.queryPermission({mode:'read'})!=='granted')return 'denied';return found.handle.getFile();}return null;}

function respond(file,request){
 const headers={'Content-Type':typeOf(file),'Accept-Ranges':'bytes','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'};
 const range=/^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range')||'');
 if(!range)return new Response(request.method==='HEAD'?null:file,{status:200,headers:{...headers,'Content-Length':String(file.size)}});
 let start=range[1]===''?Math.max(0,file.size-Number(range[2])):Number(range[1]),end=range[1]===''||range[2]===''?file.size-1:Math.min(Number(range[2]),file.size-1);
 if(start>=file.size||start>end)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${file.size}`}});
 return new Response(request.method==='HEAD'?null:file.slice(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${file.size}`,'Content-Length':String(end-start+1)}});
}

self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==location.origin||!url.pathname.startsWith(scope+'media/'))return;
 event.respondWith((async()=>{
  try{
   const rest=url.pathname.slice((scope+'media/').length);
   const file=rest.startsWith('opfs/')?await opfsFile(rest.slice(5)):await (async()=>{const [assetId,kind='original']=rest.split('/').map(decodeURIComponent);return fileFor(await route(assetId,kind));})();
   if(file==='denied')return new Response('Gumbo needs permission to read this file again: open the project to grant it.',{status:403});
   if(!file)return new Response('Not found',{status:404});
   return respond(file,event.request);
  }catch(error){return new Response(String(error&&error.message||error),{status:404});}
 })());
});
