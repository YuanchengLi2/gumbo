/** Times the native export on a long-form edit: a 38-minute 1080p talk cut into about 13 minutes of 150 clips, as a talk
 * edit with pauses removed looks, with captions, music, a slow push on every tenth clip and a punch zoom on every
 * fifteenth, then levelled as the app does. --graded adds a grade on every clip. Usage: pnpm exec tsx scripts/benchmark-native-export.ts [talk] [--graded] [--keep] (the output is deleted afterwards unless kept) */
import {join,resolve} from 'node:path';
import {mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {exportNative,planPieces} from '../apps/desktop/src/main/native-export';
import {normalizeLoudness} from '../apps/desktop/src/main/export-loudness';

const ffmpeg=process.env.DREAM_FFMPEG??ffmpegStatic!,args=process.argv.slice(2),graded=args.includes("--graded"),keep=args.includes("--keep"),talk=resolve(args.find(a=>!a.startsWith('--'))??'artifacts/footage-cache/fun-with-foss-talk.mp4');
if(!existsSync(talk))throw new Error('No talk recording at '+talk);
const folder=mkdtempSync(join(tmpdir(),'dream-native-bench-')),media=join(folder,'media');mkdirSync(media);
const tone=join(media,'music.wav');spawnSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','sine=frequency=220:duration=900','-ar','48000','-ac','2',tone]);
const asset=(id:string,path:string,kind:'video'|'audio',duration:number,width:number,height:number)=>AssetSchema.parse({id,filename:id,kind,originalPath:path,durationSec:duration,width,height,fps:30,hasAudio:true,fingerprint:id,status:'ready',audioPath:path});
const db=new ProjectDB(folder,'Bench');
db.saveAsset(asset('talk',talk,'video',2281,1920,1080));db.saveAsset(asset('music',tone,'audio',900,0,0));
// Words at a speaking pace across the whole recording.
const words=Array.from({length:Math.floor(2280*2.5)},(_,i)=>({id:'w'+i,assetId:'talk',text:['so','the','idea','here','is','that','we','build','it','together'][i%10],start:i*.4,end:i*.4+.32,confidence:1,speaker:'a',pauseBefore:0}));
db.saveRecords('words',words as any);
const clips=Array.from({length:150},(_,i)=>{const srcIn=8+i*15+(i%3),srcOut=srcIn+4.6+(i%4)*.4;return{id:'c'+i,assetId:'talk',srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'bench',...(graded?{framing:{mode:'fit',scale:1,x:.5,y:.5,exposure:.1,contrast:1.1,saturation:1.1,temperature:.2}}:{})};});
const anchor=(clipId:string,at:any='start')=>({kind:'clip',clipId,at,offsetSec:0});
db.apply([
 ...clips.map((clip,i)=>({type:'insert_clip',position:i,clip,reason:'bench'})),
 ...clips.filter((_,i)=>i%10===5).map(c=>({type:'add_item',item:{id:'push'+c.id,type:'effect',component:'slow_push',start:anchor(c.id),end:anchor(c.id,'end'),params:{amount:.08},layer:0,reason:'bench'},reason:'bench'})),
 ...clips.filter((_,i)=>i%15===7).map(c=>({type:'add_item',item:{id:'punch'+c.id,type:'effect',component:'punch_zoom',start:anchor(c.id,1),durationSec:1.5,params:{amount:.15},layer:0,reason:'bench'},reason:'bench'})),
 {type:'set_captions',captions:{style:'karaoke',params:{},overrides:[]},reason:'bench'},
 {type:'add_music',music:{id:'m',assetId:'music',srcIn:0,srcOut:700,start:{kind:'project',at:'start',offsetSec:0},gainDb:-18,duckUnderSpeechDb:12,fadeInSec:1,fadeOutSec:2,reason:'bench'},reason:'bench'}
] as any,'Bench','bench',db.head());
const state=db.state();db.close();
const pieces=planPieces(state.timeline,state.footage),seconds=pieces.at(-1)!.to/state.timeline.settings.fps;
console.log(`${pieces.length} pieces, ${(seconds/60).toFixed(1)} minutes, ${pieces.filter(p=>p.browser).length} for the browser`);
const started=Date.now();let lastLog=0;
const result=await exportNative({ffmpeg,timeline:state.timeline,footage:state.footage,output:join(folder,'native.mp4'),workDir:join(folder,'work'),
 renderBrowser:async()=>{throw new Error('No browser pieces expected');},
 onProgress:(done,total,phase)=>{const now=(Date.now()-started)/1000;if(now-lastLog>10||done===total){lastLog=now;console.log(`${now.toFixed(0)}s ${phase} ${done}/${total}`);}}});
const levelled=Date.now(),loudness=await normalizeLoudness(ffmpeg,join(folder,'native.mp4'));
const took=(Date.now()-started)/1000;
console.log(JSON.stringify({...result,graded,videoMinutes:Math.round(seconds/6)/10,exportSeconds:Math.round(took),loudnessSeconds:Math.round((Date.now()-levelled)/1000),loudness,timesRealTime:Math.round(seconds/took*10)/10,output:join(folder,'native.mp4')}));
if(!keep)rmSync(folder,{recursive:true,force:true});
