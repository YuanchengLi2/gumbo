import {createWriteStream,existsSync,mkdirSync,readdirSync,renameSync,unlinkSync} from 'node:fs';
import {join,extname} from 'node:path';
import {createHash} from 'node:crypto';

/** A result of the online media search (see the gateway's media-search.ts), saved per project so an import of online:<id>
 * downloads exactly what was found, with its license, and never a link the model typed. */
export type OnlineMedia={id:string;kind:'audio'|'video'|'image';title:string;creator?:string;license:string;licenseUrl?:string;attribution?:string;source:string;page:string;download:string;durationSec?:number};
const types:Record<string,string>={'audio/mpeg':'.mp3','audio/mp3':'.mp3','audio/ogg':'.ogg','audio/wav':'.wav','audio/x-wav':'.wav','audio/flac':'.flac','audio/mp4':'.m4a','video/mp4':'.mp4','video/webm':'.webm','video/ogg':'.ogv','video/quicktime':'.mov','image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp'};
const media=/\.(mp3|ogg|oga|wav|flac|m4a|mp4|webm|ogv|mov|jpe?g|png|webp)$/i;

/** Downloads one found file into the project's Media/Downloaded folder (once: a second import reuses it), checking that it is
 * media and not over 1.5 GB. Returns its path. */
export async function downloadMedia(item:OnlineMedia,folder:string,signal:AbortSignal,fetcher:typeof fetch=fetch,maxBytes=1_500_000_000){
 if(!/^https:\/\//.test(item.download))throw new Error('Only https downloads are allowed.');
 mkdirSync(folder,{recursive:true});
 const base=(item.title.replace(/[^\p{L}\p{N} _-]+/gu,' ').replace(/\s+/g,' ').trim().slice(0,60)||'media')+' - '+createHash('sha256').update(item.id).digest('hex').slice(0,8);
 const done=readdirSync(folder).find(name=>name.startsWith(base+'.')&&!name.endsWith('.partial'));if(done)return join(folder,done);
 const response=await fetcher(item.download,{redirect:'follow',headers:{'User-Agent':'Figjam/1.0 (video editor)'},signal:AbortSignal.any([signal,AbortSignal.timeout(600_000)])});
 if(!response.ok||!response.body)throw new Error(`The download failed (${response.status}).`);
 const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase(),path=new URL(response.url||item.download).pathname;
 if(!/^(audio|video|image)\//.test(type)&&!media.test(path))throw new Error(`That link is not a media file (${type||'unknown type'}).`);
 const target=join(folder,base+(types[type]??(media.test(path)?extname(path).toLowerCase():'.bin'))),partial=target+'.partial';
 const out=createWriteStream(partial),reader=response.body.getReader();let size=0;
 try{
  for(;;){const {done:end,value}=await reader.read();if(end)break;size+=value.length;if(size>maxBytes)throw new Error('The file is larger than 1.5 GB.');if(!out.write(value))await new Promise<void>(resolve=>out.once('drain',()=>resolve()));}
  await new Promise<void>((resolve,reject)=>out.end((error?:Error|null)=>error?reject(error):resolve()));
 }catch(error){out.destroy();try{if(existsSync(partial))unlinkSync(partial);}catch{}throw error;}
 renameSync(partial,target);return target;
}
