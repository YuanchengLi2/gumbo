import {z} from 'zod';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
/** The export window's choices, as in CapCut: a name and folder, the video (resolution, bit rate, codec, format, frame
 * rate) and the sound as its own file. The video is drawn and encoded at these settings in one pass. */
export const ExportSettingsSchema=z.object({
 name:z.string().max(120).default(''),folder:z.string().max(1000).optional(),
 video:z.boolean().default(true),resolution:z.enum(['source','480','720','1080','1440','2160']).default('source'),
 quality:z.enum(['lower','recommended','higher']).default('recommended'),codec:z.enum(['h264','hevc']).default('h264'),
 format:z.enum(['mp4','mov']).default('mp4'),fps:z.union([z.literal('source'),z.literal(24),z.literal(25),z.literal(30),z.literal(50),z.literal(60)]).default('source'),
 audio:z.boolean().default(false),audioFormat:z.enum(['mp3','wav','aac']).default('mp3')
}).refine(s=>s.video||s.audio,'Choose video, audio or both to export.');
export type ExportSettings=z.infer<typeof ExportSettingsSchema>;

export const safeName=(name:string)=>name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').trim().slice(0,100)||'Figjam video';
/** name.ext in the folder, or "name (2).ext" and so on when that file exists, so an export never overwrites another. */
export function exportPath(folder:string,name:string,extension:string,exists=existsSync){
 const base=safeName(name);for(let n=1;;n++){const path=join(folder,`${base}${n>1?` (${n})`:''}.${extension}`);if(!exists(path))return path;}
}
/** The frame for a resolution: the short side becomes the chosen height (1080 for 1080p), both sides even, never larger
 * than the project's own frame. */
export function outputSize(settings:Pick<ExportSettings,'resolution'>,width:number,height:number){
 if(settings.resolution==='source')return{width,height};
 const short=Math.min(width,height),k=Math.min(short,Number(settings.resolution))/short,even=(v:number)=>Math.max(2,Math.round(v*k/2)*2);
 return{width:even(width),height:even(height)};
}
export const audioExtension=(s:Pick<ExportSettings,'audioFormat'>)=>s.audioFormat==='aac'?'m4a':s.audioFormat;
