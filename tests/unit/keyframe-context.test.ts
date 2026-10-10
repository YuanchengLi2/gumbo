import {it,expect} from 'vitest';
import {AssetSchema} from '@dream/footage';
import {initialMediaContext} from '../../packages/orchestrator/src/media-context';

it('requests context across the full source and preserves real speech evidence without waiting for a scan',async()=>{
 const requests:any[]=[],asset=AssetSchema.parse({id:'long',filename:'Interview.mp4',kind:'video',durationSec:3600,hasAudio:true,originalPath:'source',fingerprint:'source'});
 const db:any={getMeta:(key:string)=>key==='pending_request'?JSON.stringify({assetIds:['long']}):null,footage:()=>({assets:[asset]}),timeline:()=>({spine:[]}),db:{prepare:(sql:string)=>sql.includes("kind='words'")?{all:()=>[{json:JSON.stringify({start:300,end:301,text:'Actual speech'})}]}:{get:()=>({status:'complete'})}},inspectSource:async(request:any)=>{requests.push(request);return{assetId:asset.id,startSec:0,endSec:3600,frames:[{timeSec:1800,sha256:'hash',data:'frame',mimeType:'image/jpeg'}],coverage:'sampled'};}};
 const blocks=await initialMediaContext(db,'turn');expect(requests).toEqual([{assetId:'long',startSec:0,endSec:3600,detail:'preview'}]);expect(blocks.some(b=>b.type==='image')).toBe(true);expect(JSON.stringify(blocks)).toContain('Actual speech');expect(JSON.stringify(blocks)).toContain('300');
});
