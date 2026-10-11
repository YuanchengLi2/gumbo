/** Times the footage map's measurements on a long recording: when the opening is mapped, how it grows, and the whole.
 * Usage: pnpm exec tsx scripts/benchmark-footage-map.ts [recording] */
import {resolve,join} from 'node:path';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';
import {AssetSchema} from '@dream/footage';
import {mapFootage} from '../apps/project-service/src/footage-map';

const ffmpeg=process.env.DREAM_FFMPEG??ffmpegStatic!,source=resolve(process.argv[2]??'artifacts/footage-cache/fun-with-foss-talk.mp4');
if(!existsSync(source))throw new Error('No recording at '+source);
const duration=Number(/Duration: (\d+):(\d+):([\d.]+)/.exec(spawnSync(ffmpeg,['-hide_banner','-i',source],{encoding:'utf8'}).stderr)!.slice(1).reduce((s,v)=>s*60+Number(v),0));
const dir=mkdtempSync(join(tmpdir(),'dream-map-bench-')),started=Date.now(),seconds=()=>Math.round((Date.now()-started)/100)/10;
try{
 const asset=AssetSchema.parse({id:'talk',filename:'talk.mp4',kind:'video',originalPath:source,durationSec:duration,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'talk',status:'ready'});
 const result=await mapFootage({ffmpeg,asset,dir,signal:new AbortController().signal,onProgress:p=>console.log(`${seconds()}s mapped to ${p.map.analyzedUntilSec}s (${p.shots.length} shots)`)});
 console.log(JSON.stringify({sourceMinutes:Math.round(duration/6)/10,totalSeconds:seconds(),shots:result.shots.length,frozen:result.map.frozen.length,black:result.map.black.length}));
}finally{rmSync(dir,{recursive:true,force:true});}
