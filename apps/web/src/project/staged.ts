/** Footage the user just dropped or picked, readable at once by its path (/imports/<id>/<name>) while it is still being
 * copied into this browser's storage (bridge/imports.ts): the page that took the files holds them and shares them on a
 * BroadcastChannel with the workers and the service worker (public/sw.js speaks the same messages), which read a file
 * that is not in storage yet from here. A File the user gave is read where it lies on their disk, never loaded whole.
 * A context that missed a file being shared (a worker started later, the service worker woken again) asks for it.
 * Messages: {stage:path,file}, {unstage:path} (the path, or a folder and everything under it), {want:path}. */
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('gumbo-staged'):undefined;
const known=new Map<string,File>(),held=new Map<string,File>(),waiting=new Map<string,((file:File|undefined)=>void)[]>();
const under=(path:string,root:string)=>path===root||path.startsWith(root.replace(/\/+$/,'')+'/');
const drop=(root:string)=>{for(const map of [known,held])for(const path of [...map.keys()])if(under(path,root))map.delete(path);};
if(channel)channel.onmessage=({data})=>{
 if(data?.stage&&data.file instanceof Blob){known.set(data.stage,data.file as File);for(const answer of waiting.get(data.stage)??[])answer(data.file as File);waiting.delete(data.stage);}
 else if(typeof data?.unstage==='string')drop(data.unstage);
 else if(typeof data?.want==='string'){const file=held.get(data.want);if(file)channel.postMessage({stage:data.want,file});}
};
/** Only dropped and picked footage is ever shared this way. */
export const stageable=(path:string)=>path.startsWith('/imports/');
/** The page that took the file: it answers for it until it is unstaged. */
export function stage(path:string,file:File){held.set(path,file);known.set(path,file);channel?.postMessage({stage:path,file});}
/** The file is in storage now, or no longer wanted (a folder drops everything under it). */
export function unstage(path:string){drop(path);channel?.postMessage({unstage:path});}
/** The dropped file at path while it is not in storage yet, or nothing: asked of the page when this context has not
 * heard of it, for at most `wait` ms (a path that was never shared costs that wait once per miss). */
export function stagedFile(path:string,wait=400):Promise<File|undefined>{
 if(!stageable(path))return Promise.resolve(undefined);const file=known.get(path);if(file||!channel)return Promise.resolve(file);
 return new Promise(resolve=>{const list=waiting.get(path)??[];list.push(resolve);waiting.set(path,list);channel.postMessage({want:path});
  setTimeout(()=>{const left=waiting.get(path);if(left){const n=left.indexOf(resolve);if(n>=0)left.splice(n,1);if(!left.length)waiting.delete(path);}resolve(undefined);},wait);});
}
