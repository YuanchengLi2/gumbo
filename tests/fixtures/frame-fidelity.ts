import {spawnSync} from 'node:child_process';

/** Compare decoded RGB pixels at the same source time, independent of container/compression bytes. */
export function frameDifference(ffmpeg:string,reference:string,actual:string,seconds=0){
 const decode=(path:string)=>{const result=spawnSync(ffmpeg,['-v','error',...(seconds>0?['-ss',String(seconds)]:[]),'-i',path,'-frames:v','1','-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{windowsHide:true,maxBuffer:2_000_000});if(result.status!==0||result.stdout.length!==320*180*3)throw new Error(`Could not decode comparison frame: ${result.stderr.toString().slice(-500)}`);return result.stdout;};
 const a=decode(reference),b=decode(actual);let sum=0;for(let i=0;i<a.length;i++)sum+=Math.abs(a[i]-b[i]);return sum/a.length;
}
