/** Renders one test timeline with the browser export and with the native export, times both, and compares every frame
 * (SSIM). The timeline exercises what the native export draws: fit and fill framing with position and scale, flips,
 * opacity, the grade and white balance, slow push, punch zoom, shake, a grade layer, a crossfade, a dip to black, a footage
 * overlay and captions, with clip sound and music; a lower third is drawn by the browser between native pieces. Usage: pnpm exec tsx scripts/compare-export.ts [talk recording] [--native-only] */
import {join,resolve} from 'node:path';
import {mkdtempSync,mkdirSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {renderMedia,selectComposition} from '@remotion/renderer';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {renderServer} from '../apps/desktop/src/main/render-server';
import {frameFormat,renderConcurrency} from '../apps/desktop/src/main/render-settings';
import {exportNative,planPieces} from '../apps/desktop/src/main/native-export';

const ffmpeg=process.env.DREAM_FFMPEG??ffmpegStatic!,args=process.argv.slice(2),nativeOnly=args.includes("--native-only"),keep=args.includes("--keep"),talk=resolve(args.find(a=>!a.startsWith('--'))??'artifacts/footage-cache/fun-with-foss-talk.mp4');
const staged=resolve('apps/desktop/resources/staged'),browserExecutable=join(staged,'render-browser/chrome-headless-shell.exe'),serveUrl=join(staged,'remotion'),binariesDirectory=join(staged,'compositor');
if(!existsSync(browserExecutable))throw new Error('Stage the render browser first.');
const folder=mkdtempSync(join(tmpdir(),'dream-compare-')),media=join(folder,'media');mkdirSync(media);
const make=(name:string,args:string[])=>{const out=join(media,name),r=spawnSync(ffmpeg,['-y','-v','error',...args,out]);if(r.status)throw new Error(r.stderr.toString());return out;};
const bars=make('bars.mp4',['-f','lavfi','-i','testsrc2=s=1280x720:r=30:d=8','-f','lavfi','-i','sine=frequency=330:duration=8','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest']);
const still=make('still.png',['-f','lavfi','-i','testsrc=s=1600x1200','-frames:v','1']);
const tone=make('music.wav',['-f','lavfi','-i','sine=frequency=220:duration=20','-ar','48000','-ac','2']);
const talkClip=existsSync(talk)?make('talk.mp4',['-ss','300','-t','8','-i',talk,'-c','copy']):bars;
const asset=(id:string,path:string,kind:'video'|'image'|'audio',duration:number,width:number,height:number,hasAudio:boolean)=>AssetSchema.parse({id,filename:id,kind,originalPath:path,durationSec:duration,width,height,fps:30,hasAudio,fingerprint:id,status:'ready',...(hasAudio&&kind!=='image'?{audioPath:path}:{})});
const db=new ProjectDB(folder,'Compare');
for(const a of [asset('talk',talkClip,'video',8,1920,1080,true),asset('bars',bars,'video',8,1280,720,true),asset('still',still,'image',5,1600,1200,false),asset('music',tone,'audio',20,0,0,true)])db.saveAsset(a);
db.saveRecords('words',['This','is','the','native','export','test','with','captions'].map((text,i)=>({id:'w'+i,assetId:'talk',text,start:.4+i*.45,end:.8+i*.45,confidence:1,speaker:'a',pauseBefore:0})) as any);
const clip=(id:string,assetId:string,srcIn:number,srcOut:number,extra:any={})=>({id,assetId,srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'compare',...extra});
const anchor=(clipId:string,at:any='start')=>({kind:'clip',clipId,at,offsetSec:0});
db.apply([
 {type:'insert_clip',position:0,clip:clip('a','talk',0,4),reason:'compare'},
 {type:'insert_clip',position:1,clip:clip('b','bars',1,5,{framing:{mode:'fill',scale:1.2,x:.3,y:.5,exposure:.3,contrast:1.2,saturation:.6,temperature:.5},transitionIn:{type:'crossfade',durationSec:.6}}),reason:'compare'},
 {type:'insert_clip',position:2,clip:clip('c','still',0,3,{holdSec:3,framing:{mode:'fit',scale:1,x:.5,y:.5,flipX:true,opacity:.8},transitionIn:{type:'dip_to_black',durationSec:.8}}),reason:'compare'},
 {type:'add_item',item:{id:'push',type:'effect',component:'slow_push',start:anchor('a'),end:anchor('a','end'),params:{amount:.1},layer:0,reason:'compare'},reason:'compare'},
 {type:'add_item',item:{id:'shake',type:'effect',component:'shake',start:anchor('b',1),durationSec:1,params:{amount:.1},layer:0,reason:'compare'},reason:'compare'},
 {type:'add_item',item:{id:'grade',type:'effect',component:'grade',start:anchor('b',2.2),durationSec:1.2,params:{exposure:-.3,saturation:1.4,temperature:-.6},layer:0,reason:'compare'},reason:'compare'},
 {type:'add_item',item:{id:'punch',type:'effect',component:'punch_zoom',start:anchor('c',1),durationSec:1,params:{amount:.2},layer:0,reason:'compare'},reason:'compare'},
 {type:'add_item',item:{id:'title',type:'overlay',component:'lower_third',start:anchor('a',1),durationSec:1.2,params:{text:'Drawn by the browser'},layer:2,reason:'compare'},reason:'compare'},
 {type:'add_item',item:{id:'pip',type:'overlay',component:'source',source:{assetId:'still',srcIn:0,srcOut:2},start:anchor('b',.5),durationSec:2,params:{x:.75,y:.3,scale:.4},layer:1,reason:'compare'},reason:'compare'},
 {type:'set_captions',captions:{style:'karaoke',params:{},overrides:[]},reason:'compare'},
 {type:'add_music',music:{id:'m',assetId:'music',srcIn:0,srcOut:11,start:{kind:'project',at:'start',offsetSec:0},gainDb:-12,duckUnderSpeechDb:12,fadeInSec:.3,fadeOutSec:1,reason:'compare'},reason:'compare'}
] as any,'Compare','compare',db.head());
const state=db.state();db.close();
console.log('pieces:',planPieces(state.timeline,state.footage).map(p=>`${p.kind}${p.browser?'(browser: '+p.browser+')':''} ${p.from}-${p.to}`).join(', '));

const server=await renderServer(new Map(state.footage.assets.map(a=>[a.id,a])),undefined,{engineRuntime:join(staged,'engine')});
try{
 const inputProps={timeline:state.timeline,footage:state.footage,media:server.media,audioMedia:server.audioMedia,exporting:true,engineBase:server.engineBase};
 const composition=await selectComposition({serveUrl,id:'Dream',inputProps,browserExecutable,binariesDirectory});
 const reference=join(folder,'browser.mp4');let started=Date.now();
 if(!nativeOnly)await renderMedia({serveUrl,composition,inputProps,codec:'h264',crf:12,...frameFormat(),outputLocation:reference,browserExecutable,binariesDirectory,concurrency:renderConcurrency()});
 const browserSeconds=(Date.now()-started)/1000;
 const native=join(folder,'native.mp4');started=Date.now();
 const result=await exportNative({ffmpeg,timeline:state.timeline,footage:state.footage,output:native,workDir:join(folder,'work'),onProgress:(done,total,phase)=>console.log(`${((Date.now()-started)/1000).toFixed(1)}s ${phase} ${done}/${total}`),renderBrowser:async(from,to,file)=>{const hidden={...state.timeline,trackSettings:{...state.timeline.trackSettings,captions:{...state.timeline.trackSettings?.captions,hidden:true}}};await renderMedia({serveUrl,composition,inputProps:{...inputProps,timeline:hidden},codec:'prores',proResProfile:'hq',muted:true,outputLocation:file,browserExecutable,binariesDirectory,frameRange:[from,to-1]});}});
 const nativeSeconds=(Date.now()-started)/1000;
 if(nativeOnly){console.log(JSON.stringify({nativeSeconds,...result,folder}));}else{
 const ssim=spawnSync(ffmpeg,['-hide_banner','-i',native,'-i',reference,'-lavfi','[0:v]scale=in_range=auto,format=gbrp[a];[1:v]scale=in_range=auto,format=gbrp[b];[a][b]ssim=stats_file=ssim.log','-f','null','-'],{cwd:folder,encoding:'utf8'});
 const all=/All:([\d.]+)/.exec(ssim.stderr)?.[1];
 const perFrame=spawnSync('powershell',['-NoProfile','-Command',`Get-Content '${join(folder,'ssim.log')}' | ForEach-Object { if($_ -match 'n:(\\d+).*All:([\\d.]+)'){ "$($matches[1]) $($matches[2])" } }`],{encoding:'utf8'}).stdout.trim().split(/\r?\n/).map(l=>l.split(' ').map(Number));
 const worst=[...perFrame].sort((a,b)=>a[1]-b[1]).slice(0,8);
 console.log(JSON.stringify({browserSeconds,nativeSeconds,speedup:Math.round(browserSeconds/nativeSeconds*10)/10,...result,ssim:Number(all),worstFrames:worst,folder},null,1));
 }
}finally{await server.close();if(!keep)rmSync(folder,{recursive:true,force:true});}
