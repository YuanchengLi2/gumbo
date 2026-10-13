import {it,expect} from 'vitest';
import {mkdtempSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {emptyTimeline,TimelineSchema} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {exportNative,exportAudio,planPieces,parseColour,exportSpace,assertExportSpace} from '../../apps/desktop/src/main/native-export';

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

it('deletes each graphics layer once its run is encoded, and refuses an export the drive cannot hold, saying how much it needs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-native-layers-')),f=footage(dir),t=emptyTimeline('t');t.settings={...t.settings,width:320,height:180};
 t.spine=[clip('a',0,1.5),clip('b',2,3.5)];
 t.attached=[{id:'title',type:'overlay',component:'lower_third',start:anchor('a',.5),durationSec:.5,params:{text:'Hello'},layer:1,reason:''}];
 const timeline=TimelineSchema.parse(t),work=join(dir,'work'),rendered:string[]=[];
 // The browser's layer: a transparent clip of the piece's length.
 const renderBrowser=async(from:number,to:number,file:string)=>{rendered.push(file);const r=spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i',`color=c=black@0:s=320x180:r=30:d=${(to-from)/30},format=rgba`,'-c:v','png',file],{windowsHide:true});if(r.status)throw new Error(r.stderr.toString());};
 const result=await exportNative({ffmpeg:ffmpeg!,timeline,footage:f,output:join(dir,'out.mp4'),workDir:work,renderBrowser});
 expect(result.browserPieces).toBe(1);expect(rendered).toHaveLength(1);expect(existsSync(rendered[0])).toBe(false);expect(existsSync(join(dir,'out.mp4'))).toBe(true);
 // About 41 MB a second for 1080p30 graphics over footage; this one is tiny, so mostly the fixed margin.
 const pieces=planPieces(timeline,f),need=exportSpace(pieces,timeline.settings);expect(need).toBeGreaterThan(300e6);expect(need).toBeLessThan(400e6);
 expect(exportSpace([{...pieces[0],from:0,to:30*60,browserLayer:'overlays'}],{width:1920,height:1080,fps:30})).toBeGreaterThan(2.4e9);
 expect(()=>assertExportSpace('C:\exports\work',need,1.2e9)).not.toThrow();
 expect(()=>assertExportSpace('C:\exports\work',4.2e9,1.8e9)).toThrow('Export needs about 4.2 GB free on C:; 1.8 GB is free.');
},120_000);

it('draws keyframed zoom and pan natively, where the player puts them',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-native-keys-')),f=footage(dir),t=emptyTimeline('t');t.settings={...t.settings,width:320,height:180};
 // Zoomed 1.5x the whole time; the picture's centre moves from the middle to three quarters across over source seconds 1-3.
 t.spine=[clip('a',1,3.4,{keyframes:[{sec:1,scale:1.5,x:.5},{sec:3,x:.75}]})];
 const output=join(dir,'out.mp4'),timeline=TimelineSchema.parse(t);
 expect(planPieces(timeline,f).every(p=>!p.browser)).toBe(true);
 await exportNative({ffmpeg:ffmpeg!,timeline,footage:f,output,workDir:join(dir,'work'),renderBrowser:async()=>{throw new Error('Keyframed zoom and pan need no browser');}});
 // The red/blue boundary starts mid-frame (160) and is 40 px right at source second 2 and 80 px right from second 3 on.
 const boundary=(seconds:number)=>{const row=spawnSync(ffmpeg!,['-v','error','-ss',String(seconds),'-i',output,'-vf','crop=320:1:0:90,format=rgb24','-frames:v','1','-f','rawvideo','-'],{maxBuffer:1<<20}).stdout;let x=0;while(x<319&&row[x*3]>row[x*3+2])x++;return x;};
 expect(Math.abs(boundary(0)-160)).toBeLessThanOrEqual(3);expect(Math.abs(boundary(1)-200)).toBeLessThanOrEqual(3);expect(Math.abs(boundary(2.2)-240)).toBeLessThanOrEqual(3);
 // Rotation keyframes still go to the browser.
 t.spine=[clip('a',1,3.4,{keyframes:[{sec:1,rotation:0},{sec:3,rotation:30}]})];
 expect(planPieces(TimelineSchema.parse(t),f)[0].browser).toBe('rotation, opacity or colour keyframes');
},60_000);

it('writes the chosen size, frame rate, codec and container in the one encode, and the sound alone without any picture',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-native-out-')),f=footage(dir),t=emptyTimeline('t');t.settings={...t.settings,width:320,height:180};
 t.spine=[clip('a',0,1.5),clip('b',2,3.5)];const timeline=TimelineSchema.parse(t),output=join(dir,'out.mov');
 await exportNative({ffmpeg:ffmpeg!,timeline,footage:f,output,workDir:join(dir,'work'),video:{width:160,height:90,fps:24,codec:'hevc',quality:'lower'},container:'mov',renderBrowser:async()=>{throw new Error('No browser');}});
 const probe=JSON.parse(spawnSync(ffprobe.path,['-v','error','-count_frames','-show_streams','-show_format','-of','json',output],{encoding:'utf8'}).stdout),video=probe.streams.find((s:any)=>s.codec_type==='video');
 expect(video).toMatchObject({codec_name:'hevc',width:160,height:90,r_frame_rate:'24/1',nb_read_frames:'72'});expect(probe.format.format_name).toContain('mov');
 expect(Math.abs(Number(probe.format.duration)-3)).toBeLessThan(.06);
 const mp3=join(dir,'sound.mp3');expect(await exportAudio({ffmpeg:ffmpeg!,timeline,footage:f,workDir:join(dir,'audio-work')},mp3,'mp3')).toBe(true);
 const audio=JSON.parse(spawnSync(ffprobe.path,['-v','error','-show_streams','-show_format','-of','json',mp3],{encoding:'utf8'}).stdout);
 expect(audio.streams.map((s:any)=>s.codec_name)).toEqual(['mp3']);expect(Math.abs(Number(audio.format.duration)-3)).toBeLessThan(.1);
},120_000);
