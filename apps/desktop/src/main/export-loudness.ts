import {spawn} from 'node:child_process';
import {existsSync,renameSync,unlinkSync} from 'node:fs';

/** Online video loudness: -14 LUFS integrated with true peaks below -1.5 dBTP. */
export const EXPORT_LOUDNESS={integrated:-14,truePeak:-1.5,range:11};
export type Loudness={integrated:number;threshold:number;range:number;truePeak:number};

function ffmpegLog(ffmpeg:string,args:string[],signal?:AbortSignal){return new Promise<string>((resolve,reject)=>{const child=spawn(ffmpeg,args,{windowsHide:true,signal});let log='';child.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-20000);});child.on('error',reject);child.on('close',code=>code===0?resolve(log):reject(new Error('Loudness normalization failed: '+log.slice(-800))));});}
/** The summary ebur128 prints at the end of a pass (BS.1770 loudness, as loudnorm measures it, in a quarter of the time). */
export function measuredLoudness(log:string):Loudness|undefined{
 const at=log.lastIndexOf('Summary:');if(at<0)return;const summary=log.slice(at);
 const value=(pattern:RegExp)=>{const m=pattern.exec(summary);return m?Number(m[1]):NaN;};
 const result={integrated:value(/I:\s*(-?[\d.]+|-inf) LUFS/),threshold:value(/Threshold:\s*(-?[\d.]+) LUFS/),range:value(/LRA:\s*(-?[\d.]+) LU/),truePeak:value(/Peak:\s*(-?[\d.]+|-inf) dBFS/)};
 return Number.isFinite(result.integrated)?result:undefined;
}

/** AAC through the system's encoder when Windows has one (several times faster than ffmpeg's own), else ffmpeg's. */
let aac:Promise<string[]>|undefined;
export function aacArgs(ffmpeg:string){
 return aac??=ffmpegLog(ffmpeg,['-hide_banner','-v','error','-f','lavfi','-i','sine=duration=0.5','-ac','2','-c:a','aac_mf','-b:a','256k','-f','null','-']).then(()=>['-c:a','aac_mf','-b:a','256k'],()=>['-c:a','aac','-b:a','256k']);
}

/** Measures a file's sound: undefined when silent, else its level, whether it already matches, and the filter that brings it
 * to the standard level with peaks below truePeak: a plain gain when that keeps the peaks down (the mix keeps its dynamics),
 * else loudnorm working from the measurement. */
async function measure(ffmpeg:string,path:string,signal:AbortSignal|undefined,truePeak:number){
 const {integrated:I,range:LRA}=EXPORT_LOUDNESS;
 const measured=measuredLoudness(await ffmpegLog(ffmpeg,['-hide_banner','-nostats','-i',path,'-vn','-af','ebur128=peak=true:framelog=quiet','-f','null','-'],signal));
 if(!measured||measured.integrated<-60)return;
 const gain=I-measured.integrated,matches=Math.abs(gain)<.5&&measured.truePeak<=EXPORT_LOUDNESS.truePeak;
 const filter=measured.truePeak+gain<=truePeak?`volume=${gain.toFixed(2)}dB`:`loudnorm=I=${I}:TP=${truePeak}:LRA=${LRA}:measured_I=${measured.integrated}:measured_TP=${measured.truePeak}:measured_LRA=${measured.range}:measured_thresh=${measured.threshold}:linear=true`;
 return{level:measured.integrated,matches,filter};
}

/** Brings an exported video's sound to the standard level in two passes. The picture is copied untouched. Silent or already
 * matching files are left as they are. */
export async function normalizeLoudness(ffmpeg:string,path:string,signal?:AbortSignal):Promise<{changed:boolean;measuredLufs?:number}>{
 const measured=await measure(ffmpeg,path,signal,EXPORT_LOUDNESS.truePeak);
 if(!measured)return{changed:false};if(measured.matches)return{changed:false,measuredLufs:measured.level};
 const output=path+'.loudness.mp4';
 try{
  await ffmpegLog(ffmpeg,['-hide_banner','-nostats','-y','-i',path,'-map','0:v?','-map','0:a','-c:v','copy','-af',measured.filter,'-ar','48000',...await aacArgs(ffmpeg),'-movflags','+faststart',output],signal);
  renameSync(output,path);return{changed:true,measuredLufs:measured.level};
 }finally{if(existsSync(output))unlinkSync(output);}
}

/** Encodes a finished mix to AAC at the standard level in one go, so an export's sound is encoded once: peaks are kept half
 * a decibel further down, for what AAC adds to them, and normalizeLoudness then finds the file already matching. */
export async function encodeAtLoudness(ffmpeg:string,mix:string,output:string,signal?:AbortSignal,codec?:string[]){
 const measured=await measure(ffmpeg,mix,signal,EXPORT_LOUDNESS.truePeak-.5);
 await ffmpegLog(ffmpeg,['-hide_banner','-nostats','-y','-i',mix,...(measured?['-af',measured.filter]:[]),'-ar','48000',...(codec??await aacArgs(ffmpeg)),output],signal);
}
