import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,existsSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {ProjectDB} from '@dream/project-db';
import {models,usageCost} from '@dream/config';
import {CodeRuntime} from '../../apps/desktop/src/main/code-runtime';
import {pageText,privateAddress,fetchPage} from '../../apps/project-service/src/web-fetch';
import {agentProject,use,say} from '../fixtures/agent-project';
import {usageCost as gatewayCost} from '../../supabase/functions/dream-gateway/inference-policy';
import {withoutUnansweredServerCalls,repairSavedExchanges} from '../../packages/agent/src/tool-exchanges';

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

it('answers every model\'s web tool with a quiet Haiku search, carries on a paused search, and counts searches in the cost',async()=>{
 const usage={input_tokens:1000,output_tokens:100,server_tool_use:{web_search_requests:3}};expect(usageCost(models.agent,usage)).toBeCloseTo(gatewayCost(models.agent,usage,[2,10]));expect(usageCost(models.agent,usage)).toBeGreaterThan(.03);
 const searches:any[]=[];
 const run=await agentProject((_body,step)=>step===0?[use('w','web',{query:'Anthropic release this week'})]:[say('A new model.')],{providers:{anthropic:true,deepseek:true}});
 // The search pauses once (a long server-side turn) and is sent back as it was to carry on.
 const original=run.agent.dependencies.fetch!;
 run.agent.dependencies.fetch=(async(url:any,init:any)=>{const body=JSON.parse(require('node:zlib').gunzipSync(init.body).toString());
  if(body.purpose!=='web_search')return original(url,init);searches.push(body);
  return Response.json(searches.length===1?{content:[{type:'server_tool_use',id:'s1',name:'web_search',input:{query:'Anthropic release'}},{type:'web_search_tool_result',tool_use_id:'s1',content:[]}],stop_reason:'pause_turn',usage:{}}:{content:[{type:'text',text:'Anthropic released a new model on Monday.'}],stop_reason:'end_turn',usage:{}});}) as typeof fetch;
 try{
  await run.agent.message('What did Anthropic release this week?',[],'ask',[],'turn','auto','deepseek-flash');
  expect(searches).toHaveLength(2);expect(searches[0]).toMatchObject({model:'claude-haiku-5-5',tools:[{type:'web_search_20250305'}]});
  expect(searches[1].messages.at(-1)).toMatchObject({role:'assistant',content:[{type:'server_tool_use'},{type:'web_search_tool_result'}]});
  // The agent's own model (DeepSeek here) gets the findings like any tool's result.
  expect(JSON.stringify(run.gateway.returned('w'))).toContain('Anthropic released a new model on Monday.');
  expect(run.db.state().messages.at(-1)?.text).toBe('A new model.');
 }finally{run.close();}
});

it('drops a server tool call the provider left without a result, so the conversation can be sent back',()=>{
 const orphan={type:'server_tool_use',id:'srvtoolu_1',name:'code_execution',input:{code:'edit project.json'}},search={type:'server_tool_use',id:'srvtoolu_2',name:'web_search',input:{query:'music'}},found={type:'web_search_tool_result',tool_use_id:'srvtoolu_2',content:[]},title={type:'tool_use',id:'toolu_1',name:'set_project_title',input:{title:'T'}};
 expect(withoutUnansweredServerCalls([orphan,search,found,title])).toEqual([search,found,title]);
 // A saved conversation from before the fix is repaired the same way when it is resumed; a paused last turn keeps its call.
 const saved=[{role:'user',content:'Add music'},{role:'assistant',content:[orphan,title]},{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:'{}'}]},{role:'assistant',content:[orphan]}];
 const repaired=repairSavedExchanges(saved,()=>undefined);expect(repaired[1].content).toEqual([title]);expect(repaired.at(-1)!.content).toEqual([orphan]);
});

it('keeps a script written in the reply as the whole reply',async()=>{
 const script='SCENE 1. Ooga. '.repeat(40).trim();
 const run=await agentProject(()=>[say(script)]);
 try{await run.agent.message('Write me a script',[],'ask',[],'turn');expect(run.db.state().messages.at(-1)).toMatchObject({role:'assistant',text:script,report:{kind:'answer'}});}
 finally{run.close();}
});
