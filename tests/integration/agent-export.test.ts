import {it,expect,vi,beforeAll} from 'vitest';
import {EventEmitter} from 'node:events';
import {mkdtempSync,existsSync,readFileSync,mkdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {emptyTimeline,TimelineSchema} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import type {ProjectState} from '@dream/project-db';
vi.mock('electron',()=>({app:{isPackaged:false,getAppPath:()=>process.cwd()},BrowserWindow:class{}}));
import {exportForAgent} from '../../apps/desktop/src/main/agent-export';
import {exportChunk,finishExport,exportRunning,cancelEngineExport} from '../../apps/desktop/src/main/engine-export';
import {exportAudio} from '../../apps/desktop/src/main/export-audio';
import {FileAccess} from '../../apps/desktop/src/main/file-access';
import {FileOperations} from '../../apps/desktop/src/main/file-operations';

beforeAll(()=>{process.env.DREAM_FFMPEG=ffmpeg!;process.env.DREAM_FFPROBE=ffprobe.path;});
const clip=(id:string,srcIn:number,srcOut:number)=>({id,assetId:'v',srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''});
function project(dir:string):ProjectState{
 const file=join(dir,'tone.mp4'),r=spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=red:s=320x180:r=30:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file],{windowsHide:true});
 if(r.status)throw new Error(r.stderr.toString());
 const footage=emptyFootage();footage.assets=[AssetSchema.parse({id:'v',filename:'tone.mp4',kind:'video',originalPath:file,durationSec:4,width:320,height:180,fps:30,hasAudio:true,fingerprint:'v',status:'ready',audioPath:file})];
 const t=emptyTimeline('t');t.settings={...t.settings,width:320,height:180,fps:30};t.spine=[clip('a',0,1.5),clip('b',2,3.5)];
 return {meta:{id:'p1',name:'Agent export',folder:dir},timeline:TimelineSchema.parse(t),versionId:'v1',footage} as unknown as ProjectState;
}
/** The editor window: told to export, it does what the engine's export does (draws the job's frames at the job's settings,
 * streams the file to main, then has main finish), here with ffmpeg standing in for the WebGL compositor and WebCodecs. */
function editorWindow(answer:'draw'|'silent'='draw'){
 const contents=Object.assign(new EventEmitter(),{requests:[] as any[],send(channel:string,event:any){
  if(channel!=='dream:event'||event.type!=='export.request')return;contents.requests.push(event.payload);if(answer!=='draw')return;
  const {id,video,timeline}=event.payload,file=join(mkdtempSync(join(tmpdir(),'dream-agent-frames-')),'video.mp4'),seconds=timeline.spine.reduce((n:number,c:any)=>n+(c.srcOut-c.srcIn),0);
  const r=spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i',`color=c=blue:s=${video.width}x${video.height}:r=${video.fps}:d=${seconds}`,'-c:v','libx264','-pix_fmt','yuv420p','-f',video.container,file],{windowsHide:true});if(r.status)throw new Error(r.stderr.toString());
  setTimeout(()=>{exportChunk(id,0,readFileSync(file));void finishExport(id).catch(()=>{});},10);
 }});
 return {window:{isDestroyed:()=>false,webContents:contents} as any,contents};
}
const probe=(path:string)=>JSON.parse(spawnSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',path],{encoding:'utf8'}).stdout);

it("routes the agent's export through the engine export: the window draws the approved version, main joins it to the mix",async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-agent-export-')),state=project(dir),destination=join(dir,'Exports','agent cut.mp4'),events:any[]=[],authorized:string[]=[],read:string[]=[];
 const {window,contents}=editorWindow();
 const result=await exportForAgent(state,destination,()=>window,(type,payload)=>events.push({type,payload}),{authorize:path=>authorized.push(path),read:path=>read.push(path),signal:new AbortController().signal});
 expect(result).toEqual({path:destination,paths:[destination]});
 // The window got the version the export was approved for and the export window's default settings.
 expect(contents.requests).toHaveLength(1);expect(contents.requests[0].timeline).toEqual(state.timeline);
 expect(contents.requests[0].video).toEqual({width:320,height:180,fps:30,codec:'h264',quality:'recommended',container:'mp4'});
 expect(authorized).toEqual([destination]);expect(read).toEqual([state.footage.assets[0].originalPath]);
 const info=probe(destination);expect(info.streams.map((s:any)=>s.codec_type).sort()).toEqual(['audio','video']);expect(Math.abs(Number(info.format.duration)-3)).toBeLessThan(.1);
 expect(events.filter(e=>e.type==='export.progress').at(-1).payload).toMatchObject({status:'completed',path:destination});
 expect(exportRunning()).toBe(false);expect(readdirSync(join(dir,'Exports'))).toEqual(['agent cut.mp4']);
},60_000);

it("stops the agent's export on cancel, when the window closes, and writes the file name's container",async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-agent-cancel-')),state=project(dir),destination=join(dir,'cut.mp4'),events:any[]=[];
 let shown=editorWindow('silent'),abort=new AbortController();
 const cancelled=exportForAgent(state,destination,()=>shown.window,(type,payload)=>events.push({type,payload}),{signal:abort.signal});
 await vi.waitFor(()=>expect(shown.contents.requests).toHaveLength(1));abort.abort();
 await expect(cancelled).rejects.toThrow('cancelled');expect(events.at(-1).payload.status).toBe('cancelled');expect(exportRunning()).toBe(false);expect(existsSync(destination)).toBe(false);
 shown=editorWindow('silent');const closed=exportForAgent(state,destination,()=>shown.window,()=>{},{signal:new AbortController().signal});
 await vi.waitFor(()=>expect(shown.contents.requests).toHaveLength(1));shown.contents.emit('render-process-gone');
 await expect(closed).rejects.toThrow('The editor window closed while the video was exporting.');expect(exportRunning()).toBe(false);
 // The Export window's cancel stops it the same way.
 shown=editorWindow('silent');const stopped=exportForAgent(state,join(dir,'cut.mov'),()=>shown.window,()=>{},{signal:new AbortController().signal});
 await vi.waitFor(()=>expect(shown.contents.requests).toHaveLength(1));expect(shown.contents.requests[0].video.container).toBe('mov');cancelEngineExport();
 await expect(stopped).rejects.toThrow('cancelled');
 await expect(exportForAgent(state,destination,()=>undefined,()=>{},{signal:new AbortController().signal})).rejects.toThrow('The editor window is closed');
},60_000);

it('an approved render_video file operation exports through the engine to the proposed path',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-agent-files-')),state=project(dir),profile=join(dir,'profile'),out=join(dir,'out');mkdirSync(out);
 const access=new FileAccess(profile);access.grant('computer',undefined,true);const {window}=editorWindow();
 const ops=new FileOperations(access,profile,async()=>{},(operation,signal)=>exportForAgent(state,operation.path,()=>window,()=>{},{authorize:path=>{access.assert(path,true);},signal}).then(()=>{}));
 const path=join(out,'final.mp4'),receipt=await ops.request({action:'propose',requestId:'export-1',title:'Export the video',operations:[{kind:'render_video',path,projectId:'p1',versionId:'v1'}]},{projectId:'p1'}) as any;
 expect(receipt.status).toBe('complete');expect(probe(path).streams.some((s:any)=>s.codec_type==='video')).toBe(true);
},60_000);

it('mixes the sound alone, levelled, without drawing a picture',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-agent-audio-')),state=project(dir),mp3=join(dir,'sound.mp3');
 expect(await exportAudio({ffmpeg:ffmpeg!,timeline:state.timeline,footage:state.footage,workDir:join(dir,'audio-work')},mp3,'mp3')).toBe(true);
 const audio=probe(mp3);expect(audio.streams.map((s:any)=>s.codec_name)).toEqual(['mp3']);expect(Math.abs(Number(audio.format.duration)-3)).toBeLessThan(.1);
 const silent=emptyTimeline('s');expect(await exportAudio({ffmpeg:ffmpeg!,timeline:TimelineSchema.parse(silent),footage:emptyFootage(),workDir:join(dir,'silent-work')},join(dir,'none.mp3'),'mp3')).toBe(false);
},60_000);
