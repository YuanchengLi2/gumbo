import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {emptyTimeline,TimelineSchema} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {exportNative,planPieces,parseColour} from '../../apps/desktop/src/main/native-export';

const anchor=(clipId:string,at:'start'|'end'|number='start')=>({kind:'clip' as const,clipId,at,offsetSec:0});
const clip=(id:string,srcIn:number,srcOut:number,extra:object={})=>({id,assetId:'v',srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',...extra});
/** A clip whose left half is red and right half blue, so a zoom about the centre keeps the boundary in the middle. */
function footage(dir:string){
 const file=join(dir,'halves.mp4'),r=spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=red:s=160x180:r=30:d=4','-f','lavfi','-i','color=c=blue:s=160x180:r=30:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-filter_complex','[0:v][1:v]hstack,format=yuv420p[v]','-map','[v]','-map','2:a','-c:v','libx264','-c:a','aac','-shortest',file],{windowsHide:true});
 if(r.status)throw new Error(r.stderr.toString());
 const f=emptyFootage();f.assets=[AssetSchema.parse({id:'v',filename:'halves.mp4',kind:'video',originalPath:file,durationSec:4,width:320,height:180,fps:30,hasAudio:true,fingerprint:'v',status:'ready',audioPath:file})];return f;
}

it('reads the colour tags the browser would use, assuming BT.709 for untagged video and BT.601 full range for untagged images',()=>{
 expect(parseColour('  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080',false)).toEqual({matrix:'bt709',range:'tv',yuv:true});
 expect(parseColour('  Stream #0:0: Video: h264 (High), yuv420p(tv, bt470bg/bt470bg/smpte170m, progressive), 640x480',false)).toEqual({matrix:'bt470',range:'tv',yuv:false});
 expect(parseColour('  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160',false)).toMatchObject({matrix:'bt2020',yuv:false});
 expect(parseColour('  Stream #0:0: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 1600x1200',true)).toEqual({matrix:'bt470',range:'pc',yuv:false});
 expect(parseColour('  Stream #0:0: Video: png, rgb24(pc), 1600x1200',true)).toMatchObject({range:'pc',yuv:false});
});

it('renders footage with ffmpeg and sends only what the browser alone can draw to the browser',()=>{
 const t=emptyTimeline('t');t.settings={...t.settings,width:320,height:180};
 t.spine=[clip('a',0,2),clip('b',2,4,{transitionIn:{type:'crossfade',durationSec:.4}}),clip('c',0,2,{transitionIn:{type:'whip',durationSec:.4}})];
 t.attached=[{id:'title',type:'overlay',component:'lower_third',start:anchor('a',.5),durationSec:.5,params:{text:'Hello'},layer:1,reason:''},{id:'push',type:'effect',component:'slow_push',start:anchor('b'),end:anchor('b','end'),params:{},layer:0,reason:''}];
 const pieces=planPieces(TimelineSchema.parse(t),footage(mkdtempSync(join(tmpdir(),'dream-native-plan-'))));
 expect(pieces[0]).toMatchObject({from:0,to:pieces[1].from,browser:undefined});
 expect(pieces.filter(p=>p.browser).map(p=>p.browser)).toEqual(['the lower_third element','a whip transition','a whip transition']);
 // A title over footage needs only its own layer from the browser; a transition it draws needs the whole frame.
 expect(pieces.filter(p=>p.browser).map(p=>p.browserLayer)).toEqual(['overlays','all','all']);
 expect(pieces.some(p=>p.kind==='transition'&&!p.browser)).toBe(true);
 // Every frame is covered exactly once.
 pieces.forEach((p,i)=>{expect(p.to).toBeGreaterThan(p.from);if(i)expect(p.from).toBe(pieces[i-1].to);});
});

it('exports cuts, a slow push about the centre and the sound, frame-exact',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-native-export-')),f=footage(dir),t=emptyTimeline('t');t.settings={...t.settings,width:320,height:180};
 t.spine=[clip('a',0,1.5),clip('b',2,3.5)];
 t.attached=[{id:'push',type:'effect',component:'slow_push',start:anchor('b'),end:anchor('b','end'),params:{amount:.5},layer:0,reason:''}];
 const output=join(dir,'out.mp4');
 const result=await exportNative({ffmpeg:ffmpeg!,timeline:TimelineSchema.parse(t),footage:f,output,workDir:join(dir,'work'),renderBrowser:async()=>{throw new Error('Nothing here needs the browser');}});
 expect(result.browserPieces).toBe(0);
 const probe=JSON.parse(spawnSync(ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}).stdout);
 expect(probe.streams.find((s:any)=>s.codec_type==='video').nb_read_frames).toBe('90');
 expect(probe.streams.some((s:any)=>s.codec_type==='audio')).toBe(true);expect(Math.abs(Number(probe.format.duration)-3)).toBeLessThan(.05);
 // The last frame, zoomed 1.5x: red still meets blue in the middle of the frame.
 const row=spawnSync(ffmpeg!,['-v','error','-sseof','-0.1','-i',output,'-vf','crop=320:1:0:90,format=rgb24','-frames:v','1','-f','rawvideo','-'],{maxBuffer:1<<20}).stdout;
 const red=(x:number)=>row[x*3]>row[x*3+2];
 expect(red(150)).toBe(true);expect(red(170)).toBe(false);
},60_000);
