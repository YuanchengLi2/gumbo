import {existsSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {InitialRequestSchema} from '@dream/contracts';
import {ProjectLibrary} from '../../../desktop/src/main/project-library';

/** What the desktop's main process does around the project service, in the project worker: the project list (its
 * ProjectLibrary, unchanged, kept in /profile) and the list's actions (main/index.ts dream:projectAction). Projects live
 * in this browser's storage under /Dream/Projects. */
let library:ProjectLibrary;const projects='/Dream/Projects';
export function startHost(){library=new ProjectLibrary('/profile','/');}
export function hostUpdate(state:any){if(state?.meta&&state?.timeline)try{library.update(state);}catch(error){console.warn('[host] project list',error);}}
export function host(action:string,args:any,openFolder?:string):unknown{
 switch(action){
  case 'list':return library.list();
  case 'allocate':return library.allocate(InitialRequestSchema.parse(args.request));
  case 'action':{
   const entry=library.find(args.id);if(!entry)throw new Error('That project is no longer on the list.');
   const open=!!openFolder&&openFolder===entry.folder;
   if(args.action==='pin'||args.action==='unpin')library.mark(entry.id,{pinned:args.action==='pin'});
   else if(args.action==='archive'||args.action==='unarchive')library.mark(entry.id,{archived:args.action==='archive'});
   else if(args.action==='forget')library.mark(entry.id,'forget');
   else if(args.action==='trash'){
    if(open)throw new Error('Close this project before deleting it.');
    if(dirname(entry.folder)!==projects)throw new Error("This project is kept in your own folder, so Gumbo won't delete it. Remove it from the list instead.");
    if(existsSync(entry.folder))rmSync(entry.folder,{recursive:true,force:true});library.mark(entry.id,'forget');
   }
   else if(args.action==='reveal')throw new Error('Projects on the web live in this browser’s storage, not in a folder you can open.');
   else throw new Error('Unknown project action.');
   return library.list();
  }
  default:throw new Error(`Unknown host action ${action}.`);
 }
}
