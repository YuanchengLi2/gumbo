import {grantFolder} from '../project/media/paths';
import {keepStorage} from './awake';
import {publish} from './events';

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
 const paths:string[]=[];
 try{
  for(const file of files){
   const id=crypto.randomUUID().slice(0,8),name=safe(file.name),dir=await folder(['imports',id]),handle=await dir.getFileHandle(name,{create:true}),writer=await handle.createWritable();
   await file.stream().pipeTo(writer);paths.push(`/imports/${id}/${name}`);
  }
 }catch(error){publish('media.incoming',{files:[],failed:true});throw error;}
 return paths;
}
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
