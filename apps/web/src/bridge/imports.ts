/** Footage on the web: files the user picks or drops are copied into this browser's private storage (/imports/<id>/
 * <name>), and the project service imports them from there by path, as it imports from the desktop's disk. The copy
 * streams, so a long video never sits in memory; once a project has its own copy, the project worker removes this one. */
const MEDIA_TYPES={'video/*':['.mp4','.mov','.webm','.mkv','.m4v','.avi','.mts','.m2ts','.3gp','.mpg','.mpeg','.wmv'],'audio/*':['.wav','.mp3','.m4a','.aac','.flac','.ogg','.opus'],'image/*':['.png','.jpg','.jpeg','.webp','.heic','.heif','.avif','.gif']};
async function folder(path:string[]){let dir=await navigator.storage.getDirectory();for(const part of path)dir=await dir.getDirectoryHandle(part,{create:true});return dir;}
/** A file's name made safe as a path part (no slashes), keeping its extension. */
const safe=(name:string)=>name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(-180)||'media';
export async function store(files:File[]):Promise<string[]>{
 const paths:string[]=[];
 for(const file of files){
  const id=crypto.randomUUID().slice(0,8),name=safe(file.name),dir=await folder(['imports',id]),handle=await dir.getFileHandle(name,{create:true}),writer=await handle.createWritable();
  await file.stream().pipeTo(writer);paths.push(`/imports/${id}/${name}`);
 }
 return paths;
}
export async function pickFiles():Promise<string[]>{
 try{const handles=await (window as any).showOpenFilePicker({multiple:true,excludeAcceptAllOption:false,types:[{description:'Video, audio and images',accept:MEDIA_TYPES}]}) as FileSystemFileHandle[];return store(await Promise.all(handles.map(h=>h.getFile())));}
 catch(error){if((error as DOMException).name==='AbortError')return [];throw error;}
}
