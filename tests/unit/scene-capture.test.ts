import {describe,it,expect,vi} from 'vitest';
import {createContext,runInContext} from 'node:vm';
vi.mock('electron',()=>({BrowserWindow:class{}}));
import {frameRequestScript} from '../../apps/desktop/src/main/scene-capture';

/** A scene window's page: messages reach every listener in the order they were added, a tick after posting, as in a
 * browser, so the capture script hears its own requests. The scene starts listening for frame requests only when it
 * mounts, then says it is ready; drawing a frame takes a while, and a frame counts as drawn when the scene answers. */
function scenePage(mountAfterMs:number|undefined){
 const listeners:((e:{data:any})=>void)[]=[],drawn:number[]=[];
 const page:any={setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:(f:()=>void)=>setTimeout(f,1),
  addEventListener:(_type:string,f:(e:{data:any})=>void)=>{listeners.push(f);},
  removeEventListener:(_type:string,f:(e:{data:any})=>void)=>{const i=listeners.indexOf(f);if(i>=0)listeners.splice(i,1);},
  postMessage:(data:any)=>setTimeout(()=>{for(const f of [...listeners])f({data});},0)};
 page.window=page;
 const mount=()=>{page.addEventListener('message',(e:{data:any})=>{if(e.data?.type!=='frame')return;const {frame,requestId}=e.data;setTimeout(()=>{if(!drawn.includes(frame))drawn.push(frame);page.postMessage({dreamScene:true,requestId});},50);});page.postMessage({dreamScene:true,ready:true});};
 if(mountAfterMs===0)mount();else if(mountAfterMs!==undefined)setTimeout(mount,mountAfterMs);
 const context=createContext(page);
 return{drawn,request:(id:number,frame:number)=>runInContext(frameRequestScript(id,frame,30,3000),context) as Promise<{error?:string}>};
}

describe('scene frame capture',()=>{
 it('draws the frame when the scene mounts after the first request',async()=>{
  const page=scenePage(600);
  expect(await page.request(1,42)).toEqual({});
  expect(page.drawn).toContain(42);
 });
 it('draws the frame for a scene that was ready before the request',async()=>{
  const page=scenePage(0);await new Promise(resolve=>setTimeout(resolve,20));
  expect(await page.request(1,42)).toEqual({});
  expect(await page.request(2,66)).toEqual({});
  expect(page.drawn).toEqual([42,66]);
 });
 it('gives up with an error when the scene never answers',async()=>{
  const page=scenePage(undefined);
  expect((await page.request(1,42)).error).toMatch(/took longer than 3s/);
 });
});
