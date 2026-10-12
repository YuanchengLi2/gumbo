import {createServer} from 'node:http';

/** Protocol fixture for the current engine (routing, the editing agent and its helpers, planning).
 * A script receives each inference request and its step: the number of assistant turns already in that conversation,
 * so interrupted and resumed conversations continue deterministically. Real provider evidence comes from scripts/smoke-engine-local.ts.
 */
export type Script=(body:any,step:number)=>any[];
export async function codeGateway(options:{script:Script;route?:(body:any)=>Record<string,unknown>;delayMs?:number;shortSession?:boolean;transientOnce?:boolean}){
 let refreshes=0,streams=0,failures=0,responses=0;const usedTokens=new Set<string>(),calls:{purpose?:string;model?:string;tools:string[];step:number}[]=[];
 const server=createServer(async(req,res)=>{try{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  if(req.url?.endsWith('/transcribe')){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({words:[],segments:[]}));return;}
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{},json=(status:number,data:unknown)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));
  if(req.url?.startsWith('/auth/v1/'))return json(200,{access_token:`code-fixture-${++refreshes}`,refresh_token:'code-fixture-refresh',expires_in:options.shortSession?1:3600,user:{id:'fixture-account',email:'local-fixture@example.invalid',is_anonymous:true}});
  if(req.url?.endsWith('/account'))return json(200,{status:'active',is_guest:true,invited:true});
  if(req.url?.endsWith('/ai-status')||req.url?.endsWith('/ai-cancel'))return json(404,{dream_request:{status:'missing',retryable:false}});
  if(!req.url?.endsWith('/ai'))return json(404,{});
  if(options.shortSession){const token=String(req.headers.authorization);if(usedTokens.has(token))return json(401,{error:'Fixture token expired',dream_request:{status:'failed',retryable:false}});usedTokens.add(token);}
  if(options.transientOnce&&!failures){failures++;return json(529,{error:'Temporary overload',dream_request:{status:'failed',retryable:true,retryAfterMs:500}});}
  if(options.delayMs)await new Promise(r=>setTimeout(r,options.delayMs));
  const tools:string[]=(body.tools??[]).map((t:any)=>t.name),step=(body.messages??[]).filter((m:any)=>m.role==='assistant').length;calls.push({purpose:body.purpose,model:body.model,tools,step});
  let content:any[];
  if(body.purpose==='routing')content=[{type:'text',text:JSON.stringify({route:'local',intelligence:'haiku',complexity:'normal',reason:'Fixture route',approvalQuote:null,projectTitle:'Fixture edit',...options.route?.(body)})}];
  // Real responses never reuse tool IDs; make scripted IDs unique per response.
  else{const number=++responses;content=options.script(body,step).map(block=>block.type==='tool_use'?{...block,id:block.id+'-'+number}:block);}
  const message={content,stop_reason:content.some(b=>b.type==='tool_use')?'tool_use':'end_turn',usage:{input_tokens:0,output_tokens:0}};
  if(!body.stream)return json(200,message);
  streams++;res.writeHead(200,{'Content-Type':'text/event-stream'});
  const emit=(type:string,data:unknown)=>res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  emit('message_start',{type:'message_start',message:{role:'assistant',content:[],usage:message.usage}});
  for(const [index,block] of content.entries()){
   if(block.type==='text'){emit('content_block_start',{type:'content_block_start',index,content_block:{type:'text',text:''}});emit('content_block_delta',{type:'content_block_delta',index,delta:{type:'text_delta',text:block.text}});}
   else{emit('content_block_start',{type:'content_block_start',index,content_block:{...block,input:{}}});const text=JSON.stringify(block.input);for(let offset=0;offset<text.length;offset+=400)emit('content_block_delta',{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:text.slice(offset,offset+400)}});}
   emit('content_block_stop',{type:'content_block_stop',index});
  }
  emit('message_delta',{type:'message_delta',delta:{stop_reason:message.stop_reason},usage:message.usage});emit('message_stop',{type:'message_stop'});emit('dream_request',{status:'completed',retryable:false});res.end();
 }catch(error){res.writeHead(500).end(JSON.stringify({error:(error as Error).message}));}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const {port}=server.address() as {port:number};
 return{url:`http://127.0.0.1:${port}`,streams:()=>streams,failures:()=>failures,refreshes:()=>refreshes,calls,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
/** Parsed result of the most recent call to a tool in this conversation (first text block, or the string content). */
export function resultOf(body:any,tool:string):any{
 const messages:any[]=body.messages??[];let id:string|undefined;
 for(const m of messages)if(m.role==='assistant'&&Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_use'&&b.name===tool)id=b.id;
 for(const m of messages)if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&b.tool_use_id===id){const text=typeof b.content==='string'?b.content:b.content?.find((c:any)=>c.type==='text')?.text;try{return JSON.parse(text);}catch{return text;}}
}
/** Asset IDs mentioned in the conversation, in order. */
export const assetIds=(body:any)=>[...JSON.stringify(body.messages??[]).matchAll(/a_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|a_[0-9a-f]{24}/g)].map(m=>m[0]);
/** One response that edits project.json through a sandboxed Node script, then publishes. */
export function scriptedEdit(prefix:string,edit:string){
 const script=`const fs=require('fs');const p=JSON.parse(fs.readFileSync('project.json','utf8'));${edit};fs.writeFileSync('project.json',JSON.stringify(p,null,2));`;
 return[use(prefix+'-write','write_file',{path:`src/${prefix}.cjs`,content:script}),use(prefix+'-run','run_command',{command:`node src/${prefix}.cjs`}),use(prefix+'-publish','publish_project',{})];
}
export const finish=(id:string,summary:string,blocked?:string)=>[use(id,'finish',blocked?{status:'blocked',summary,nextAction:blocked}:{status:'complete',summary})];

/** Plan, then one editing-agent conversation through the approved steps: each step edits project.json by script, publishes
 * and finishes. */
export function planningScript(blockOnce=false):Script{
 return body=>{
  const all=JSON.stringify(body.messages??[]);
  if(body.purpose==='planning')return[use('plan','finish',{status:'complete',summary:'Plan ready.',plan:{schemaVersion:1,title:'Format plan',goal:'Prepare a square 60 fps edit',steps:[{id:'timing',title:'Set timing',instruction:'Set 60 fps',acceptance:'60 fps',review:false},{id:'square',title:'Set format',instruction:'Set square dimensions',acceptance:'1080 square',review:false}],assumptions:[]}})];
  // The latest step message decides the step. A message is plain text or, for the first one, the cached briefing followed
  // by the request.
  const text=(m:any)=>typeof m?.content==='string'?m.content:Array.isArray(m?.content)?m.content.map((b:any)=>b.text??'').join('\n'):'';
  const messages:any[]=body.messages??[],at=messages.findLastIndex(m=>text(m).includes('Current step:')),current=text(messages[at]),id=current.includes('Set 60 fps')?'timing':'square',since=messages.slice(at).filter(m=>m.role==='assistant').length;
  if(since===0)return scriptedEdit('step-'+id,id==='timing'?'p.timeline.settings.fps=60':'p.timeline.settings.width=1080;p.timeline.settings.height=1080');
  if(blockOnce&&id==='square'&&!all.includes('Square format is confirmed'))return finish(id+'-paused','Square format saved; confirmation needed.','Confirm the square format before continuing.');
  return finish(id+'-done','Approved step saved.');
 };
}
/** Finishes, keeping with a reason every must-fix check the latest publication reported (an edit that means to repeat
 * footage or cut where the fixture's words fall). */
export const finishKeeping=(body:any,id:string,summary:string,reason:string)=>[use(id,'finish',{status:'complete',summary,kept:(resultOf(body,'publish_project')?.checks?.mustFix??[]).map((c:any)=>({check:c.id,reason}))})];
