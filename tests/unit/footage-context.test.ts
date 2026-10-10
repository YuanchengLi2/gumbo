import {it,expect} from 'vitest';
import {assetCatalog,readFootage,emptyFootage,AssetSchema} from '@dream/footage';
import {reviewPacket} from '../../packages/orchestrator/src/review-packet';
import {emptyTimeline,ClipSchema} from '@dream/timeline';

it('keeps four hours of transcript out of routine prompts while retaining exact late-source paging',()=>{
 const f=emptyFootage();f.assets=['a','b'].map(id=>AssetSchema.parse({id,filename:id+'.mp4',kind:'video',durationSec:7200,originalPath:'C:/private/'+id+'.mp4',fingerprint:id}));
 f.words=Array.from({length:86400},(_,n)=>({id:`w${n}`,assetId:n<43200?'a':'b',text:`word${n}`,start:(n%43200)/6,end:(n%43200+.8)/6,confidence:1,speaker:'unknown',pauseBefore:0}));
 const catalog=assetCatalog(f);expect(JSON.stringify(catalog).length).toBeLessThan(10_000);expect(catalog.assets.map(a=>a.wordCount)).toEqual([43200,43200]);expect(JSON.stringify(catalog)).not.toContain('C:/private');
 const page=readFootage(f,{assetId:'b',startSec:7000,endSec:7060,offset:150,limit:150});
 expect(page.words).toHaveLength(150);expect(page.words[0].start).toBe(7025);expect(page.nextOffset).toBe(300);expect(page.totalWords).toBe(360);
 const t=emptyTimeline('p');t.spine=[ClipSchema.parse({id:'clip',assetId:'b',srcIn:7000,srcOut:7060,reason:'Late highlight'})];
 const packet=reviewPacket('v',t,f);expect(packet.request.footage.assets.map(a=>a.id)).toEqual(['b']);expect(packet.request.footage.words).toHaveLength(360);expect(packet.evidence.transcript[0].start).toBe(0);
});
