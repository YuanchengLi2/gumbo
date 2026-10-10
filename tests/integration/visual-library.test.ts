import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ProjectDB} from '@dream/project-db';
import {VisualLibrary} from '../../apps/project-service/src/visual-library';
import {collectProject} from '../../apps/project-service/src/collect';
import {mediaAssetPath} from '../../apps/desktop/src/main/media-paths';
import {renderServer} from '../../apps/desktop/src/main/render-server';
import {VisualDefinitionSchema,type VisualRenderer} from '@dream/contracts';
import {sequenceFrame} from '@dream/timeline';

it('persists frame sequences, serves bounded frame URLs and collects immutable revisions with undo',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-visual-library-')),folder=join(root,'project'),cache=join(root,'cache');mkdirSync(cache);
 const frames=[0,1,2].map(frame=>{const bytes=Buffer.from(`frame ${frame}`);writeFileSync(join(cache,`${String(frame).padStart(6,'0')}.png`),bytes);return{frame,sha256:createHash('sha256').update(bytes).digest('hex')};});
 const definition=VisualDefinitionSchema.parse({schemaVersion:1,id:'scene',title:'Scene',code:'export default function Scene(){return null;}',parameterSchema:{},parameters:{},width:320,height:180,fps:30,durationInFrames:3,seed:1});
 const renderer:VisualRenderer=async request=>({cacheHit:false,directory:cache,manifest:{revisionId:createHash('sha256').update(JSON.stringify(request.definition)).digest('hex'),runtimeVersion:'test',width:320,height:180,fps:30,durationInFrames:3,frames,stills:[0,1,1,2].map(frame=>({frame,mimeType:'image/png',base64:Buffer.from(`frame ${frame}`).toString('base64')}))}});
 let db=new ProjectDB(folder,'Visuals'),library=new VisualLibrary(db,renderer,()=>{});try{
  const command={type:'create_visual' as const,definition,start:{kind:'project' as const,at:'start' as const,offsetSec:0},placement:'spine' as const,requestId:'first',expectedVersionId:db.head()};const first=await library.generate(command,'turn-first');expect(first.placed).toBe(true);expect(db.timeline().spine[0].assetId).toBe(first.assetId);
  const asset=db.footage().assets[0];expect(readFileSync(mediaAssetPath(asset,'preview','2'),'utf8')).toBe('frame 2');for(const invalid of ['../0','-1','3','1.5','Infinity'])expect(()=>mediaAssetPath(asset,'preview',invalid)).toThrow();
  const server=await renderServer(new Map([[asset.id,asset]]));try{expect(await(await fetch(server.media[asset.id]+'?frame=1')).text()).toBe('frame 1');expect((await fetch(server.media[asset.id]+'?frame=99')).status).toBe(404);}finally{await server.close();}
  const count=db.state().versions.length;expect(await library.generate(command,'turn-first')).toEqual(first);expect(db.state().versions).toHaveLength(count);
  const second=await library.generate({...command,definition:{...definition,title:'Revised'},requestId:'second',expectedVersionId:db.head(),replaceItemId:first.itemId},'turn-second');expect(second.revisionId).not.toBe(first.revisionId);expect(db.timeline(first.versionId).spine[0].assetId).toBe(first.assetId);
  const collected=join(root,'collected');await collectProject(db,collected);await library.close();db.close();renameSync(folder,join(root,'moved-original'));
  db=new ProjectDB(collected);library=new VisualLibrary(db,renderer,()=>{});expect(library.list()).toHaveLength(2);expect(readFileSync(mediaAssetPath(db.footage().assets.find(a=>a.id===second.assetId)!,'preview','1'),'utf8')).toBe('frame 1');db.undo();expect(db.timeline().spine[0].assetId).toBe(first.assetId);db.undo(true);expect(db.timeline().spine[0].assetId).toBe(second.assetId);
 }finally{await library.close();db.close();}
});

it('uses shared source-frame timing for trim, speed and project/source fps differences',()=>{
 expect(sequenceFrame(.1,30,12)).toBe(3);expect(sequenceFrame(.1+7/60*2,30,12)).toBe(10);expect(sequenceFrame(100,30,12)).toBe(11);expect(sequenceFrame(-1,30,12)).toBe(0);
});
