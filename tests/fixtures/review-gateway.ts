import {createServer} from 'node:http';

/** Protocol fixture only. Real provider evidence is recorded by scripts/smoke-ai.ts --review. */
export async function reviewGateway(planning=false,blockOnce=false,transientOnce=false,shortSession=false,streaming=false,moduleMode=false){
 let editorCalls=0,reviewFrames=0,failures=0,refreshes=0,streams=0;const usedTokens=new Set<string>();
 const server=createServer(async(req,res)=>{try{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));if(req.url?.endsWith('/transcribe')){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({words:[],segments:[]}));return;}const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};
  let result:unknown;
  if(req.url?.startsWith('/auth/v1/token')||req.url?.startsWith('/auth/v1/signup'))result={access_token:`local-protocol-fixture-${++refreshes}`,refresh_token:'local-protocol-refresh',expires_in:shortSession?1:3600,user:{id:'fixture-account',email:'local-fixture@example.invalid'}};
  else if(req.url?.endsWith('/account'))result={invited:true};
  else if(req.url?.endsWith('/ai')){
   if(shortSession){const token=String(req.headers.authorization);if(usedTokens.has(token)){res.writeHead(401,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Fixture token expired',dream_request:{status:'failed',retryable:false}}));return;}usedTokens.add(token);}
   if(transientOnce&&!failures){failures++;res.writeHead(529,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Temporary overload',dream_request:{status:'failed',retryable:true,retryAfterMs:500}}));return;}
   let content:unknown[];
   const draftResults=(body.messages??[]).flatMap((m:any)=>Array.isArray(m.content)?m.content:[]).filter((b:any)=>b.type==='tool_result').flatMap((b:any)=>typeof b.content==='string'?[b.content]:Array.isArray(b.content)?b.content.filter((v:any)=>v.type==='text').map((v:any)=>v.text):[]).flatMap((text:string)=>{try{const value=JSON.parse(text);return value?.definition?.source&&value.id?[value]:[];}catch{return[];}});
   const draft=draftResults.at(-1);

   if(body.tools?.some((t:any)=>t.name==='submit_video_summary'))content=[{type:'tool_use',id:'video-summary',name:'submit_video_summary',input:{summary:'A changing synthetic calibration pattern.',evidenceIds:JSON.parse(body.messages[0].content).records.map((r:any)=>r.id)}}];
   else if(body.tools?.some((t:any)=>t.name==='submit_observation')){const evidence=JSON.parse(body.messages[0].content[1].text);content=[{type:'tool_use',id:'observation',name:'submit_observation',input:{summary:'Synthetic color-pattern source.',events:[],scene:{framing:'Full-frame calibration pattern',cameraMotion:'None',tags:['calibration'],energy:'low',usableAsBroll:false},continuity:'Synthetic calibration footage',inspectMore:[]}}];}
   else if(body.tools?.some((t:any)=>t.name==='submit_plan'))content=[{type:'tool_use',id:'plan',name:'submit_plan',input:{schemaVersion:1,title:'Format plan',goal:'Prepare a square 60 fps edit',steps:[{id:'timing',title:'Set timing',instruction:'Set 60 fps',acceptance:'60 fps',review:false},{id:'square',title:'Set format',instruction:'Set square dimensions',acceptance:'1080 square',review:false}],assumptions:[]}}];
   else if(planning&&blockOnce&&editorCalls>=2&&body.tools?.some((t:any)=>t.name==='apply_ops')){content=[{type:'tool_use',id:'confirmed',name:'report',input:{status:'complete',summary:'Square format confirmed.',evidence:[{toolCallId:'edit-2',finding:'Square dimensions already committed.'}]}}];}
   else if(planning&&body.tools?.some((t:any)=>t.name==='apply_ops')){editorCalls++;content=[{type:'tool_use',id:`edit-${editorCalls}`,name:'apply_ops',input:{label:'Approved format step',ops:[{type:'set_project_settings',settings:editorCalls===1?{fps:60}:{width:1080,height:1080},reason:'Approved plan'}]}},{type:'tool_use',id:`done-${editorCalls}`,name:'report',input:{summary:'Approved step saved.',status:blockOnce&&editorCalls===2?'blocked':'complete',...(blockOnce&&editorCalls===2?{nextAction:'Confirm the square format before continuing.'}:{}),evidence:[{toolCallId:`edit-${editorCalls}`,finding:'Approved settings saved.'}]}}];}
   else if(body.tools?.some((t:any)=>t.name==='submit_review')){reviewFrames=body.messages[0].content.filter((c:any)=>c.type==='image').length;content=[{type:'tool_use',id:'review',name:'submit_review',input:{summary:'Fixture review inspected rendered evidence.',issues:[]}}];}
   else if(body.tools?.some((t:any)=>t.name==='apply_ops')){editorCalls++;content=editorCalls===1?[{type:'tool_use',id:'edit',name:'apply_ops',input:{label:'Balance clip',ops:[{type:'set_clip_audio',clipId:'c_acceptance',audio:{gainDb:-10},reason:'Protocol fixture'}]}}]:editorCalls===2?[{type:'tool_use',id:'music',name:'generate_music',input:{presetId:'score_01',durationSec:3}},{type:'tool_use',id:'sound',name:'generate_sfx',input:{presetId:'sfx_01',start:{kind:'clip',clipId:'c_acceptance',at:1,offsetSec:0}}}]:editorCalls===3?[{type:'tool_use',id:'visual',name:'create_visual',input:{definition:JSON.stringify({schemaVersion:1,id:'fixture-motion',title:'Fixture motion',code:"import React from 'react';import {AbsoluteFill,useCurrentFrame} from 'remotion';export default function Scene(){const frame=useCurrentFrame();return <AbsoluteFill><div style={{position:'absolute',left:frame*10,top:0,width:200,height:100,background:'#ff00ff'}}/></AbsoluteFill>}",parameterSchema:{type:'object'},parameters:{},width:1280,height:720,fps:30,durationInFrames:12,seed:1,assetIds:[],transparent:true}),start:{kind:'project',at:'start',offsetSec:.5},placement:'overlay'}}]:[{type:'tool_use',id:'report',name:'report',input:{summary:'Fixture edit saved.',status:'complete',evidence:['edit','music','sound','visual'].map(toolCallId=>({toolCallId,finding:'Committed successfully'}))}}];}
   else content=[{type:'tool_use',id:'route',name:'select_route',input:{route:'structural'}}];
   if(moduleMode&&!planning&&body.tools?.some((t:any)=>t.name==='apply_ops')){
    if(editorCalls===3){const visual=(content[0] as any).input;content=[{type:'tool_use',id:'draft',name:'create_visual_draft',input:{definition:visual.definition}}];}
    else if(editorCalls===4)content=[{type:'tool_use',id:'module',name:'write_visual_module',input:{draftId:draft.id,expectedRevision:draft.revision,path:'palette.ts',code:"export const accent='#ff00ff';"}}];
    else if(editorCalls===5)content=[{type:'tool_use',id:'import',name:'patch_visual_module',input:{draftId:draft.id,expectedRevision:draft.revision,path:'scene.tsx',expectedHash:draft.definition.source.modules['scene.tsx'],oldText:"import React from 'react';",newText:"import React from 'react';import {accent} from './palette';"}}];
    else if(editorCalls===6)content=[{type:'tool_use',id:'parameter',name:'patch_visual_module',input:{draftId:draft.id,expectedRevision:draft.revision,path:'scene.tsx',expectedHash:draft.definition.source.modules['scene.tsx'],oldText:"background:'#ff00ff'",newText:'background:accent'}}];
    else if(editorCalls===7)content=[{type:'tool_use',id:'visual',name:'commit_visual_draft',input:{draftId:draft.id,expectedRevision:draft.revision,start:{kind:'project',at:'start',offsetSec:.5},placement:'overlay'}}];
   }
   result={content,stop_reason:'tool_use',usage:{input_tokens:0,output_tokens:0}};
  }else{res.writeHead(404).end();return;}
  if(streaming&&body.stream&&req.url?.endsWith('/ai')){
   streams++;res.writeHead(200,{'Content-Type':'text/event-stream'});
   const emit=(type:string,data:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
   const message=result as any;emit('message_start',{type:'message_start',message:{role:'assistant',content:[],usage:{input_tokens:0,output_tokens:0}}});
   for(const [index,block] of message.content.entries()){
    emit('content_block_start',{type:'content_block_start',index,content_block:{...block,input:{}}});
    const json=JSON.stringify(block.input);for(let offset=0;offset<json.length;offset+=17)emit('content_block_delta',{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:json.slice(offset,offset+17)}});
    emit('content_block_stop',{type:'content_block_stop',index});
   }
   emit('message_delta',{type:'message_delta',delta:{stop_reason:message.stop_reason},usage:message.usage});emit('message_stop',{type:'message_stop'});emit('dream_request',{status:'completed',retryable:false});res.end();return;
  }
  res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(result));
 }catch(error){res.writeHead(500).end(JSON.stringify({error:(error as Error).message}));}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const {port}=server.address() as {port:number};
 return{url:`http://127.0.0.1:${port}`,streams:()=>streams,frames:()=>reviewFrames,failures:()=>failures,refreshes:()=>refreshes,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}
