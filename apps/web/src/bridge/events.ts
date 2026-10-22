/** The editor's event stream (window.dream.onEvent): what the desktop main process sent on 'dream:event'. */
type Handler=(event:unknown)=>void;
const handlers=new Set<Handler>();
export const onEvent=(handler:Handler)=>{handlers.add(handler);return()=>{handlers.delete(handler);};};
export const publish=(type:string,payload:unknown)=>{for(const handler of handlers)try{handler({type,payload});}catch(error){console.error(error);}};
