import {SandboxClient} from '@dream/web-sandbox';
import type {ProcessRequest} from '@dream/contracts';

/** What the desktop's main process does with the service's code runs (main/service.ts code, main/code-runtime.ts), in
 * the project worker: each runs in the browser sandbox of the open project, whose files are that project's folder.
 * Output goes back as it comes; a cancel stops the command (a stuck one has its worker restarted). Opening another
 * project ends the previous project's sandbox. */
let sandbox:{folder:string;client:SandboxClient}|undefined;
const runs=new Map<string,AbortController>();
function sandboxFor(folder:string){
 if(sandbox?.folder!==folder){
  sandbox?.client.terminate();
  sandbox={folder,client:new SandboxClient({createWorker:()=>new Worker(new URL('./sandbox.worker.ts',import.meta.url),{type:'module',name:folder}),options:{workspace:'/Workspace',mounts:['/Media','/Sources'],logDir:'/.dream/processes'}})};
 }
 return sandbox.client;
}
export function cancelCode(id:string){runs.get(id)?.abort();}
export async function runCode(request:ProcessRequest,open:{folder?:string;id?:string},answer:(message:unknown)=>void){
 const controller=new AbortController();runs.set(request.id,controller);
 try{
  if(!open.folder||request.projectId!==open.id||request.workspace!==open.folder+'/Workspace')throw new Error('Creation request belongs to another project.');
  const result=await sandboxFor(open.folder).runner()(request,controller.signal,text=>answer({codeResult:{id:request.id,text}}));
  answer({codeResult:{id:request.id,result}});
 }catch(error){answer({codeResult:{id:request.id,error:(error as Error).message}});}
 finally{runs.delete(request.id);}
}
