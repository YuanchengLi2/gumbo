import {fileAt} from '../project/media/paths';
import type {ProjectClient} from './project';

/** The page's half of engine scenes on the web (the desktop's dream-engine:// protocol, main/engine-protocol.ts). A scene
 * page (public/engine/host.js) asks for its scene by its own address; the answer is its configuration, compiled bundle,
 * resources and the project's media, as files from this browser's storage, which the page turns into blob URLs inside
 * its sandbox. A file that is missing is left out, and the scene reports what it could not load. */
type Source={config:Record<string,unknown>;version:number;bundlePath:string;files:Record<string,string>;media:Record<string,string>};
const files=async(paths:Record<string,string>)=>Object.fromEntries((await Promise.all(Object.entries(paths).map(async([key,path])=>{try{return[[key,await fileAt(path)]];}catch{return[];}}))).flat());
export function serveScenes(service:()=>ProjectClient){
 addEventListener('message',async event=>{
  const data=event.data,page=event.source as Window|null;
  if(!data?.dreamScene||data.type!=='need'||!page||typeof data.path!=='string')return;
  const address=/\/engine\/app\/(scene|draft)\/([^/]+)\/index\.html$/.exec(data.path);
  try{
   if(!address)throw new Error('Not a scene address.');
   const source=await service().host<Source>('sceneSource',{kind:address[1],id:decodeURIComponent(address[2])});
   page.postMessage({dreamScene:true,type:'load',config:source.config,version:source.version,bundle:await fileAt(source.bundlePath),files:await files(source.files),media:await files(source.media)},'*');
  }catch(error){page.postMessage({dreamScene:true,type:'load-error',error:(error as Error).message},'*');}
 });
}
