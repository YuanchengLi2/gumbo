import {it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,readdirSync,existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {TimelineSchema} from '@dream/timeline';
import {handleMediaSearch,licenseOf} from '../../supabase/functions/dream-gateway/media-search';
import {downloadMedia} from '../../apps/project-service/src/media-download';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {webSearchTool} from '../../packages/orchestrator/src/code-director';
import {searchReport} from '../../packages/orchestrator/src/web-search';
import {newCredits} from '../../packages/orchestrator/src/credits';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {intelligence,quietPurposes} from '../../packages/orchestrator/src/intelligence';

afterEach(()=>{vi.unstubAllGlobals();});
const json=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});

it('searches the keyless libraries, loosens a query that finds too little, keeps only usable licenses and reports a failed library',async()=>{
 const calls:string[]=[];
 const fetcher=(async(input:any)=>{const url=String(input);calls.push(url);const q=new URL(url).searchParams;
  if(url.startsWith('https://api.openverse.org/v1/audio/'))return json({results:q.get('q')==='upbeat acoustic'?[
   {id:'a1',title:'Key, Kida &amp; Eddie',creator:'<a href="x">Kida</a>',license:'by-sa',license_version:'3.0',license_url:'https://creativecommons.org/licenses/by-sa/3.0/',foreign_landing_url:'https://www.jamendo.com/track/1',url:'https://prod-1.storage.jamendo.com/?trackid=1&format=mp32',duration:60000,source:'jamendo'},
   {id:'a2',title:'Not for commercial use',license:'by-nc',license_version:'4.0',url:'https://example.org/a2.mp3',duration:1000,source:'jamendo'}]:[]});
  if(url.startsWith('https://commons.wikimedia.org/'))return json({query:{pages:{
   '2':{pageid:2,index:2,title:'File:Second.ogg',imageinfo:[{url:'https://upload.wikimedia.org/second.ogg',mime:'application/ogg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Second.ogg',duration:12.34,extmetadata:{LicenseShortName:{value:'CC0'}}}]},
   '5':{pageid:5,index:1,title:'File:First.mp3',imageinfo:[{url:'https://upload.wikimedia.org/first.mp3',mime:'audio/mpeg',descriptionurl:'https://commons.wikimedia.org/wiki/File:First.mp3',duration:90,extmetadata:{LicenseShortName:{value:'CC BY 4.0'},Artist:{value:'<span>Jo</span>'}}}]},
   '1':{pageid:1,index:0,title:'File:Notes.mid',imageinfo:[{url:'https://upload.wikimedia.org/notes.mid',mime:'audio/midi',descriptionurl:'x',extmetadata:{LicenseShortName:{value:'CC0'}}}]},
   '7':{pageid:7,index:3,title:'File:NoDerivs.mp3',imageinfo:[{url:'https://upload.wikimedia.org/nd.mp3',mime:'audio/mpeg',descriptionurl:'x',extmetadata:{LicenseShortName:{value:'CC BY-ND 4.0'}}}]}}}});
  // The Internet Archive answers a failed search with 200 and an error inside.
  if(url.startsWith('https://archive.org/advancedsearch.php'))return json({error:'[BACKEND_ERROR] Invalid or no response from Elasticsearch'});
  throw new Error('unexpected '+url);}) as typeof fetch;
 const {status,body}:{status:number;body:any}=await handleMediaSearch({query:'upbeat acoustic travel',kind:'music',limit:8},{keys:{},fetcher});
 expect(status).toBe(200);
 // Openverse matches every word: nothing for three words, so the first half of them is searched again; Commons tries OR.
 const openverse=calls.filter(u=>u.includes('openverse')).map(u=>new URL(u).searchParams.get('q'));expect(openverse).toEqual(['upbeat acoustic travel','upbeat acoustic']);
 expect(calls.find(u=>u.includes('openverse'))).toContain('category=music');
 expect(calls.filter(u=>u.includes('commons')).map(u=>new URL(u).searchParams.get('gsrsearch'))).toEqual(['upbeat acoustic travel filetype:audio','upbeat OR acoustic OR travel filetype:audio']);
 // Non-commercial, no-derivatives and MIDI are left out; Commons keeps its ranking; titles and names are plain text.
 expect(body.results.map((r:any)=>r.id)).toEqual(['openverse:a1','commons:5','commons:2']);
 expect(body.results[0]).toMatchObject({title:'Key, Kida & Eddie',creator:'Kida',license:'CC BY-SA 3.0',durationSec:60,kind:'audio'});
 expect(body.results[0].attribution).toBe('"Key, Kida & Eddie" by Kida (CC BY-SA 3.0), https://www.jamendo.com/track/1');
 expect(body.results[1]).toMatchObject({creator:'Jo',license:'CC BY 4.0',durationSec:90});expect(body.results[2]).toMatchObject({license:'CC0',attribution:undefined,durationSec:12.3});
 expect(body.sources).toMatchObject({Openverse:'searched','Wikimedia Commons':'searched','Internet Archive':expect.stringContaining('BACKEND_ERROR')});
 expect(body.notSetUp).toEqual(['pexels','pixabay','freesound','jamendo','openverse']);
 // Sound effects mostly have no category on Openverse, so they are not filtered by one.
 calls.length=0;await handleMediaSearch({query:'shutter',kind:'sound',limit:4},{keys:{},fetcher});expect(calls.find(u=>u.includes('openverse'))).not.toContain('category=');
 expect(licenseOf('https://creativecommons.org/licenses/by-nc-nd/3.0/')).toMatchObject({usable:false});expect(licenseOf('http://creativecommons.org/publicdomain/zero/1.0/')).toMatchObject({name:'CC0',usable:true,credit:false});
});

it('asks the Archive for usable licenses in a form its search can run, picks the best copy and reads mm:ss lengths',async()=>{
 const calls:string[]=[];
 const fetcher=(async(input:any)=>{const url=String(input);calls.push(url);
  if(url.startsWith('https://archive.org/advancedsearch.php'))return json({response:{docs:[{identifier:'waves',title:'Waves On Rocky Shore',creator:['Ann'],licenseurl:'http://creativecommons.org/licenses/by/3.0/'},{identifier:'nc-item',title:'NC',licenseurl:'http://creativecommons.org/licenses/by-nc/3.0/'}]}});
  if(url==='https://archive.org/metadata/waves')return json({files:[{name:'w_512kb.mp4',format:'512Kb MPEG4'},{name:'sub dir/w.mp4',format:'h.264',length:'03:07',width:'1920',height:'1080',size:'1000'}]});
  if(url.startsWith('https://commons.wikimedia.org/'))return json({query:{pages:{}}});
  throw new Error('unexpected '+url);}) as typeof fetch;
 const {body}:{body:any}=await handleMediaSearch({query:'ocean (waves)',kind:'footage',limit:8},{keys:{},fetcher});
 const q=new URL(calls.find(u=>u.includes('advancedsearch'))!).searchParams.get('q')!;
 expect(q).toBe('(title:(ocean waves) OR subject:(ocean waves) OR description:(ocean waves)) AND mediatype:movies AND licenseurl:[* TO *] AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*');
 expect(calls.some(u=>u.includes('metadata/nc-item'))).toBe(false);
 expect(body.results).toEqual([expect.objectContaining({id:'archive:waves/sub dir/w.mp4',kind:'video',license:'CC BY 3.0',creator:'Ann',durationSec:187,width:1920,height:1080,download:'https://archive.org/download/waves/sub%20dir/w.mp4',attribution:'"Waves On Rocky Shore" by Ann (CC BY 3.0), https://archive.org/details/waves'})]);
});

it('uses an Openverse app key when one is set, fetching its token once',async()=>{
 let tokens=0;const auth:string[]=[];
 const fetcher=(async(input:any,init:any)=>{const url=String(input);
  if(url==='https://api.openverse.org/v1/auth_tokens/token/'){tokens++;expect(String(init.body)).toContain('client_id=id');return json({access_token:'tok',expires_in:43200});}
  if(url.includes('api.openverse.org')){auth.push(init.headers.Authorization);return json({results:[]});}
  return json({query:{pages:{}}});}) as typeof fetch;
 await handleMediaSearch({query:'rain',kind:'sound',limit:4},{keys:{openverse:'id:secret'},fetcher});await handleMediaSearch({query:'thunder',kind:'sound',limit:4},{keys:{openverse:'id:secret'},fetcher});
 expect(tokens).toBe(1);expect(auth).toEqual(['Bearer tok','Bearer tok']);
});

it('downloads a found file once into the project, as media only, and never keeps a partial file',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-download-'));let fetches=0;
 const item={id:'openverse:a1',kind:'audio' as const,title:'Key, Kida & Eddie',license:'CC BY-SA 3.0',source:'Openverse (jamendo)',page:'https://www.jamendo.com/track/1',download:'https://prod-1.storage.jamendo.com/?trackid=1&format=mp32'};
 const audio=(async()=>{fetches++;return new Response(new Uint8Array([73,68,51,1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});}) as typeof fetch;
 const path=await downloadMedia(item,folder,new AbortController().signal,audio);
 expect(path).toMatch(/Key Kida Eddie - [0-9a-f]{8}\.mp3$/);expect([...readFileSync(path)]).toEqual([73,68,51,1,2,3]);
 expect(await downloadMedia(item,folder,new AbortController().signal,audio)).toBe(path);expect(fetches).toBe(1);
 const page=(async()=>new Response('<html>',{headers:{'Content-Type':'text/html'}})) as typeof fetch;
 await expect(downloadMedia({...item,id:'x',title:'Page'},folder,new AbortController().signal,page)).rejects.toThrow(/not a media file/);
 await expect(downloadMedia({...item,id:'y',download:'http://example.org/a.mp3'},folder,new AbortController().signal,audio)).rejects.toThrow(/https/);
 await expect(downloadMedia({...item,id:'z',title:'Big'},folder,new AbortController().signal,audio,4)).rejects.toThrow(/larger/);
 expect(readdirSync(folder).filter(n=>n.endsWith('.partial')||n.startsWith('Big'))).toEqual([]);
});

it('lets the agent search online, import a result with its license, and see that license with the media',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-online-')),db=new ProjectDB(folder,'Online');
 const result={id:'commons:5',source:'Wikimedia Commons',kind:'audio',title:'First',creator:'Jo',license:'CC BY 4.0',page:'https://commons.wikimedia.org/wiki/File:First.mp3',download:'https://upload.wikimedia.org/first.mp3',durationSec:90,attribution:'"First" by Jo (CC BY 4.0), https://commons.wikimedia.org/wiki/File:First.mp3'};
 const mediaSearch=vi.fn(async()=>({query:'calm piano',kind:'music',results:[result],sources:{'Wikimedia Commons':'searched'},notSetUp:['pexels']}));
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}})));
 const importMany=vi.fn(async(paths:string[])=>({results:paths.map((path,n)=>{const asset={id:'song'+n,filename:path.split(/[\\/]/).pop()!,kind:'audio',durationSec:90,fps:30,hasAudio:true,originalPath:path,fingerprint:'f'+n,status:'ready'} as any;db.saveAsset(asset);return{asset};})}));
 const workspace=new CodeWorkspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path,mediaSearch,importMany:importMany as any},()=>{});
 try{
  await workspace.initialize();
  // The tool's default limit (100, for files on the computer) is not passed on: online searches ask for 8 per library.
  const found:any=await workspace.execute('find_media',{online:'music',query:'calm piano',limit:100},'find',db.head(),new AbortController().signal);
  expect(mediaSearch).toHaveBeenCalledWith({query:'calm piano',kind:'music',limit:8},expect.anything());
  expect(found.found).toEqual(['online:commons:5 | audio | First | Jo | CC BY 4.0 | 90s | Wikimedia Commons']);
  // Only what a search found can be downloaded; the link is never typed by the model.
  const imported:any=await workspace.execute('import_media',{paths:['online:commons:5','online:commons:404']},'import',db.head(),new AbortController().signal);
  const report=JSON.parse(imported.content?.[0]?.text??JSON.stringify(imported));
  expect(report.imported).toEqual([expect.objectContaining({assetId:'song0',license:'CC BY 4.0',credit:result.attribution})]);
  expect(report.failed).toEqual([{path:'online:commons:404',error:expect.stringMatching(/online find_media search/)}]);
  expect(importMany.mock.calls[0][0][0]).toMatch(/Media[\\/]Downloaded[\\/]First - [0-9a-f]{8}\.mp3$/);expect(existsSync(importMany.mock.calls[0][0][0])).toBe(true);
  expect(db.footage().assets.find(a=>a.id==='song0')?.license).toEqual({name:'CC BY 4.0',source:'Wikimedia Commons',page:result.page,creator:'Jo',attribution:result.attribution});
  expect(workspace.mediaContext().find((m:any)=>m.assetId==='song0')).toMatchObject({license:'CC BY 4.0',credit:result.attribution});
 }finally{db.close();}
},60_000);

it('gives every model web search as a function, answered by a quiet low-effort Haiku search',async()=>{
 expect(webSearchTool('claude-sonnet-5-5')).toMatchObject({name:'web_search',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}});
 expect(webSearchTool('gpt-6.1-sol')).toMatchObject({name:'web_search',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}});
 expect((webSearchTool('deepseek-flash') as any).type).toBeUndefined();
 expect(intelligence('claude-haiku-5-5','web_search',{difficulty:4},0,'high').effort).toBe('low');expect(quietPurposes.has('web_search')).toBe(true);
 const report=searchReport('pho hanoi price',[{type:'server_tool_use',id:'s',name:'web_search',input:{query:'pho hanoi price'}},
  {type:'web_search_tool_result',tool_use_id:'s',content:[{type:'web_search_result',url:'https://a.example/pho',title:'Pho prices',page_age:'2026-09-01',encrypted_content:'x'},{type:'web_search_result',url:'https://a.example/pho',title:'dup',encrypted_content:'x'}]},
  {type:'text',text:'A bowl costs 40,000-60,000 VND.',citations:[{type:'web_search_result_location',url:'https://a.example/pho',title:'Pho prices',cited_text:'40,000'}]}]);
 expect(report).toMatchObject({query:'pho hanoi price',findings:'A bowl costs 40,000-60,000 VND. [https://a.example/pho]',pages:[{title:'Pho prices',url:'https://a.example/pho',age:'2026-09-01'}]});
 expect(()=>searchReport('x',[{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'too_many_requests'}}])).toThrow(/too_many_requests/);
 // A GPT agent's web_search call runs the search hook and its result goes back like any tool's.
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-websearch-')));
 try{
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));const searched:string[]=[];let n=0,seen:any;
  const {outcome}=await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({})} as any,turnId:'turn',text:'How much is pho in Hanoi?',model:'gpt-6.1-sol',readOnly:true,signal:new AbortController().signal,publish:()=>{},
   webSearch:async query=>{searched.push(query);return report;},
   infer:async(_m,_s,messages)=>{if(n++===0)return{content:[{type:'tool_use',id:'w1',name:'web_search',input:{query:'pho price hanoi'}}],stop_reason:'tool_use'};seen=messages.at(-1);return{content:[{type:'text',text:'About 40,000-60,000 VND a bowl.'}],stop_reason:'end_turn'};}});
  expect(searched).toEqual(['pho price hanoi']);expect(JSON.stringify(seen)).toContain('40,000-60,000 VND');expect(outcome.status).toBe('complete');
 }finally{db.close();}
});

it('lists credits for downloaded media a request put into the edit, once',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-credits-')));
 try{
  const license={name:'CC BY 4.0',source:'Wikimedia Commons',page:'https://commons.wikimedia.org/wiki/File:First.mp3',attribution:'"First" by Jo (CC BY 4.0), https://commons.wikimedia.org/wiki/File:First.mp3'};
  db.saveAsset({id:'song',filename:'First.mp3',kind:'audio',durationSec:90,fps:30,hasAudio:true,originalPath:'x',fingerprint:'s',status:'ready',license} as any);
  db.saveAsset({id:'free',filename:'Free.mp3',kind:'audio',durationSec:9,fps:30,hasAudio:true,originalPath:'y',fingerprint:'f',status:'ready',license:{name:'CC0',source:'Openverse',page:'p'}} as any);
  const start=db.head(),music=(id:string,assetId:string)=>({id,assetId,srcIn:0,srcOut:8,start:{kind:'project',at:'start',offsetSec:0}});
  const v=db.writeVersion(TimelineSchema.parse({...db.timeline(),music:[music('m1','song'),music('m2','free')]}),start,'Added music','turn');db.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(v,'main');
  expect(newCredits(db,start)).toBe('Credits to include where you publish the video (their licenses ask for it):\n- '+license.attribution);
  // Already in the edit when a later request started: not listed again.
  expect(newCredits(db,v)).toBeUndefined();
 }finally{db.close();}
});
