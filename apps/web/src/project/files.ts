import {basename,dirname} from 'node:path';
import {existsSync,mkdirSync,renameSync} from 'node:fs';
import {FileAccess} from '../../../desktop/src/main/file-access';
import {FileOperations} from '../../../desktop/src/main/file-operations';

/** The computer's files on the web. The desktop's file access and operations (main/file-access.ts, file-operations.ts)
 * run here unchanged, over the folders the user grants: each is a File System Access handle the page keeps in IndexedDB,
 * read and written as /granted/<name>-<id>/… through the storage worker. A granted folder stands in for the desktop's
 * drives and known folders: it is a root to browse, a location, and a place find_media looks. Footage waiting in
 * /imports and the open project's folder are allowed, as dropped files and the project are on the desktop. Nothing is
 * deleted outright: trash moves into the folder's own ".Gumbo Trash", which the user can empty. */
const folderName=(path:string)=>path.split('/')[2]?.replace(/-[0-9a-f]{4}$/,'')||'Folder';
class WebFileAccess extends FileAccess{
 private folders(){return this.list().filter(g=>g.scope==='folder'&&g.path?.startsWith('/granted/'));}
 override hasComputer(){return this.folders().length>0;}
 override roots(){if(!this.hasComputer())throw new Error('FILE_PERMISSION_REQUIRED: Allow computer file access first.');return this.folders().map(g=>g.path!);}
 override locations(){return this.folders().map(g=>({name:folderName(g.path!),path:g.path!}));}
}
async function trash(path:string){
 const root=path.startsWith('/granted/')?path.split('/').slice(0,3).join('/'):dirname(path),bin=`${root}/.Gumbo Trash`;
 mkdirSync(bin,{recursive:true});renameSync(path,`${bin}/${new Date().toISOString().replace(/[:.]/g,'-')} ${basename(path)}`);
}
export let access:FileAccess,files:FileOperations;
/** Starts file access once the file system is connected; /imports holds footage the user picked or dropped. */
export function startFiles(){
 mkdirSync('/imports',{recursive:true});access=new WebFileAccess('/profile',[]);access.project('/imports');
 files=new FileOperations(access,'/profile',trash,undefined,()=>access.locations().map(l=>({...l,exists:existsSync(l.path)})));
}
