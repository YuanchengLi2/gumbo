import {MEDIA} from '@dream/config';
import {resolve} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';

/** What a share link shows beside the video (gateway share.ts, usegumbo.app/s/): the requests that made the edit, in
 * order, and what it was made from (the footage's length, how many clips, and a still of a few of them, small JPEGs). */
export type ShareStory={prompts:string[];source:{clips:number;durationSec:number;stills:string[]};durationSec:number};
const STILLS=6,WIDTH=240;

/** A clip's thumbnail as a small JPEG data address, or nothing when it has none or cannot be read. */
async function still(assetId:string){
 try{const response=await fetch(`${MEDIA}${assetId}/thumbnail`);if(!response.ok)return null;const bitmap=await createImageBitmap(await response.blob());
  const height=Math.max(1,Math.round(bitmap.height*WIDTH/bitmap.width)),canvas=new OffscreenCanvas(WIDTH,height);canvas.getContext('2d')!.drawImage(bitmap,0,0,WIDTH,height);bitmap.close();
  const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.72});
  return await new Promise<string>((done,fail)=>{const reader=new FileReader();reader.onload=()=>done(String(reader.result));reader.onerror=()=>fail(reader.error);reader.readAsDataURL(blob);});}
 catch{return null;}
}

export async function shareStory(project:ProjectState):Promise<ShareStory>{
 const prompts=project.messages.filter(m=>m.role==='user'&&m.text.trim()).map(m=>m.text.trim()).slice(0,8);
 const videos=project.footage.assets.filter(a=>a.kind==='video'&&!a.scene&&!a.missing);
 const stills=(await Promise.all(videos.filter(a=>a.thumbnailPath).slice(0,STILLS).map(a=>still(a.id)))).filter((s):s is string=>!!s);
 return{prompts,source:{clips:videos.length,durationSec:videos.reduce((n,a)=>n+(a.durationSec||0),0),stills},durationSec:resolve(project.timeline,project.footage).durationSec};
}
