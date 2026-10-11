import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {emptyTimeline} from '@dream/timeline';
import {emptyFootage,AssetSchema} from '@dream/footage';
import {normalizeLoudness} from '../../apps/desktop/src/main/export-loudness';
import {measureLoudness} from '../../apps/project-service/src/footage-map';
import {audioManifest,autoLevelDb} from '../../packages/composition/src/audio-manifest';

const make=(file:string,audio:string[])=>{const r=spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=4',...audio,'-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',file],{windowsHide:true});if(r.status)throw new Error(r.stderr.toString());return file;};
const videoHash=(file:string)=>spawnSync(ffmpeg!,['-v','error','-i',file,'-map','0:v','-c','copy','-f','md5','-'],{encoding:'utf8',windowsHide:true}).stdout.trim();

it('brings an export to the standard loudness without touching the picture, and leaves silence alone',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dream-loudness-')),quiet=make(join(dir,'quiet.mp4'),['-f','lavfi','-i','sine=frequency=440:duration=4,volume=0.03']);
 const before=await measureLoudness(ffmpeg!,quiet,new AbortController().signal),picture=videoHash(quiet);expect(before!).toBeLessThan(-30);
 const result=await normalizeLoudness(ffmpeg!,quiet);expect(result.changed).toBe(true);
 expect(Math.abs((await measureLoudness(ffmpeg!,quiet,new AbortController().signal))!+14)).toBeLessThan(1);expect(videoHash(quiet)).toBe(picture);
 const probe=spawnSync(ffprobe.path,['-v','error','-show_streams','-of','json',quiet],{encoding:'utf8'});expect(JSON.parse(probe.stdout).streams.map((s:any)=>s.codec_type).sort()).toEqual(['audio','video']);
 const silent=make(join(dir,'silent.mp4'),['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']);expect((await normalizeLoudness(ffmpeg!,silent)).changed).toBe(false);
},60_000);

it('levels each clip toward a common loudness from its measurement, unless the project turns it off',()=>{
 const t=emptyTimeline('t');expect(autoLevelDb(t,{loudnessLufs:-30})).toBe(12);expect(autoLevelDb(t,{loudnessLufs:-10})).toBe(-8);expect(autoLevelDb(t,{})).toBe(0);
 const footage=emptyFootage();footage.assets=[AssetSchema.parse({id:'v',filename:'v.mp4',kind:'video',originalPath:'v.mp4',durationSec:10,hasAudio:true,fingerprint:'v',loudnessLufs:-24})];
 t.spine=[{id:'a',assetId:'v',srcIn:0,srcOut:4,speed:1,audio:{gainDb:-2,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:''}];
 expect(audioManifest(t,footage)[0].gainDb).toBe(4);
 t.settings.autoLevel=false;expect(audioManifest(t,footage)[0].gainDb).toBe(-2);
});
