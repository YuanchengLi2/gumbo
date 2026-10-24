/** What a share link shows besides the video (usegumbo.app/s/): the prompts that made the edit and what it was made from,
 * the footage's length, how many clips and a few small stills. Kept small and plain: a handful of prompts of a
 * thousand characters, six JPEG stills of at most 60 KB as data addresses, and numbers. */
export type ShareStory={prompts:string[];source:{clips:number;durationSec:number;stills:string[]}|null;durationSec:number|null};
const STILL=/^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/;
const seconds=(v:unknown)=>{const n=Number(v);return Number.isFinite(n)&&n>=0&&n<1e6?Math.round(n*100)/100:null;};
export function shareStory(body:any):ShareStory{
 const prompts=(Array.isArray(body?.prompts)?body.prompts:[]).filter((p:unknown)=>typeof p==='string'&&p.trim()).slice(0,8).map((p:string)=>p.trim().slice(0,1000));
 const s=body?.source,stills=(Array.isArray(s?.stills)?s.stills:[]).filter((v:unknown)=>typeof v==='string'&&v.length<=80_000&&STILL.test(v)).slice(0,6);
 const clips=Math.max(0,Math.min(10_000,Math.floor(Number(s?.clips)||0))),durationSec=seconds(s?.durationSec);
 return{prompts,source:s&&typeof s==='object'&&durationSec!==null?{clips,durationSec,stills}:null,durationSec:seconds(body?.durationSec)};
}
