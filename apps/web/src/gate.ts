/** What Gumbo needs from the browser: video decoding and encoding (WebCodecs), the private file storage projects live
 * in (OPFS), reading footage where it already is (File System Access), the media routes (service workers) and the
 * shared memory ffmpeg.wasm, Pyodide and SQLite use (cross-origin isolation). Chrome and Edge have all of it; WebGPU is
 * only needed for local transcription, which falls back to the cloud. */
export type Capability={id:string;label:string;ok:boolean;required:boolean};
export function capabilities():Capability[]{
 const w=globalThis as any;
 return [
  {id:'webcodecs',label:'Video decoding and encoding (WebCodecs)',ok:typeof w.VideoDecoder==='function'&&typeof w.VideoEncoder==='function',required:true},
  {id:'opfs',label:'Private file storage (OPFS)',ok:!!navigator.storage?.getDirectory,required:true},
  // Phones and tablets have no folder picker: footage is added as files instead, and exports are downloaded.
  {id:'files',label:'Opening your folders (File System Access)',ok:typeof w.showDirectoryPicker==='function',required:false},
  {id:'sw',label:'Service workers',ok:'serviceWorker' in navigator,required:true},
  {id:'isolated',label:'Cross-origin isolation',ok:!!w.crossOriginIsolated,required:true},
  {id:'webgpu',label:'GPU compute (WebGPU)',ok:!!(navigator as any).gpu,required:false},
 ];
}
export const missing=()=>capabilities().filter(c=>c.required&&!c.ok);

/** The page for a browser without what Gumbo needs: which parts are missing, and where it works. */
export function unsupportedPage(gaps:Capability[]){
 const root=document.getElementById('root')!;root.innerHTML='';
 const page=document.createElement('main');page.className='web-unsupported';
 page.innerHTML='<h1>Gumbo needs Chrome or Edge</h1><p>This browser is missing what Gumbo uses to edit video on your computer:</p><ul></ul><p>Open <a href="https://usegumbo.app/app/">usegumbo.app/app</a> in Chrome or Microsoft Edge, on a computer or an Android phone.</p>';
 const list=page.querySelector('ul')!;for(const gap of gaps){const item=document.createElement('li');item.textContent=gap.label;list.append(item);}
 root.append(page);
}
