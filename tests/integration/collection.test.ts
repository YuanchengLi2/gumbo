import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,renameSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {collectProject} from '../../apps/project-service/src/collect';

it('collects linked originals into a portable backup that survives moving the source project',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-collect-test-')),folder=join(root,'source'),destination=join(root,'portable'),original=join(root,'linked.wav');writeFileSync(original,'source bytes');
 const db=new ProjectDB(folder,'Source');
 db.saveAsset(AssetSchema.parse({id:'audio',filename:'linked.wav',originalPath:original,kind:'audio',durationSec:5,fingerprint:'fixture'}));
 db.apply([{type:'insert_clip',position:0,clip:{id:'clip',assetId:'audio',srcIn:0,srcOut:5,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:false},reason:'fixture'},reason:'fixture'}],'Clip','request',db.head());
 const head=db.head();await collectProject(db,destination);db.close();renameSync(folder,join(root,'moved-source'));renameSync(original,join(root,'moved-original.wav'));
 const portable=new ProjectDB(destination);try{expect(portable.head()).toBe(head);expect(portable.timeline().spine[0].assetId).toBe('audio');expect(readFileSync(portable.footage().assets[0].originalPath,'utf8')).toBe('source bytes');expect(portable.state().canUndo).toBe(true);}finally{portable.close();}
});

it('does not publish a partial collected project when an original is missing',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-collect-fail-')),destination=join(root,'portable'),db=new ProjectDB(join(root,'source'),'Missing');
 try{db.saveAsset(AssetSchema.parse({id:'missing',filename:'missing.mp4',originalPath:join(root,'missing.mp4'),kind:'video',durationSec:5,fingerprint:'fixture'}));await expect(collectProject(db,destination)).rejects.toThrow('Relink');expect(existsSync(destination)).toBe(false);expect(readdirSync(root).some(name=>name.startsWith('.dream-collect-'))).toBe(false);}finally{db.close();}
});
