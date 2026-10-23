import {existsSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Asset} from '@dream/footage';
import {InitialRequestSchema,FileRequestSchema} from '@dream/contracts';
import {ProjectLibrary} from '../../../desktop/src/main/project-library';
import {sceneFromAsset,DraftScenes,type SceneSource} from '../../../desktop/src/main/engine-routes';
import {mediaAssetPath} from '../../../desktop/src/main/media-paths';
import {removeDatabases} from './shims/better-sqlite3';
import {access,files} from './files';

/** What the desktop's main process does around the project service, in the project worker: the project list (its
 * ProjectLibrary, unchanged, kept in /profile) and the list's actions (main/index.ts dream:projectAction), and the
 * computer's files: grants, browsing and decisions on proposed changes (dream:fileGrants … dream:decideFileChange); and
 * what an engine scene's page needs (dream-engine://, main/engine-protocol.ts). Projects live in this browser's storage
 * under /Dream/Projects. */
let library:ProjectLibrary;const projects='/Dream/Projects';
/** The open project's assets, as its states report them, and the drafts its runs announced (scene.draft). */
const assets=new Map<string,Asset>(),drafts=new DraftScenes();
export function trackAssets(list:Asset[]){assets.clear();for(const asset of list)assets.set(asset.id,asset);}
export function trackDraft(payload:{hash?:string;source?:SceneSource}){if(/^[a-f0-9]{16,64}$/.test(payload?.hash??'')&&payload.source)drafts.set(payload.hash!,payload.source);}
/** A scene's configuration, bundle, resources and the project's media, by their paths in this browser's storage. */
function sceneSource(kind:string,id:string){
 const asset=kind==='scene'?assets.get(id):undefined;
 const source=asset?sceneFromAsset(asset,music=>(assets.get(music)?.generated as {beats?:number[]}|undefined)?.beats):kind==='draft'&&/^[a-f0-9]{16,64}$/.test(id)?drafts.get(id):undefined;
 if(!source)throw new Error('This scene is not in the open project.');
 const files=Object.fromEntries(Object.entries(source.files).filter(([,hash])=>/^[a-f0-9]{64}$/.test(hash)).map(([name,hash])=>[name,join(source.storeDir,hash)]));
 const media=Object.fromEntries([...assets.values()].filter(a=>!a.scene).flatMap(a=>{try{return[[a.id,mediaAssetPath(a,'original')]];}catch{return[];}}));
 return{config:source.config,version:asset?.scene?.engine?.version??1,bundlePath:source.bundlePath,files,media};
}
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
  case 'sceneSource':return sceneSource(String(args.kind),String(args.id));
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
