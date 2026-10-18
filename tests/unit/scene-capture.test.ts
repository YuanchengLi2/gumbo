import {describe,it,expect,vi} from 'vitest';
import {createContext,runInContext} from 'node:vm';
vi.mock('electron',()=>({BrowserWindow:class{}}));
import {frameRequestScript,Paints} from '../../apps/desktop/src/main/scene-capture';

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
 it('says whether drawing the frame changed the page, so a changed frame is waited for until it paints',async()=>{
  // A page whose scene changes an element for frame 42 and nothing for frame 43 (already showing).
  for(const [frame,changes,expected] of [[42,true,true],[43,false,false]] as const){
   const listeners:((e:{data:any})=>void)[]=[];let observer:(()=>void)|undefined;
   const page:any={setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame:(f:()=>void)=>setTimeout(f,1),
    document:{querySelector:()=>null},MutationObserver:class{constructor(callback:()=>void){observer=callback;}observe(){}disconnect(){}},
    addEventListener:(_t:string,f:(e:{data:any})=>void)=>{listeners.push(f);},removeEventListener:(_t:string,f:(e:{data:any})=>void)=>{const i=listeners.indexOf(f);if(i>=0)listeners.splice(i,1);},
    postMessage:(data:any)=>setTimeout(()=>{for(const f of [...listeners])f({data});},0)};
   page.window=page;
   page.addEventListener('message',(e:{data:any})=>{if(e.data?.type!=='frame')return;setTimeout(()=>{if(changes)observer?.();page.postMessage({dreamScene:true,requestId:e.data.requestId});},5);});
   page.postMessage({dreamScene:true,ready:true});
   expect(await runInContext(frameRequestScript(1,frame,30,3000),createContext(page))).toEqual({changed:expected});
  }
 });
 it('draws the frame when the scene mounts after the first request',async()=>{
  const page=scenePage(600);
  expect(await page.request(1,42)).toEqual({changed:true});
  expect(page.drawn).toContain(42);
 });
 it('draws the frame for a scene that was ready before the request',async()=>{
  const page=scenePage(0);await new Promise(resolve=>setTimeout(resolve,20));
  expect(await page.request(1,42)).toEqual({changed:true});
  expect(await page.request(2,66)).toEqual({changed:true});
  expect(page.drawn).toEqual([42,66]);
 });
 it('gives up with an error when the scene never answers',async()=>{
  const page=scenePage(undefined);
  expect((await page.request(1,42)).error).toMatch(/took longer than 3s/);
 });
});

/** A scene window's paints: Export keeps the picture it has when a frame paints nothing new. */
describe('scene window paints',()=>{
 const image=(name:string)=>({name}) as never;
 it('settles at the next paint, or after the wait with none',async()=>{
  const paints=new Paints();let at=Date.now();
  setTimeout(()=>paints.add(image('a')),5);await paints.next(1000);
  expect(Date.now()-at).toBeLessThan(500);expect((paints.latest!.image as unknown as {name:string}).name).toBe('a');
  at=Date.now();const before=paints.number;await paints.next(30);
  expect(Date.now()-at).toBeGreaterThanOrEqual(25);expect(paints.number).toBe(before);
 });
 it('numbers pictures across windows, so one never names another',()=>{
  const first=new Paints(),second=new Paints();first.add(image('a'));second.add(image('b'));
  expect(second.number).toBeGreaterThan(first.number);expect(new Paints().number).toBe(0);
 });
});
