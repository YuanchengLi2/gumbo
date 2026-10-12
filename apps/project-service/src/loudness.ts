import {spawn} from 'node:child_process';

/** Integrated loudness of a source's audio in LUFS (EBU R128), or undefined for silence. The player and export level each
 * clip toward a common loudness from it. */
export function measureLoudness(ffmpeg:string,audio:string,signal:AbortSignal){return new Promise<number|undefined>((resolve,reject)=>{
 const child=spawn(ffmpeg,['-hide_banner','-nostats','-i',audio,'-af','ebur128','-f','null','-'],{windowsHide:true,signal});let log='';
 child.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-4000);});child.on('error',reject);
 child.on('close',code=>{if(code!==0)return reject(new Error('Loudness measurement failed: '+log.slice(-500)));const value=Number(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(log)?.[1]);resolve(Number.isFinite(value)&&value>-70?value:undefined);});
});}
