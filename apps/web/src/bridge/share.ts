import type {Account} from './account';
import type {ProjectState} from '@dream/project-db';
import {fileAt} from '../project/media/paths';
import {lastExport} from './export';

/** Share link, as the desktop's main process makes one (main/index.ts dream:share): the project's last exported video is
 * uploaded to the gateway's storage with its story (the requests and what it was made from, share-story.ts), and the link
 * is the page that shows them, usegumbo.app/s/?t=… (its token is the secret that opens it). */
export async function shareExport(account:Account,state:ProjectState,story:unknown){
 if(!lastExport||lastExport.projectId!==state.meta.id)throw new Error('Export this project before sharing.');
 const token=await account.token(),auth={Authorization:`Bearer ${token}`};
 const response=await fetch(`${account.gateway()}/share-create`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({title:state.meta.name,...(story&&typeof story==='object'?story:{})})});
 const body=await response.json().catch(()=>({})) as {id?:string;token?:string;uploadUrl?:string;error?:string};if(!response.ok||!body.uploadUrl)throw new Error(body.error??'The link could not be made.');
 const upload=await fetch(body.uploadUrl,{method:'PUT',headers:{'Content-Type':'video/mp4'},body:await fileAt(lastExport.path)});if(!upload.ok)throw new Error('The video could not be uploaded.');
 const complete=await fetch(`${account.gateway()}/share-complete`,{method:'POST',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({id:body.id})});if(!complete.ok)throw new Error('The link could not be finished.');
 return{id:body.id!,url:`https://usegumbo.app/s/?t=${body.token}`};
}
