import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import {Buffer} from 'buffer';
import {mixBlocks,soundingSegments,RATE} from '../export/sound';
import {encodeAudio} from './media/audio-encode';
export * from '../../../project-service/src/edit-audio';

/** Roux's listening on the web: the edit's sound between two timeline times, mixed by the export's mixer
 * (export/sound.ts) rather than the ffmpeg filter graph the desktop builds (edit-audio.ts), as the same small MP3: mono,
 * 24 kHz, 64 kb/s. Undefined when nothing sounds there. Extracting a file's sound and measuring a clip are ffmpeg
 * commands the media worker answers, so they stay the desktop's. */
export async function mixEditRange(_ffmpeg:string,timeline:TimelineDocument,footage:FootageIndex,startSec:number,endSec:number,signal:AbortSignal){
 const from=Math.round(startSec*RATE),to=Math.round(endSec*RATE);if(to<=from||!soundingSegments(timeline,footage,from,to).length)return undefined;
 async function*mono(){for await(const [left,right] of mixBlocks(timeline,footage,from,to,signal)){const out=new Float32Array(left.length>>1);for(let i=0;i<out.length;i++)out[i]=(left[2*i]+left[2*i+1]+right[2*i]+right[2*i+1])/4;yield [out];}}
 return Buffer.from((await encodeAudio(mono(),{format:'mp3',rate:24000,channels:1,bitrate:64_000},undefined,signal))!);
}
