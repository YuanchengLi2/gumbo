import {existsSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {InitialRequestSchema,FileRequestSchema} from '@dream/contracts';
import {ProjectLibrary} from '../../../desktop/src/main/project-library';
import {removeDatabases} from './shims/better-sqlite3';
import {access,files} from './files';

/** What the desktop's main process does around the project service, in the project worker: the project list (its
 * ProjectLibrary, unchanged, kept in /profile) and the list's actions (main/index.ts dream:projectAction), and the
 * computer's files: grants, browsing and decisions on proposed changes (dream:fileGrants … dream:decideFileChange).
 * Projects live in this browser's storage under /Dream/Projects. */
let library:ProjectLibrary;const projects='/Dream/Projects';
export function startHost(){library=new ProjectLibrary('/profile','/');}
export function hostUpdate(state:any){if(state?.meta&&state?.timeline)try{library.update(state);access.project(state.meta.folder);}catch(error){console.warn('[host] project list',error);}}
export async function host(action:string,args:any,open?:{folder?:string;id?:string}):Promise<unknown>{
 switch(action){
  case 'list':return library.list();
  case 'allocate':return library.allocate(InitialRequestSchema.parse(args.request));
  case 'action':{
   const entry=library.find(args.id);if(!entry)throw new Error('That project is no longer on the list.');
   const isOpen=!!open?.folder&&open.folder===entry.folder;
   if(args.action==='pin'||args.action==='unpin')library.mark(entry.id,{pinned:args.action==='pin'});
   else if(args.action==='archive'||args.action==='unarchive')library.mark(entry.id,{archived:args.action==='archive'});
   else if(args.action==='forget')library.mark(entry.id,'forget');
   else if(args.action==='trash'){
    if(isOpen)throw new Error('Close this project before deleting it.');
    if(dirname(entry.folder)!==projects)throw new Error("This project is kept in your own folder, so Gumbo won't delete it. Remove it from the list instead.");
    // Its database lives in SQLite's pool, beside the folder.
    if(existsSync(entry.folder))rmSync(entry.folder,{recursive:true,force:true});removeDatabases(entry.folder+'/');library.mark(entry.id,'forget');
   }
   else if(args.action==='reveal')throw new Error('Projects on the web live in this browser’s storage, not in a folder you can open.');
   else throw new Error('Unknown project action.');
   return library.list();
  }
  case 'fileGrants':return access.list();
  // A folder the page had the user choose (its handle is kept as /granted/<id>), readable and writable by path.
  case 'grantFolder':if(typeof args.path!=='string'||!/^\/granted\/[^/]+$/.test(args.path))throw new Error('Invalid folder.');return access.grant('folder',args.path,true);
  case 'revokeGrant':if(typeof args.id!=='string')throw new Error('Invalid grant.');access.revoke(args.id);return undefined;
  case 'files':return files.request(FileRequestSchema.parse(args.request),{projectId:open?.id});
  case 'cancelFiles':if(typeof args.id==='string')files.cancel(args.id);return undefined;
  case 'decideFile':if(typeof args.id!=='string'||typeof args.approve!=='boolean')throw new Error('Invalid decision.');return files.decide(args.id,args.approve);
  default:throw new Error(`Unknown host action ${action}.`);
 }
}
