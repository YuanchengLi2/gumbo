import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import type {ProcessResult,ProcessRunner} from '@dream/contracts';
import {Agent} from '../../packages/agent/src/session';
import {parseTool} from '../../packages/agent/src/tools';
import {requestBody} from '../../packages/agent/src/transport';
import {Workspace,type WorkspaceOptions} from '../../apps/project-service/src/workspace';

/** Roux against a scripted gateway, in a project on disk: no model is called and nothing is paid for. */

/** A tool call as the agent makes it: the input is checked and given its defaults first. */
export function call(ws:Workspace,name:string,input:unknown,id=`${name}-${Math.random().toString(36).slice(2,8)}`,turnId='turn',signal=new AbortController().signal){
 return ws.tool(name,parseTool(name,input),{callId:id,turnId,signal,readOnly:false});
}
/** A tool result's text, whether it came back as text or as text and pictures. */
export const textOf=(result:unknown):string=>typeof result==='string'?result:Array.isArray((result as any)?.content)?(result as any).content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n'):JSON.stringify(result);
export const imagesOf=(result:unknown)=>Array.isArray((result as any)?.content)?(result as any).content.filter((b:any)=>b.type==='image').length:0;
export const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
export const say=(text:string)=>({type:'text',text});

/** A command runner that runs nothing: each command is answered by `answer` (by default, it succeeds with no output). */
export const fakeRunner=(answer:(command:string)=>Partial<ProcessResult>=()=>({})):ProcessRunner=>async request=>({id:request.id,status:'complete',exitCode:0,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),output:'',logPath:'',isolation:'local',commandHash:request.id,...answer(request.command)});

/** A gateway that answers each model call from a script. step counts the replies since the latest request's words, so
 * every request starts at step 0. Calls without tools (compaction, overviews, shot descriptions) get `helper`. */
export function scriptedGateway(script:(body:any,step:number)=>any[],options:{providers?:Record<string,boolean>;helper?:(body:any)=>string;usage?:(body:any)=>Record<string,number>}={}){
 const bodies:any[]=[];let responses=0;
 const answer=(async(url:string|URL|Request,init?:RequestInit)=>{
  const address=String(url);
  if(address.endsWith('/providers'))return Response.json(options.providers??{anthropic:true});
  if(address.endsWith('/ai-status')||address.endsWith('/ai-cancel'))return Response.json({dream_request:{status:'missing',retryable:false}},{status:404});
  const body=requestBody(init?.body);bodies.push(body);
  const messages:any[]=body.messages??[],asked=messages.findLastIndex(m=>m.role==='user'&&(typeof m.content==='string'||m.content?.some((b:any)=>b.type==='text'))),step=messages.slice(asked+1).filter(m=>m.role==='assistant').length;
  const number=++responses,content=body.tools?.length&&!body.tools.some((t:any)=>t.type?.startsWith('web_search'))?script(body,step).map(b=>b.type==='tool_use'?{...b,id:`${b.id}-${number}`}:b):[{type:'text',text:options.helper?.(body)??'Fixture.'}];
  return Response.json({content,stop_reason:content.some((b:any)=>b.type==='tool_use')?'tool_use':'end_turn',usage:options.usage?.(body)??{input_tokens:10,output_tokens:5}});
 }) as typeof globalThis.fetch;
 /** The result the model was given for a scripted call (ids are numbered: e becomes e-2). */
 const returned=(id:string)=>{for(const body of [...bodies].reverse())for(const m of body.messages??[])if(Array.isArray(m.content))for(const b of m.content)if(b.type==='tool_result'&&new RegExp(`^${id}-\\d+$`).test(b.tool_use_id))return b;return undefined;};
 return{fetch:answer,bodies,returned,agentCalls:()=>bodies.filter(b=>['execution','planning','answering'].includes(b.purpose))};
}

/** A project on disk with Roux and its workspace, talking to a scripted gateway. */
export async function agentProject(script:(body:any,step:number)=>any[],options:{name?:string;workspace?:Partial<WorkspaceOptions>;providers?:Record<string,boolean>;helper?:(body:any)=>string;usage?:(body:any)=>Record<string,number>}={}){
 const folder=mkdtempSync(join(tmpdir(),'gumbo-roux-')),db=new ProjectDB(folder,options.name??'Roux test'),events:{type:string;payload:any}[]=[];
 const publish=(type:string,payload:any)=>{events.push({type,payload});};
 const gateway=scriptedGateway(script,options);
 const workspace=new Workspace(db,{run:fakeRunner(),ffmpeg:'',ffprobe:'',...options.workspace},publish);
 const agent=new Agent(db,async()=>({url:'http://gateway.fixture',token:'fixture-token',accountId:'fixture-account'} as any),publish,workspace);
 agent.dependencies={fetch:gateway.fetch,wait:async()=>{}};
 await workspace.initialize();
 return{db,folder,agent,workspace,gateway,events,close:()=>{workspace.close();db.close();}};
}

/** A source with timed words (no media file): enough for the footage files, grep, review and the edit checks. */
export function addSource(db:ProjectDB,options:{id?:string;filename?:string;durationSec?:number;words?:[number,number,string][]}={}){
 const id=options.id??'a_fixture000000000000000001',asset=AssetSchema.parse({id,filename:options.filename??'interview.mp4',kind:'video',originalPath:join(db.folder,'Media',options.filename??'interview.mp4'),fingerprint:'fp-'+id,durationSec:options.durationSec??60,fps:30,width:1920,height:1080,hasAudio:true,status:'ready'});
 db.saveAsset(asset);
 const words=(options.words??[]).map(([start,end,text],n)=>({id:`${id}-w${n}`,assetId:id,text,start,end,confidence:1,speaker:'unknown',pauseBefore:0}));
 if(words.length)db.saveRecords('words',words);
 db.db.prepare('INSERT OR REPLACE INTO jobs(id,asset_id,step,status,percent,error) VALUES(?,?,?,?,?,?)').run(`${id}-transcription`,id,'transcription','complete',100,null);
 return asset;
}
