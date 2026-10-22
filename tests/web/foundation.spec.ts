import {test,expect} from '@playwright/test';

/** Phase 0 of Gumbo on the web: the editor loads in the browser through the web bridge, the page is cross-origin
 * isolated, and the service worker serves media from the browser's private storage with byte ranges, the way the
 * player seeks. */
test('the editor loads on the web, isolated, with media routes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/app/');
 await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 const result=await page.evaluate(async()=>{
  const root=await navigator.storage.getDirectory(),dir=await root.getDirectoryHandle('sw-test',{create:true}),file=await dir.getFileHandle('clip.mp4',{create:true}),writer=await file.createWritable();
  await writer.write(new TextEncoder().encode('0123456789ABCDEF'));await writer.close();
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('gumbo-media',1);r.onupgradeneeded=()=>r.result.createObjectStore('routes');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  await new Promise((resolve,reject)=>{const t=db.transaction('routes','readwrite');t.objectStore('routes').put({opfs:'sw-test/clip.mp4'},'asset1/original');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});db.close();
  const range=await fetch('/app/media/asset1/original?revision=proxy',{headers:{Range:'bytes=2-5'}}),missing=await fetch('/app/media/nope/original');
  const out={isolated:crossOriginIsolated,controlled:!!navigator.serviceWorker.controller,root:(window as any).dream.routes.media,status:range.status,body:await range.text(),contentRange:range.headers.get('content-range'),missing:missing.status};
  await root.removeEntry('sw-test',{recursive:true});return out;
 });
 expect(result).toEqual({isolated:true,controlled:true,root:'/app/media/',status:206,body:'2345',contentRange:'bytes 2-5/16',missing:404});
 expect(errors).toEqual([]);
});

test('signing in starts on usegumbo.app with a PKCE challenge and comes back to this page',async({page})=>{
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 await page.route('https://usegumbo.app/signin/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<p>sign-in page</p>'}));
 const [request]=await Promise.all([page.waitForRequest(r=>r.url().startsWith('https://usegumbo.app/signin/')),page.evaluate(()=>(window as any).dream.command({type:'account',action:'browser'}))]);
 const url=new URL(request.url());
 expect(url.searchParams.get('web')).toBe('http://localhost:5180/app/');
 expect(url.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
});
