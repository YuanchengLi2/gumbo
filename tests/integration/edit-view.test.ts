import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {emptyTimeline,TimelineSchema} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {jpeg} from '../../apps/project-service/src/source-frames';
import {viewEdit,viewTimes} from '../../apps/project-service/src/edit-view';
import {PlayerFrames} from '../../apps/desktop/src/main/player-frames';

// 13 of the agent's image reads failed with "Source frame could not be decoded.": a still JPEG read with -ss 0 gives nothing.
it('reads a still JPEG the agent\'s code made, as it reads a PNG',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-still-'));
 for(const name of ['sheet.jpg','sheet.png']){const path=join(folder,name);execFileSync(ffmpeg!,['-v','error','-f','lavfi','-i','color=c=red:s=320x180','-frames:v','1',path]);
  const bytes=await jpeg(ffmpeg!,path,0,undefined,1024);expect(bytes[0]).toBe(255);expect(bytes[1]).toBe(216);}
});

const footage=()=>{const f=emptyFootage();f.assets=[
 AssetSchema.parse({id:'tall',filename:'tall.mp4',kind:'video',originalPath:'tall.mp4',durationSec:20,width:1080,height:1920,fps:30,hasAudio:true,fingerprint:'t',status:'ready'}),
 AssetSchema.parse({id:'logo',filename:'logo.png',kind:'image',originalPath:'logo.png',durationSec:5,width:400,height:400,fps:30,hasAudio:false,fingerprint:'l',status:'ready'})];return f;};
const timeline=()=>{const t=emptyTimeline('t');return TimelineSchema.parse({...t,settings:{...t.settings,width:1080,height:1920},
 spine:[{id:'a',assetId:'tall',srcIn:2,srcOut:12,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''}],
 attached:[{id:'logo-overlay',type:'overlay',component:'image',source:{assetId:'logo',srcIn:0,srcOut:5},start:{kind:'clip',clipId:'a',at:'start',offsetSec:1},durationSec:3,params:{x:.9,y:.1,scale:.3,opacity:.8},layer:1,reason:''},
  {id:'title',type:'overlay',component:'title_card',start:{kind:'clip',clipId:'a',at:'start',offsetSec:0},durationSec:2,params:{text:'VS',color:'#ffd400'},layer:2,reason:''}]});};

it('says exactly what is on screen at each moment the agent asks about, with the frames and their colours',async()=>{
 const asked:any[]=[];
 const draw=async(request:any)=>{asked.push(request);return{versionId:request.versionId,frames:request.frames.map((f:any)=>({...f,mimeType:'image/jpeg' as const,data:'/9j/AA==',sha256:'0'.repeat(64),stats:{mean:'#808080',grid:Array(9).fill('#808080')}}))};};
 const result=await viewEdit({times:[1.5,5]},{versionId:'v1',timeline:timeline(),footage:footage()},draw,new AbortController().signal);
 expect(asked[0].frames.map((f:any)=>f.frame)).toEqual([45,150]);
 const summary=JSON.parse(result.content[0].text!),first=summary.moments[0];
 expect(first.atSec).toBe(1.5);expect(first.colours.mean).toBe('#808080');
 expect(first.onScreen.map((l:any)=>l.item??l.fill)).toEqual(['#0b0c0e','a','logo-overlay','title']);
 expect(first.onScreen.find((l:any)=>l.item==='a')).toMatchObject({shows:'tall.mp4',kind:'video',sourceSec:3.5,box:{x:0,y:0,w:1080,h:1920}});
 expect(first.onScreen.find((l:any)=>l.item==='logo-overlay')).toMatchObject({kind:'image',opacity:.8});
 expect(first.onScreen.find((l:any)=>l.item==='title')).toMatchObject({kind:'title_card',text:'VS',color:'#ffd400'});
 // At 5 s only the clip is left.
 expect(summary.moments[1].onScreen.map((l:any)=>l.item??l.fill)).toEqual(['#0b0c0e','a']);
 expect(result.content.filter((b:any)=>b.type==='image')).toHaveLength(2);
});

it('still says what is on screen when no window can draw, and spreads a range over about one moment a second inside the video',async()=>{
 const failed=await viewEdit({startSec:0,endSec:10},{versionId:'v1',timeline:timeline(),footage:footage()},async()=>{throw new Error('The editor window is closed');},new AbortController().signal);
 const summary=JSON.parse(failed.content[0].text!);expect(summary.note).toContain('editor window is closed');expect(summary.moments).toHaveLength(10);expect(failed.content).toHaveLength(1);expect(viewTimes({startSec:0,endSec:3},10,30)).toHaveLength(6);expect(viewTimes({startSec:0,endSec:9.9},10,30)).toHaveLength(10);
 expect(viewTimes({times:[-2,4,4,99]},10,30)).toEqual([0,4,9.967]);expect(viewTimes({startSec:3},10,30)).toEqual([3]);
});

it('asks the editor window for frames and returns its answer, or its error, or gives up when stopped',async()=>{
 const sent:any[]=[];const win={isDestroyed:()=>false,webContents:{send:(_channel:string,event:any)=>sent.push(event)}} as any;
 const frames=new PlayerFrames(()=>win),request={versionId:'v1',timeline:timeline(),footage:footage(),frames:[{frame:45,labels:['1.5s']}]};
 const pending=frames.request(request,new AbortController().signal);expect(sent[0].type).toBe('frames.request');
 frames.settle(sent[0].payload.id,{versionId:'v1',frames:[{frame:45,labels:['1.5s'],mimeType:'image/jpeg',data:'/9j/AA==',sha256:'0'.repeat(64),stats:{mean:'#ffffff',grid:Array(9).fill('#ffffff')}}]});
 expect((await pending).frames[0].stats?.mean).toBe('#ffffff');
 const failing=frames.request(request,new AbortController().signal);frames.settle(sent[1].payload.id,{error:'WebGL2 is unavailable'});await expect(failing).rejects.toThrow('WebGL2');
 const controller=new AbortController(),stopped=frames.request(request,controller.signal);controller.abort(new Error('Stopped by you.'));await expect(stopped).rejects.toThrow('Stopped');
 await expect(new PlayerFrames(()=>undefined).request(request,new AbortController().signal)).rejects.toThrow('closed');
});
