import {grantFolder} from '../project/media/paths';
import {keepStorage} from './awake';
import {publish} from './events';
import {stage,unstage} from '../project/staged';

/** Footage on the web: files the user picks or drops are copied into this browser's private storage (/imports/<id>/
 * <name>), and the project service imports them from there by path, as it imports from the desktop's disk. The copy
 * streams, so a long video never sits in memory; once a project has its own copy, the project worker removes this one.
 * Folders the user chooses are kept as handles instead, read in place. */
const MEDIA_TYPES={'video/*':['.mp4','.mov','.webm','.mkv','.m4v','.avi','.mts','.m2ts','.3gp','.mpg','.mpeg','.wmv'],'audio/*':['.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus'],'image/*':['.png','.jpg','.jpeg','.webp','.heic','.heif','.avif','.gif']};
async function folder(path:string[]){let dir=await navigator.storage.getDirectory();for(const part of path)dir=await dir.getDirectoryHandle(part,{create:true});return dir;}
/** A file's name made safe as a path part (no slashes), keeping its extension. */
const safe=(name:string)=>name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(-180)||'media';
export async function store(files:File[]):Promise<string[]>{
 void keepStorage();
 // The editor shows each file at once, while it is copied in and imported (media.incoming; ProjectMedia).
 publish('media.incoming',{files:files.map(file=>({name:safe(file.name),kind:file.type.split('/')[0]||'video'}))});
 const paths:string[]=[],copies:{file:File;path:string;dir:FileSystemDirectoryHandle;name:string}[]=[];
 try{
  for(const file of files){const id=crypto.randomUUID().slice(0,8),name=safe(file.name),dir=await folder(['imports',id]),path=`/imports/${id}/${name}`;
   // Readable by its path at once, by every worker, straight from the user's disk (staged.ts): a long recording plays
   // and imports without waiting for its copy.
   stage(path,file);paths.push(path);copies.push({file,path,dir,name});}
 }catch(error){publish('media.incoming',{files:[],failed:true});throw error;}
 copying=copying.then(()=>copyIn(copies));
 return paths;
}
/** The copies into storage, behind the scenes and one at a time, each under a .part name until it is whole, so nothing
 * reads half a file; then the shared file is let go. A project that already copied the footage into its own folder
 * removes this one (project.worker.ts releaseStaged), and its copy stops there. */
let copying=Promise.resolve();
async function copyIn(copies:{file:File;path:string;dir:FileSystemDirectoryHandle;name:string}[]){
 for(const {file,path,dir,name} of copies){
  try{const part=await dir.getFileHandle(name+'.part',{create:true}),writer=await part.createWritable();await file.stream().pipeTo(writer);
   if(typeof (part as any).move==='function')await (part as any).move(name);else{const whole=await (await dir.getFileHandle(name,{create:true})).createWritable();await (await part.getFile()).stream().pipeTo(whole);await dir.removeEntry(name+'.part');}
   unstage(path);}
  catch{/* removed by the project once it had its own copy, or storage is full: the file stays shared for this visit */}
 }
}
/** Waits for the copies in storage to finish: before leaving the page (signing in), whose files must still be there on
 * the way back. */
export const copiesDone=()=>copying;
/** A folder on the computer the user chooses, kept so it can be read and written by path (/granted/<name>-<id>); null
 * when they cancel. The picker remembers where it was last for each purpose. */
export async function pickFolder(purpose:'gumbo-files'|'gumbo-exports'):Promise<string|null>{
 if(!canPickFolders())throw new Error('This browser can’t share folders. Add footage with Add media, and exports download.');
 try{return await grantFolder(await (window as any).showDirectoryPicker({id:purpose,mode:'readwrite',startIn:'videos'}));}
 catch(error){if((error as DOMException).name==='AbortError')return null;throw error;}
}
/** Phones and tablets (Android Chrome) have no folder picker and no file picker API. */
export const canPickFolders=()=>typeof (window as any).showDirectoryPicker==='function';
/** The plain file input, where the picker API is missing: the files it gives are copied in just the same. */
function chooseWithInput():Promise<File[]>{
 return new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.accept=Object.entries(MEDIA_TYPES).flatMap(([type,ends])=>[type,...ends]).join(',');
  input.addEventListener('change',()=>resolve([...(input.files??[])]),{once:true});input.addEventListener('cancel',()=>resolve([]),{once:true});input.click();});
}
export async function pickFiles():Promise<string[]>{
 if(typeof (window as any).showOpenFilePicker!=='function'){const files=await chooseWithInput();return files.length?store(files):[];}
 try{const handles=await (window as any).showOpenFilePicker({multiple:true,excludeAcceptAllOption:false,types:[{description:'Video, audio and images',accept:MEDIA_TYPES}]}) as FileSystemFileHandle[];return store(await Promise.all(handles.map(h=>h.getFile())));}
 catch(error){if((error as DOMException).name==='AbortError')return [];throw error;}
}
