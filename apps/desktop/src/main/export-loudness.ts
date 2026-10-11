import {spawn} from 'node:child_process';
import {existsSync,renameSync,unlinkSync} from 'node:fs';

/** Online video loudness: -14 LUFS integrated with true peaks below -1.5 dBTP. */
export const EXPORT_LOUDNESS={integrated:-14,truePeak:-1.5,range:11};
type Measured={input_i:string;input_tp:string;input_lra:string;input_thresh:string;target_offset:string};

function ffmpegLog(ffmpeg:string,args:string[],signal?:AbortSignal){return new Promise<string>((resolve,reject)=>{const child=spawn(ffmpeg,args,{windowsHide:true,signal});let log='';child.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-20000);});child.on('error',reject);child.on('close',code=>code===0?resolve(log):reject(new Error('Loudness normalization failed: '+log.slice(-800))));});}
/** The JSON block loudnorm prints after a measuring pass. */
export function measuredLoudness(log:string):Measured|undefined{const start=log.lastIndexOf('{'),end=log.lastIndexOf('}');if(start<0||end<start)return;try{const value=JSON.parse(log.slice(start,end+1));return typeof value.input_i==='string'?value:undefined;}catch{return;}}

/** Brings an exported video's sound to the standard level in two passes (measure, then a linear gain with a true-peak
 * limit, so the mix keeps its dynamics). The picture is copied untouched. Silent or already matching files are left as they are. */
export async function normalizeLoudness(ffmpeg:string,path:string,signal?:AbortSignal):Promise<{changed:boolean;measuredLufs?:number}>{
 const {integrated:I,truePeak:TP,range:LRA}=EXPORT_LOUDNESS,filter=`loudnorm=I=${I}:TP=${TP}:LRA=${LRA}`;
 const measured=measuredLoudness(await ffmpegLog(ffmpeg,['-hide_banner','-nostats','-i',path,'-vn','-af',filter+':print_format=json','-f','null','-'],signal));
 const level=Number(measured?.input_i),peak=Number(measured?.input_tp);
 if(!measured||!Number.isFinite(level)||level<-60)return{changed:false};
 if(Math.abs(level-I)<.5&&peak<=TP)return{changed:false,measuredLufs:level};
 const output=path+'.loudness.mp4';
 try{
  await ffmpegLog(ffmpeg,['-hide_banner','-nostats','-y','-i',path,'-map','0:v?','-map','0:a','-c:v','copy','-af',`${filter}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`,'-ar','48000','-c:a','aac','-b:a','256k','-movflags','+faststart',output],signal);
  renameSync(output,path);return{changed:true,measuredLufs:level};
 }finally{if(existsSync(output))unlinkSync(output);}
}
