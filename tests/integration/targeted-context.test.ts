import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {ProjectContext} from '../../packages/orchestrator/src/context';
function fixture(count=1){const folder=mkdtempSync(join(tmpdir(),'dream-retrieval-')),db=new ProjectDB(folder,'Retrieval');db.saveAsset(AssetSchema.parse({id:'a',filename:'Product footage',kind:'video',durationSec:600,originalPath:'C:/private/source.mp4',fingerprint:'source',status:'ready'}));for(let offset=0;offset<count;offset+=50)db.apply(Array.from({length:Math.min(50,count-offset)},(_,n)=>({type:'insert_clip' as const,position:offset+n,clip:{id:`c${offset+n}`,assetId:'a',srcIn:offset+n,srcOut:offset+n+1,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:false},reason:offset+n===count-1?'Amethyst ending':'Opening product scene'},reason:'Fixture'})),'Fixture',`fixture-${offset}`,db.head());return{folder,db};}
it('retrieves late project records without sending a large timeline and invalidates changed chunks after reopening',()=>{
 const f=fixture(200);let db=f.db;try{
  const context=new ProjectContext(db),packet=JSON.stringify(context.initial('Refine the amethyst ending',['c199']));expect(packet.length).toBeLessThan(19000);expect(packet).toContain('c199');expect(packet).not.toContain('C:/private');expect(packet).not.toContain('"c100"');
  const matches=context.search('amethyst');expect(matches.some(m=>m.owner==='c199')).toBe(true);expect(context.read('clip:c199:0')).toMatchObject({owner:'c199'});
  const page=context.page({section:'timeline',offset:190,limit:6}) as any;expect(page.items).toHaveLength(6);expect(page.nextOffset).toBe(196);expect(page.total).toBe(200);
  const count=db.db.prepare('SELECT COUNT(*) AS n FROM context_chunks').get();context.initial('Again');expect(db.db.prepare('SELECT COUNT(*) AS n FROM context_chunks').get()).toEqual(count);
  db.apply([{type:'delete_clips',clipIds:['c199'],reason:'Remove ending'}],'Remove','delete',db.head());db.close();db=new ProjectDB(f.folder);expect(new ProjectContext(db).search('amethyst')).toEqual([]);expect(()=>new ProjectContext(db).read('clip:c199:0')).toThrow('not found');
 }finally{db.close();}
});
