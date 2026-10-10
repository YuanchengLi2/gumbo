import {estimateTokens} from '../../packages/orchestrator/src/context-budget';
import {AssetSchema} from '@dream/footage';
import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/legacy-director';

it('runs a long turn through HTTP, compaction, a transient retry and a saved budget checkpoint without duplicating edits',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-long-turn-')),'Long turn');let calls=0,overloaded=false,sawCompaction=false;const ids=new Set<string>();
 db.saveAsset(AssetSchema.parse({id:'source',filename:'fixture.mp4',kind:'video',durationSec:6,originalPath:'fixture.mp4',fingerprint:'fixture'}));db.apply([{type:'insert_clip',position:0,clip:{id:'clip',assetId:'source',srcIn:0,srcOut:6,speed:1,audio:{gainDb:0,fadeInSec:0,fadeOutSec:0,mute:false},reason:'Fixture'},reason:'Fixture'}],'Fixture','fixture',db.head());
 const initialVersions=db.state().versions.length;
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const body=JSON.parse(Buffer.concat(chunks).toString());
  if(req.url?.endsWith('/count-tokens')){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({input_tokens:estimateTokens({system:body.system,messages:body.messages,tools:body.tools})}));return;}
  expect(ids.has(body.requestId)).toBe(false);ids.add(body.requestId);
  if(!overloaded){overloaded=true;res.writeHead(529,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Temporary overload',dream_request:{status:'failed',retryable:true,retryAfterMs:500}}));return;}
  let content:any[];
  if(body.tools.some((t:any)=>t.name==='select_route'))content=[{type:'tool_use',id:'route',name:'select_route',input:{route:'local'}}];
  else{
   calls++;sawCompaction||=JSON.stringify(body.messages).includes('Older tool exchanges were compacted');
   expect(JSON.stringify(body.messages)).toContain('Preserve the original voice');
   for(let n=0;n<body.messages.length;n++)if(body.messages[n].role==='assistant')for(const block of body.messages[n].content)if(block.type==='tool_use')expect(body.messages[n+1].content.some((r:any)=>r.tool_use_id===block.id)).toBe(true);
   content=calls<=25?[
    {type:'thinking',thinking:'fixture signed block',signature:`signature-${calls}`},
    {type:'tool_use',id:`edit-${calls}`,name:'apply_ops',input:{label:`Step ${calls}`,ops:[{type:'set_project_settings',settings:{fps:calls%2?60:30},reason:'Protocol stress fixture'}]}},
    {type:'tool_use',id:`preview-${calls}`,name:'preview_frames',input:{frames:[0,1]}}
   ]:[{type:'tool_use',id:'done',name:'report',input:{status:'complete',summary:'All requested steps saved.',evidence:[{toolCallId:'edit-25',finding:'Last settings batch committed.'}]}}];
  }
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({content,stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as {port:number}).port;
 const director=new Director(db,async()=>({url:`http://127.0.0.1:${port}`,token:'fixture'}),()=>{},async request=>({versionId:request.versionId,frames:request.frames.map(f=>({...f,mimeType:'image/jpeg',data:'a'.repeat(160000),sha256:'a'.repeat(64)}))}));
 try{
  await director.message('Perform the requested calibration sequence. Preserve the original voice.');expect(db.state().aiStatus).toBe('interrupted');expect(calls).toBe(20);expect(db.state().versions).toHaveLength(initialVersions+20);
  await director.resume();expect(db.state().aiStatus).toBe('complete');expect(calls).toBe(26);expect(sawCompaction).toBe(true);expect(db.state().versions).toHaveLength(initialVersions+25);expect(db.timeline().settings.fps).toBe(60);db.undo();expect(db.timeline().settings.fps).toBe(30);db.undo(true);expect(db.timeline().settings.fps).toBe(60);
 }finally{db.close();await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});}
},60000);
