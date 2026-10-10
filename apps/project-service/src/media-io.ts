import {createReadStream,createWriteStream,existsSync} from 'node:fs';
import {rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {extname} from 'node:path';
import type {Asset} from '@dream/footage';

/** Copy and checksum in one pass; a canceled import never publishes partial media. */
export async function copyMedia(source:string,destination:string,signal?:AbortSignal){
 const temporary=destination+'.'+randomUUID()+'.copying',hash=createHash('sha256');
 try{
  await pipeline(createReadStream(source),new Transform({transform(chunk,_encoding,callback){hash.update(chunk);callback(null,chunk);}}),createWriteStream(temporary,{flags:'wx'}),{signal});
  signal?.throwIfAborted();await rename(temporary,destination);return hash.digest('hex');
 }finally{if(existsSync(temporary))await unlink(temporary);}
}

export function canPreviewOriginal(asset:Pick<Asset,'kind'|'originalPath'|'videoCodec'>){
 if(asset.kind!=='video')return true;
 const extension=extname(asset.originalPath).toLowerCase();
 return ['.mp4','.m4v','.mov','.webm'].includes(extension)&&['h264','vp8','vp9','av1'].includes(asset.videoCodec??'');
}

export function canPreviewAudio(asset:Pick<Asset,'hasAudio'|'audioCodec'|'originalPath'>){
 if(!asset.hasAudio)return true;
 if(asset.audioCodec)return ['aac','mp3','opus','vorbis','flac','pcm_s16le','pcm_s24le','pcm_f32le'].includes(asset.audioCodec);
 return ['.mp3','.wav','.m4a','.aac','.flac','.ogg'].includes(extname(asset.originalPath).toLowerCase());
}
export function playbackCapabilities(asset:Asset):NonNullable<Asset['playback']>{
 const audio=asset.hasAudio?(asset.audioPath&&existsSync(asset.audioPath)?'normalized':canPreviewAudio(asset)?'original':asset.proxyPath&&existsSync(asset.proxyPath)?'proxy':undefined):'none';
 const video=asset.kind==='video'?(asset.proxyPath&&existsSync(asset.proxyPath)?'proxy':canPreviewOriginal(asset)?'original':'proxy'):undefined;
 return {video,audio,audioReady:!!audio,ready:(asset.kind!=='video'||video==='original'||!!asset.proxyPath&&existsSync(asset.proxyPath))&&!!audio};
}
