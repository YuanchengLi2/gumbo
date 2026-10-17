import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {ProjectDB} from '@dream/project-db';
import {models,usageCost} from '@dream/config';
import {CodeRuntime} from '../../apps/desktop/src/main/code-runtime';
import {pageText,privateAddress,fetchPage} from '../../apps/project-service/src/web-fetch';
import {Director,webSearchTool} from '../../packages/orchestrator/src/code-director';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {usageCost as gatewayCost} from '../../supabase/functions/dream-gateway/inference-policy';
import {withoutUnansweredServerCalls,repairSavedExchanges} from '../../packages/orchestrator/src/tool-exchanges';

it('runs a command on the user\'s computer when computer access is allowed, without the app\'s secrets',async()=>{
 const project=mkdtempSync(join(tmpdir(),'dream-local-')),workspace=join(project,'Workspace');mkdirSync(workspace);
 // A command on the user's computer needs the bundled shell and the host (for its memory cap), not the container.
 mkdirSync(join(project,'runtime','shell'),{recursive:true});copyFileSync(resolve('apps/desktop/resources/staged/creation/shell/busybox.exe'),join(project,'runtime','shell','busybox.exe'));mkdirSync(join(project,'runtime','host'),{recursive:true});copyFileSync(resolve('apps/desktop/resources/staged/creation/host/creation-host.exe'),join(project,'runtime','host','creation-host.exe'));
 const runtime=new CodeRuntime({creation:join(project,'runtime'),ffmpeg:join(project,'bin','ffmpeg.exe'),ffprobe:'',browser:''});runtime.local=()=>true;
 process.env.DREAM_TEST_SECRET='hidden';process.env.SUPABASE_SERVICE_KEY='hidden';
 try{
  const seen:string[]=[];
  const result=await runtime.run({id:'local1',projectId:'p',workspace,command:'echo hello from $COMPUTERNAME; echo "[$DREAM_TEST_SECRET][$SUPABASE_SERVICE_KEY]"; pwd',cwd:'.',timeoutMs:30000},new AbortController().signal,text=>seen.push(text));
  expect(result).toMatchObject({status:'complete',exitCode:0,isolation:'local'});
  expect(result.output).toContain('hello from '+process.env.COMPUTERNAME);expect(result.output).toContain('[][]');expect(result.output.toLowerCase()).toContain(workspace.replaceAll('\\','/').toLowerCase());
  expect(seen.join('')).toContain('hello');expect(existsSync(join(project,'.dream','processes','local1.json'))).toBe(true);
  // A replayed request returns its receipt instead of running again.
  expect((await runtime.run({id:'local1',projectId:'p',workspace,command:'echo hello from $COMPUTERNAME; echo "[$DREAM_TEST_SECRET][$SUPABASE_SERVICE_KEY]"; pwd',cwd:'.',timeoutMs:30000},new AbortController().signal,()=>{})).output).toBe(result.output);
  const failed=await runtime.run({id:'local2',projectId:'p',workspace,command:'exit 3',cwd:'.',timeoutMs:30000},new AbortController().signal,()=>{});expect(failed).toMatchObject({status:'failed',exitCode:3});
  const unix=await runtime.run({id:'local3',projectId:'p',workspace,command:'node -e "console.log(\\"one\\");console.log(\'two\')" | tail -1 | grep two; printf \'a\\nb\\nc\\n\' | head -2 | wc -l',cwd:'.',timeoutMs:30000},new AbortController().signal,()=>{});
  expect(unix).toMatchObject({status:'complete',exitCode:0});expect(unix.output.split(/\r?\n/).filter(Boolean)).toEqual(['two','2']);
 }finally{delete process.env.DREAM_TEST_SECRET;delete process.env.SUPABASE_SERVICE_KEY;}
},60_000);

it('reads a page as text and refuses addresses on this computer or its network',async()=>{
 expect(pageText('<html><head><title>Model news</title><style>p{}</style></head><body><script>x()</script><h1>Claude</h1><p>Fast &amp; cheap</p></body></html>')).toEqual({title:'Model news',text:'Claude\nFast & cheap'});
 for(const address of ['127.0.0.1','10.1.2.3','192.168.1.5','172.20.0.1','::1','fd00::1'])expect(privateAddress(address),address).toBe(true);
 expect(privateAddress('8.8.8.8')).toBe(false);
 const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<title>Local</title>secret');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{await expect(fetchPage(`http://127.0.0.1:${(server.address() as any).port}/`,20000,new AbortController().signal)).rejects.toThrow(/this computer/);await expect(fetchPage('http://localhost:1/',20000,new AbortController().signal)).rejects.toThrow(/this computer/);}
 finally{server.close();}
});

it('gives every agent with tools web search in its model\'s version, resumes a paused search, and counts searches in the cost',async()=>{
 // A plain function answered by a Haiku search: Anthropic's own search tool cost 2,440 tokens on every call.
 expect(webSearchTool(models.agent)).toMatchObject({name:'web_search'});expect((webSearchTool(models.agent) as any).type).toBeUndefined();
 const usage={input_tokens:1000,output_tokens:100,server_tool_use:{web_search_requests:3}};expect(usageCost(models.agent,usage)).toBeCloseTo(gatewayCost(models.agent,usage,[2,10]));expect(usageCost(models.agent,usage)).toBeGreaterThan(.03);
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-web-')));
 try{
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));const sent:any[]=[];
  await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({ok:true})} as any,turnId:'turn',text:'What did Anthropic release this week?',model:models.agent,readOnly:true,signal:new AbortController().signal,publish:()=>{},infer:async(_m,_s,messages)=>{sent.push(structuredClone(messages));
   return sent.length===1?{content:[{type:'server_tool_use',id:'s1',name:'web_search',input:{query:'Anthropic release'}},{type:'web_search_tool_result',tool_use_id:'s1',content:[]}],stop_reason:'pause_turn'}:{content:[{type:'text',text:'A new model.'}],stop_reason:'end_turn'};}});
  // The paused turn is sent back unchanged, with nothing added after it.
  expect(sent).toHaveLength(2);expect(sent[1].at(-1).role).toBe('assistant');expect(sent[1].at(-1).content[0].type).toBe('server_tool_use');
  expect(db.turnActivity('turn')?.events?.some((e:any)=>e.tool==='web_search'&&e.detail==='Anthropic release')??JSON.stringify(db.db.prepare("SELECT json FROM activity_events").all()).includes('Searching the web')).toBe(true);
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{});let tools:any[]=[];
  (director as any).infer=async(_m:string,_s:string,_msgs:unknown[],given:any[])=>{tools=given;return{content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage:{}};};
  await director.inference(models.agent,'Edit',[{role:'user',content:'hi'}],[{name:'read_file',input_schema:{type:'object'}}],'turn2',undefined,'execution','main');
  expect(tools.map(t=>t.name)).toEqual(['web_search','read_file']);
 }finally{db.close();}
});

it('drops a server tool call the provider left without a result, so the conversation can be sent back',()=>{
 const orphan={type:'server_tool_use',id:'srvtoolu_1',name:'code_execution',input:{code:'edit project.json'}},search={type:'server_tool_use',id:'srvtoolu_2',name:'web_search',input:{query:'music'}},found={type:'web_search_tool_result',tool_use_id:'srvtoolu_2',content:[]},title={type:'tool_use',id:'toolu_1',name:'set_project_title',input:{title:'T'}};
 expect(withoutUnansweredServerCalls([orphan,search,found,title])).toEqual([search,found,title]);
 // A saved conversation from before the fix is repaired the same way when it is resumed; a paused last turn keeps its call.
 const saved=[{role:'user',content:'Add music'},{role:'assistant',content:[orphan,title]},{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:'{}'}]},{role:'assistant',content:[orphan]}];
 const repaired=repairSavedExchanges(saved,()=>undefined);expect(repaired[1].content).toEqual([title]);expect(repaired.at(-1)!.content).toEqual([orphan]);
});

it('resumes a current-format conversation saved with an unanswered server call, without rejecting its changed history',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-orphan-')));
 try{
  const orphan={type:'server_tool_use',id:'srvtoolu_1',name:'code_execution',input:{code:'edit project.json'}};
  db.saveState('code-agent:turn:main',{turnId:'turn',protocolVersion:2,messages:[{role:'user',content:'Add music'},{role:'assistant',content:[orphan,{type:'text',text:'Working.'}]},{role:'user',content:'continue'}],results:[],completed:{},model:models.agent,failures:{}});
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));const sent:any[]=[];
  await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({ok:true})} as any,turnId:'turn',text:'Add music',model:models.agent,readOnly:true,signal:new AbortController().signal,publish:()=>{},infer:async(_m,_s,messages)=>{sent.push(structuredClone(messages));return{content:[{type:'text',text:'Done.'}],stop_reason:'end_turn'};}});
  expect(sent).toHaveLength(1);expect(sent[0][1].content).toEqual([{type:'text',text:'Working.'}]);
 }finally{db.close();}
});

it('keeps a script the agent wrote alongside finish in the saved reply, not only the short summary',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-reply-')));
 try{
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));const script='SCENE 1. Ooga. '.repeat(40).trim();
  const result=await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({ok:true,finished:true})} as any,turnId:'turn',text:'Write me a script',model:models.agent,readOnly:true,signal:new AbortController().signal,publish:()=>{},infer:async()=>({content:[{type:'text',text:script},{type:'tool_use',id:'toolu_f',name:'finish',input:{status:'complete',summary:'Wrote a 16-scene script.'}}],stop_reason:'tool_use'})});
  // Nothing changed, so the script is the whole reply: no recap line repeated under it.
  expect(result.outcome.summary).toBe(script);
 }finally{db.close();}
});
