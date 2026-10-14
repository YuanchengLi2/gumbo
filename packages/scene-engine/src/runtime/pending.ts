/** Work a frame must wait for before it is captured: textures, fonts, video seeks, files. Each settled item bumps the
 * epoch, so the frame bridge knows to draw once more with the newly available data. */
const pending=new Set<Promise<unknown>>();
let epoch=0;
export function track<T>(promise:Promise<T>):Promise<T>{
 pending.add(promise);
 const done=()=>{pending.delete(promise);epoch++;};
 promise.then(done,done);
 return promise;
}
export const pendingCount=()=>pending.size;
/** Marks that something changed what the frame will draw (for example a 3D tree committed), so the bridge redraws. */
export const changed=()=>{epoch++;};
export const currentEpoch=()=>epoch;
export async function settled(){while(pending.size)await Promise.allSettled([...pending]);}
/** A resource read by suspending (textures, files). React can wait a moment before revealing suspended content, so the
 * frame waits until a component that read the resource has committed, or shortly after loading if none does. */
export function suspendedResource(load:Promise<unknown>){
 let committed!:()=>void;const commit=new Promise<void>(resolve=>{committed=resolve;});
 track(commit);load.then(()=>{setTimeout(committed,1500);},()=>committed());
 return committed;
}
