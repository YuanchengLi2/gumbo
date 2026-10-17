import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {canPreviewAudio} from '../../../project-service/src/media-io';
import type {Asset} from '@dream/footage';
/** Registry-owned assets only. A sequence URL selects a bounded numeric frame, never a path. */
export function mediaAssetPath(asset:Asset,variant='preview',frame:string|null=null){
 let path:string|undefined;
 if(frame!==null){if(!asset.sequence||!/^\d{1,8}$/.test(frame)||Number(frame)>=asset.sequence.frameCount)throw new Error('Frame is outside this generated visual.');path=join(asset.sequence.directory,`${String(Number(frame)).padStart(6,'0')}.png`);}
 else path=variant==='thumbnail'?asset.thumbnailPath??(asset.sequence?asset.originalPath:undefined):variant==='original'?asset.originalPath:variant==='audio'?(asset.audioPath&&existsSync(asset.audioPath)?asset.audioPath:canPreviewAudio(asset)?asset.originalPath:asset.proxyPath):variant==='play'&&asset.previewPath&&existsSync(asset.previewPath)?asset.previewPath:asset.proxyPath??asset.originalPath;
 if(!path||!existsSync(path))throw new Error('Media is missing. Relink its source or regenerate the visual.');return path;
}
