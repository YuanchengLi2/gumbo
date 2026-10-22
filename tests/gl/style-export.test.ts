import {it,expect} from 'vitest';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {emptyTimeline,TimelineSchema} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';

/** A sample edit using the new library end to end: transitions (whip, film burn, shake cut, light leak, zoom blur), looks
 * (film stock, B&W punch), a speed curve, a freeze frame, effects (camera shake, flash, punch-in), an Impact title, a bar
 * lower third and bounce captions. Exported by the app's own Export in a hidden window, then compared with the frames the
 * paused player draws at the same moments: the two must match, since one engine draws both. */
const W=960,H=540,FPS=30,BLOCK=20;
const clip=(id:string,assetId:string,srcIn:number,srcOut:number,extra:object={})=>({id,assetId,srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',...extra});
const fill=(o:object)=>({mode:'fill',scale:1,x:.5,y:.5,...o});
const at=(sec:number)=>({kind:'project',at:'start',offsetSec:sec});
const item=(id:string,type:string,component:string,start:number,durationSec:number,params:object)=>({id,type,component,start:at(start),durationSec,layer:0,params,reason:''});
const PROBES=[1,3,4.4,6,7,8.5,9,9.5,10.6,12.5,13.5];

it('exports the new transitions, looks, effects, speed curve, freeze, titles and captions exactly as the preview draws them',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gumbo-style-export-')),require_=createRequire(import.meta.url),here=resolve('tests/gl');
 // Tagged BT.709 as phone and camera footage is: untagged files are read as BT.601 by <video> but BT.709 by Export's
 // decoder, a difference in how sources are decoded rather than in anything drawn here.
 const make=(name:string,source:string)=>{const file=join(dir,name);execFileSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i',source,'-f','lavfi','-i','sine=frequency=330:duration=8','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-color_range','tv','-g','15','-c:a','aac',file]);return file;};
 const a=make('a.mp4',`testsrc2=size=${W}x${H}:rate=${FPS}:duration=8`),b=make('b.mp4',`smptehdbars=size=${W}x${H}:rate=${FPS}:duration=8,hue=H=t*0.8`);
 const footage=emptyFootage(),asset=(id:string,file:string)=>AssetSchema.parse({id,filename:id+'.mp4',kind:'video',originalPath:file,durationSec:8,width:W,height:H,fps:FPS,hasAudio:true,fingerprint:id,status:'ready'});
 footage.assets=[asset('a',a),asset('b',b)];
 footage.words=['Every','look','is','new'].map((text,n)=>({id:'w'+n,assetId:'a',text,start:.5+n*.5,end:.9+n*.5})) as any;
 const t=emptyTimeline('sample'),timeline=TimelineSchema.parse({...t,settings:{...t.settings,width:W,height:H,fps:FPS},
  spine:[clip('a1','a',0,3,{framing:fill({filter:'film'})}),
   clip('b1','b',0,3,{speedRamp:{preset:'hero',amount:1},transitionIn:{type:'whip',durationSec:.5,direction:'left'}}),
   clip('a2','a',3,5.5,{transitionIn:{type:'film_burn',durationSec:.9}}),
   clip('still','a',5.5,5.5+1/FPS,{holdSec:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:true},transitionIn:{type:'shake_cut',durationSec:.4}}),
   clip('b2','b',3,6,{framing:fill({filter:'bw_punch'}),transitionIn:{type:'light_leak',durationSec:.9}}),
   clip('a4','a',.5,3,{transitionIn:{type:'zoom_blur',durationSec:.45}})],
  attached:[item('title','overlay','text',.2,2.2,{text:'New looks',style:'impact'}),item('name','overlay','text',6.5,2.5,{text:'Alex Rivera',style:'lt_bar'}),
   item('shake','effect','camera_shake',4,.8,{amount:.6}),item('flash','effect','flash',10.5,.5,{amount:.9}),item('punch','effect','punch_in',13,2,{amount:.25})],
  captions:{style:'bounce',params:{},overrides:[]}});
 // The export and a contact sheet of its probe frames stay in test-results/style-export for a person to look at.
 const kept=resolve('test-results/style-export');mkdirSync(kept,{recursive:true});
 const spec=join(dir,'spec.json'),out=join(kept,'export.mp4');writeFileSync(spec,JSON.stringify({timeline,footage,probes:PROBES}));
 execFileSync(process.execPath,[require_.resolve('esbuild/bin/esbuild'),join(here,'export-harness.ts'),'--bundle','--format=iife','--outfile='+join(here,'export-harness.js'),'--log-level=error']);
 writeFileSync(join(here,'export.html'),'<!doctype html><meta charset="utf-8"><script src="export-harness.js"></script>');
 // Electron runs alongside (not blocking the test worker) while it exports.
 const electron=require_('electron') as unknown as string,child=spawn(electron,[join(here,'export-main.cjs')],{env:{...process.env,EXPORT_MEDIA:JSON.stringify({a,b}),EXPORT_SPEC:spec,EXPORT_OUT:out}});
 let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
 await new Promise<void>(done=>{const timer=setTimeout(()=>child.kill(),240000);child.on('exit',()=>{clearTimeout(timer);done();});});
 const line=stdout.split('\n').find(l=>l.startsWith('RESULT '));if(!line)throw new Error('Export harness failed: '+stdout+stderr);
 const result=JSON.parse(line.slice(7)) as {timing:{frames:number};preview:number[][]};
 // The whole edit, 15 s at 30 fps, is in the file.
 expect(result.timing.frames).toBe(450);expect(existsSync(out)&&statSync(out).size>100_000).toBe(true);
 const counted=execFileSync(ffprobe.path,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0',out],{encoding:'utf8'});expect(Number(counted.trim())).toBe(450);
 // Each probe: the exported frame, decoded, against the preview's drawing of it, block by block.
 const stats=PROBES.map((time,n)=>{
  const raw=execFileSync(ffmpeg!,['-v','error','-i',out,'-vf',`select=eq(n\\,${Math.round(time*FPS)}),format=rgb24`,'-frames:v','1','-f','rawvideo','-'],{maxBuffer:64<<20});
  const exported:number[]=[];for(let by=0;by<H/BLOCK;by++)for(let bx=0;bx<W/BLOCK;bx++){const sum=[0,0,0];for(let y=by*BLOCK;y<(by+1)*BLOCK;y++)for(let x=bx*BLOCK;x<(bx+1)*BLOCK;x++)for(let c=0;c<3;c++)sum[c]+=raw[(y*W+x)*3+c];exported.push(...sum.map(s=>s/(BLOCK*BLOCK)));}
  const diffs=exported.map((v,i)=>Math.abs(v-result.preview[n][i])),sorted=[...diffs].sort((x,y)=>x-y),worst=diffs.indexOf(sorted.at(-1)!),block=Math.floor(worst/3);
  return{time,mean:diffs.reduce((s,d)=>s+d,0)/diffs.length,p99:sorted[Math.floor(sorted.length*.99)],worst:{x:block%(W/BLOCK)*BLOCK,y:Math.floor(block/(W/BLOCK))*BLOCK,exported:exported.slice(block*3,block*3+3).map(Math.round),preview:result.preview[n].slice(block*3,block*3+3)}};
 });
 // A contact sheet of the exported probe frames, for a person to look at.
 execFileSync(ffmpeg!,['-y','-v','error','-i',out,'-vf',`select='${PROBES.map(t=>`eq(n\\,${Math.round(t*FPS)})`).join('+')}',scale=320:-1,tile=4x3`,'-frames:v','1',join(kept,'sheet.png')]);
 console.log('Export check in '+dir+'\n'+stats.map(s=>`${s.time}s mean ${s.mean.toFixed(2)} p99 ${s.p99.toFixed(1)} worst at ${s.worst.x},${s.worst.y} export ${s.worst.exported} preview ${s.worst.preview}`).join('\n'));
 // Encoding and the YUV round trip cost a few levels; a different picture (a missed effect, another source frame, a
 // shifted title) differs by tens across many blocks.
 for(const s of stats){expect(s.mean,`mean difference at ${s.time}s`).toBeLessThan(3);expect(s.p99,`99th percentile difference at ${s.time}s`).toBeLessThan(10);}
},300_000);
