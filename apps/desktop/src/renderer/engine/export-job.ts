import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import type {ExportProgress} from '@dream/contracts';
import {renderVideo} from './export';

/** An export the main process has begun, from the Export window or for the agent: the window's half is the same either way.
 * The video is drawn and encoded here with the engine and streamed to main, which then joins it to the sound. A failure
 * here stops main's half with the reason; a cancel from anywhere stops the drawing (stopExports). */
export type EngineJob=Awaited<ReturnType<typeof window.dream.beginExport>>;
const running=new Map<string,AbortController>();

export async function runExport(job:EngineJob,timeline:TimelineDocument,footage:FootageIndex,onProgress:(progress:ExportProgress)=>void){
 const abort=new AbortController();running.set(job.id,abort);
 try{
  if(job.video)await renderVideo({timeline,footage,...job.video,write:(data,position)=>window.dream.exportChunk(job.id,position,data),onProgress:(done,total)=>onProgress({status:'rendering',progress:done/total*.98,phase:'Rendering the video'}),signal:abort.signal});
  return await window.dream.finishExport(job.id);
 }catch(error){if(!abort.signal.aborted)void window.dream.failExport(job.id,(error as Error).message||'The video could not be drawn.').catch(()=>{});throw error;}
 finally{running.delete(job.id);}
}
export function stopExports(){for(const abort of running.values())abort.abort();}
