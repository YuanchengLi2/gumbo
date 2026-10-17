import {extname} from 'node:path';
import type {BrowserWindow} from 'electron';
import type {ProjectState} from '@dream/project-db';
import {ExportSettingsSchema} from './export-settings';
import {beginExport,exportDone,cancelEngineExport,failEngineExport} from './engine-export';

/** The agent's export (an approved render_video file operation) is the Export button's export: this process begins the
 * job, the editor window draws and encodes the video with the engine and streams it here, and finishing joins it to the
 * mix, with the same progress events and cancel. There is no second renderer, so an edit comes out the same whoever
 * exports it. The settings are the export window's defaults (the project's size and rate, H.264, recommended quality);
 * the file name says MP4 or MOV. */
export async function exportForAgent(state:ProjectState,destination:string,window:()=>BrowserWindow|undefined,publish:(type:string,payload:unknown)=>void,options:{authorize?:(path:string)=>void;read?:(path:string)=>void;signal:AbortSignal}){
 options.signal.throwIfAborted();
 const win=window();if(!win||win.isDestroyed())throw new Error('The editor window is closed, so the video cannot be exported now.');
 const used=new Set([...state.timeline.spine.map(c=>c.assetId),...state.timeline.attached.flatMap(i=>i.source?[i.source.assetId]:[]),...state.timeline.music.map(m=>m.assetId)]);
 for(const asset of state.footage.assets)if(used.has(asset.id)&&!asset.missing)options.read?.(asset.originalPath);
 const settings=ExportSettingsSchema.parse({format:extname(destination).toLowerCase()==='.mov'?'mov':'mp4'});
 const job=beginExport(state,settings,publish,options.authorize,destination),contents=win.webContents;
 const gone=()=>failEngineExport(job.id,'The editor window closed while the video was exporting.'),abort=()=>cancelEngineExport(job.id);
 contents.once('destroyed',gone);contents.once('render-process-gone',gone);options.signal.addEventListener('abort',abort,{once:true});
 try{
  // The window renders exactly this version, the one the export was approved for, whatever it shows meanwhile.
  contents.send('dream:event',{type:'export.request',payload:{id:job.id,video:job.video,timeline:state.timeline,footage:state.footage}});
  return await exportDone(job.id);
 }finally{contents.removeListener('destroyed',gone);contents.removeListener('render-process-gone',gone);options.signal.removeEventListener('abort',abort);}
}
