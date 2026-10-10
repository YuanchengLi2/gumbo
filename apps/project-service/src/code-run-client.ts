import type {ProcessRunner,ProcessResult} from '@dream/contracts';
export function codeRunClient(port:any){
 const pending=new Map<string,{resolve:(r:ProcessResult)=>void;reject:(e:Error)=>void;output:(s:string)=>void;cleanup:()=>void}>();
 const run:ProcessRunner=(request,signal,onOutput)=>new Promise((resolve,reject)=>{signal.throwIfAborted();const cancel=()=>port.postMessage({codeCancel:request.id}),cleanup=()=>{signal.removeEventListener('abort',cancel);pending.delete(request.id);};pending.set(request.id,{resolve,reject,output:onOutput,cleanup});signal.addEventListener('abort',cancel,{once:true});port.postMessage({codeRun:request});});
 return{run,receive(data:any){const p=pending.get(data.id);if(!p)return;if(data.text!==undefined){p.output(data.text);return;}p.cleanup();data.error?p.reject(new Error(data.error)):p.resolve(data.result);},close(){for(const [id,p] of pending){port.postMessage({codeCancel:id});p.cleanup();p.reject(new Error('Project closed.'));}}};
}
