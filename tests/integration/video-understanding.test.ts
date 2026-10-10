import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import ffmpeg from 'ffmpeg-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema,validateObservation,type SourceInspector} from '@dream/footage';
import {sourceInspector,frameTimes} from '../../apps/project-service/src/source-frames';
import {VideoUnderstanding} from '../../apps/project-service/src/video-understanding';
import {executeFootageTool,footageResultContent} from '../../packages/orchestrator/src/footage-tools';
import {ProjectContext} from '../../packages/orchestrator/src/context';

const asset=AssetSchema.parse({id:'source',filename:'sequence.mp4',kind:'video',durationSec:12,fps:30,originalPath:resolve('artifacts/fixtures/source.mp4'),fingerprint:'fixture',status:'ready'});
const inspect:SourceInspector=async request=>({assetId:request.assetId,fingerprint:'fixture',startSec:request.startSec,endSec:request.endSec,sampleIntervalSec:.5,frames:frameTimes(request.startSec,request.endSec,30,request.detail).map(timeSec=>({timeSec,sha256:'a'.repeat(64),data:'dGVzdA==',mimeType:'image/jpeg'})),coverage:'Sampled test evidence'});
function report(evidence:any,refine=false){return{summary:'A red block moves right, then disappears.',events:[{startSec:evidence.startSec,endSec:evidence.endSec,description:'The red block changes position toward the right.',subjects:[],objects:['red block'],visibleText:[],evidenceFrames:[evidence.evidence[0].timeSec,evidence.evidence.at(-1).timeSec],confidence:'medium',uncertainty:'Movement between sampled frames is not fully observed.'}],scene:{framing:'Wide',cameraMotion:'Static',tags:['red block','movement'],energy:'medium',usableAsBroll:true},continuity:'A red block is visible against the background.',inspectMore:refine?[{startSec:evidence.startSec,endSec:evidence.startSec+1,question:'Check the direction of movement.'}]:[]};}

it('decodes ordered source images outside the timeline and exposes actual image tool blocks',async()=>{
 expect(frameTimes(2.5,3,30,'motion',false,9).at(-1)).toBe(3);expect(frameTimes(8,9,30,'motion',false,9).at(-1)).toBeLessThan(9);
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-source-frames-')),'Frames');try{
  db.saveAsset({...asset,durationSec:6});db.inspectSource=sourceInspector(db,ffmpeg!);
  const frames=await executeFootageTool(db,'inspect_footage',{assetId:'source',startSec:0,endSec:1,detail:'motion'}) as Awaited<ReturnType<SourceInspector>>;
  expect(frames.frames.length).toBeGreaterThan(2);expect(new Set(frames.frames.map(f=>f.sha256)).size).toBeGreaterThan(1);expect(frames.frames[0].data.startsWith('/9j/')).toBe(true);expect(db.timeline().spine).toHaveLength(0);
  const content=footageResultContent('inspect_footage',frames) as any[];expect(content.filter(b=>b.type==='image')).toHaveLength(frames.frames.length);expect(JSON.stringify(content)).not.toContain(asset.originalPath);
  const again=await db.inspectSource({assetId:'source',startSec:0,endSec:1,detail:'motion'});expect(again.frames.map(f=>f.sha256)).toEqual(frames.frames.map(f=>f.sha256));
 }finally{db.close();}
});

it('observes all windows, refines uncertain motion, indexes evidence and reuses saved analysis',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-understanding-')),'Understand');let requests=0;
 const observer=new VideoUnderstanding(db,{connect:async()=>({url:'http://fixture',token:'fixture'}),inspect,publish:()=>{},request:async(_url,init)=>{requests++;const input=JSON.parse(String(init?.body));if(input.tools.some((t:any)=>t.name==='submit_video_summary'))return Response.json({content:[{type:'tool_use',id:'summary',name:'submit_video_summary',input:{summary:'A red block moves right then disappears.',evidenceIds:JSON.parse(input.messages[0].content).records.map((r:any)=>r.id)}}],stop_reason:'tool_use',usage:{}});const meta=JSON.parse(input.messages[0].content[0].text),evidence=JSON.parse(input.messages[0].content[1].text);if(evidence.startSec>1)expect(meta.previousWindowContext).toContain('red block');return Response.json({content:[{type:'tool_use',id:'observation-'+requests,name:'submit_observation',input:report(evidence,requests===1)}],stop_reason:'tool_use',usage:{}});}});
 try{db.saveAsset(asset);observer.enqueue(asset);await observer.drain();expect(requests).toBe(4);expect(db.footage().assets[0].understanding).toMatchObject({status:'complete',observedThroughSec:12});expect(db.search('red block').some(r=>r.kind==='observations')).toBe(true);expect(new Set(new ProjectContext(db).search('red block',6,{kind:'observation'}).map(r=>r.owner)).size).toBe(2);
  const read=executeFootageTool(db,'read_footage',{assetId:'source',startSec:0,endSec:12}) as any;expect(read.observations).toHaveLength(2);expect(read.observations[0].refinements).toHaveLength(1);expect(read.observations[0].report.events[0].uncertainty).toContain('not fully');
  observer.enqueue(db.footage().assets[0],true);await observer.drain();expect(requests).toBe(4);
 }finally{await observer.close();db.close();}
});

it('preserves completed coverage through a persistent outage and resumes without repeating paid work',async()=>{
 // A single dropped connection is retried automatically; an outage that outlasts the retries interrupts the scan.
 const folder=mkdtempSync(join(tmpdir(),'dream-observer-resume-'));let db=new ProjectDB(folder,'Resume'),requests=0,generations=0,fail=true;
 const make=()=>new VideoUnderstanding(db,{connect:async()=>({url:'http://fixture',token:'fixture'}),inspect,publish:()=>{},request:async(url,init)=>{if(!String(url).endsWith('/ai'))return Response.json({dream_request:{status:'uncertain'}},{status:409});generations++;if(fail&&generations>=2)throw new Error('Disconnected');requests++;const input=JSON.parse(String(init?.body));if(input.tools.some((t:any)=>t.name==='submit_video_summary'))return Response.json({content:[{type:'tool_use',id:'summary',name:'submit_video_summary',input:{summary:'A red block moves right.',evidenceIds:JSON.parse(input.messages[0].content).records.map((r:any)=>r.id)}}],stop_reason:'tool_use',usage:{}});const evidence=JSON.parse(input.messages[0].content[1].text);return Response.json({content:[{type:'tool_use',id:'obs-'+requests,name:'submit_observation',input:report(evidence)}],stop_reason:'tool_use',usage:{}});}});
 let observer=make();try{db.saveAsset(asset);observer.enqueue(asset);await observer.drain();expect(db.footage().assets[0].understanding).toMatchObject({status:'interrupted',observedThroughSec:6});await observer.close();db.close();db=new ProjectDB(folder);observer=make();fail=false;observer.retry(asset.id);await observer.drain();expect(requests).toBe(3);expect(db.footage().assets[0].understanding?.status).toBe('complete');
 }finally{await observer.close();db.close();}
});

it('rejects invented visual evidence instead of indexing unsupported event times',async()=>{
 const frames=await inspect({assetId:'source',startSec:0,endSec:2,detail:'normal'});const value=report({...frames,evidence:frames.frames});value.events[0].evidenceFrames=[99];expect(()=>validateObservation(value,frames)).toThrow('outside');expect(frameTimes(0,2,30,'motion').length).toBeGreaterThan(frameTimes(0,2,30,'normal').length);
});

it('can retry a rejected whole-video summary without paying to repeat completed observations',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-summary-resume-')),'Summary');let observations=0,summaries=0;
 const observer=new VideoUnderstanding(db,{connect:async()=>({url:'http://fixture',token:'fixture'}),inspect,publish:()=>{},request:async(_url,init)=>{const input=JSON.parse(String(init?.body));if(input.tools.some((t:any)=>t.name==='submit_video_summary')){summaries++;return Response.json({content:[{type:'tool_use',id:'summary-'+summaries,name:'submit_video_summary',input:{summary:summaries===1?'':'A red block moves right.',evidenceIds:JSON.parse(input.messages[0].content).records.map((r:any)=>r.id)}}],stop_reason:'tool_use',usage:{}});}observations++;return Response.json({content:[{type:'tool_use',id:'observed',name:'submit_observation',input:report(JSON.parse(input.messages[0].content[1].text))}],stop_reason:'tool_use',usage:{}});}});
 try{const short={...asset,durationSec:6};db.saveAsset(short);observer.enqueue(short);await observer.drain();expect(db.footage().assets[0].understanding?.status).toBe('partial');observer.retry(asset.id);await observer.drain();expect(observations).toBe(1);expect(summaries).toBe(2);expect(db.footage().assets[0].understanding?.status).toBe('complete');}finally{await observer.close();db.close();}
});
