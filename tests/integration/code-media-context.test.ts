import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {inspectMedia} from '../../apps/project-service/src/media-evidence';

it('reuses the imported-video inspector without hashing or decoding the source again',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-code-context-')),db=new ProjectDB(root),source=join(root,'source.mp4');writeFileSync(source,'fixture: not decodable; the cached inspector must be used');
 try{db.saveAsset(AssetSchema.parse({id:'source',filename:'source.mp4',kind:'video',durationSec:120,fps:30,width:1920,height:1080,hasAudio:true,originalPath:source,fingerprint:'known-source',status:'ready'}));const inspect=vi.fn(async()=>({assetId:'source',fingerprint:'known-source',startSec:0,endSec:120,sampleIntervalSec:0,frames:[{timeSec:0,sha256:'fixture',data:'frame',mimeType:'image/jpeg' as const}],coverage:'Existing cached preview'}));db.inspectSource=inspect;
 const result=await inspectMedia(db,{assetId:'source'},'unavailable-ffmpeg','unavailable-ffprobe',new AbortController().signal);expect(inspect).toHaveBeenCalledWith({assetId:'source',startSec:0,endSec:120,detail:'preview'},expect.any(AbortSignal));expect(result.content.some(b=>b.type==='image')).toBe(true);expect(result.evidence.audio).toBeUndefined();expect(result.evidence.frames[0].timestamp).toBe(0);
 const original=db.footage().assets[0];db.saveAsset({...original,originalPath:join(root,'missing-original.mp4'),proxyPath:source,missing:true});expect((await inspectMedia(db,{assetId:'source'},'unavailable-ffmpeg','unavailable-ffprobe',new AbortController().signal)).evidence.path).toBe(source);
 }finally{db.close();}
});
