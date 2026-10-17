import {canonicalPath} from './file-access';

/** One spelling per folder: its real path, and on Windows without regard to case. */
const folderKey=(folder:string)=>{const path=canonicalPath(folder);return process.platform==='win32'?path.toLowerCase():path;};
export const sameFolder=(a:string,b:string)=>folderKey(a)===folderKey(b);

/** Projects whose request was still running when the user opened another one. Each keeps its own project service,
 * finishes its request out of sight and then closes, instead of being stopped because the editor moved on. Opening a
 * parked project again brings its service back, still working or done. */
export class BackgroundProjects<S extends {close():Promise<void>}>{
 private parked=new Map<S,{id:string;folder:string}>();
 private closing=new Map<string,Promise<void>>();
 park(service:S,project:{id:string;folder:string}){this.parked.set(service,{id:project.id,folder:folderKey(project.folder)});}
 has(service:S){return this.parked.has(service);}
 get size(){return this.parked.size;}
 /** The projects still editing out of sight, for the home screen's spinners. */
 ids(){return [...this.parked.values()].map(p=>p.id);}
 /** The parked service of this folder, no longer parked: it becomes the open project's again. */
 take(folder:string):{service:S;id:string}|undefined{
  const wanted=folderKey(folder);
  for(const [service,project] of this.parked)if(project.folder===wanted){this.parked.delete(service);return{service,id:project.id};}
  return undefined;
 }
 /** A parked request ended (done, stopped, or waiting on the user), so its service closes and lets go of the project. */
 finished(service:S):{id:string;folder:string}|undefined{
  const project=this.parked.get(service);if(!project)return undefined;
  this.parked.delete(service);
  const closed=service.close().catch(()=>{}).finally(()=>{if(this.closing.get(project.folder)===closed)this.closing.delete(project.folder);});
  this.closing.set(project.folder,closed);
  return project;
 }
 /** Waits until a parked service that just finished has let go of this folder, so it can be opened again. */
 async released(folder:string){await this.closing.get(folderKey(folder));}
 async closeAll(){const all=[...this.parked.keys()];this.parked.clear();await Promise.allSettled([...all.map(service=>service.close()),...this.closing.values()]);}
}
