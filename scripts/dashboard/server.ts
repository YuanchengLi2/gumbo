/** Spending dashboard: every AI call the gateway billed (all providers, all accounts) and every edit on this computer,
 * on one local page. Run `pnpm dashboard` and open http://127.0.0.1:4317.
 *
 * Gateway spend is read from the Supabase database's dream_usage table in a read-only session, with the password in
 * .env.local (DREAM_DB_PASSWORD) and the pooler address `supabase link` saved in supabase/.temp/pooler-url. Edits come
 * from each project's .dream/project.sqlite, copied first so a project the app has open is never locked or changed.
 * The page is served on 127.0.0.1 only; the database password never leaves this process. */
import {createServer} from 'node:http';
import {readFileSync,existsSync,readdirSync,copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,dirname,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import postgres from 'postgres';

const here=dirname(fileURLToPath(import.meta.url)),root=resolve(here,'../..');
const PORT=Number(process.env.DASHBOARD_PORT??4317);

function env(){
 const file=join(root,'.env.local');if(!existsSync(file))return {} as Record<string,string>;
 return Object.fromEntries(readFileSync(file,'utf8').split(/\r?\n/).filter(l=>/^[A-Z0-9_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
}

/** Which company a model's calls are billed by. */
export function providerOf(model:string){
 if(/^claude/.test(model))return 'Anthropic';if(/^gpt|^o\d/.test(model))return 'OpenAI';if(/^gemini/.test(model))return 'Google';
 if(/^deepseek/.test(model))return 'DeepSeek';if(/^whisper/.test(model))return 'Groq';return 'Other';
}

async function gateway(){
 const e=env(),poolerFile=join(root,'supabase/.temp/pooler-url');
 if(!e.DREAM_DB_PASSWORD||!existsSync(poolerFile))return {error:'Gateway spend needs DREAM_DB_PASSWORD in .env.local and a linked Supabase project (supabase link).',calls:[],accounts:[]};
 const url=new URL(readFileSync(poolerFile,'utf8').trim());url.password=encodeURIComponent(e.DREAM_DB_PASSWORD);
 const sql=postgres(url.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{default_transaction_read_only:true,application_name:'gumbo-dashboard'}});
 try{
  const [calls,accounts]=await Promise.all([
   sql`select u.id,u.user_id,u.request_id,u.turn_id,u.model,u.status,u.cost_usd::float8 cost,u.reserved_usd::float8 reserved,u.input_tokens,u.output_tokens,u.cache_read_tokens,u.cache_write_tokens,coalesce(u.audio_seconds,0)::float8 audio_seconds,u.error_code,u.provider_status,u.created_at from dream_usage u order by u.created_at limit 200000`,
   sql`select a.id,a.email,a.status,a.daily_budget_usd::float8 daily_budget,coalesce(a.is_guest,false) is_guest,a.created_at from dream_accounts a`]);
  return {calls:calls.map(c=>({...c,provider:providerOf(c.model),created_at:new Date(c.created_at).toISOString()})),accounts:[...accounts]};
 }catch(error){return {error:'Could not read gateway spend: '+(error as Error).message,calls:[],accounts:[]};}
 finally{await sql.end({timeout:2}).catch(()=>{});}
}

/** Every project folder this computer knows: the app's project lists, and the default projects folders. */
function projectFolders(){
 const appData=process.env.APPDATA??join(homedir(),'AppData/Roaming'),folders=new Map<string,string|undefined>();
 for(const profile of ['Dream','Gumbo','gumbo','dream']){const list=join(appData,profile,'projects.json');if(!existsSync(list))continue;
  try{const parsed=JSON.parse(readFileSync(list,'utf8'));for(const p of Array.isArray(parsed)?parsed:parsed.projects??[])if(p?.folder)folders.set(resolve(p.folder).toLowerCase(),p.folder);}catch{}}
 for(const name of ['Dream','Gumbo']){const dir=join(homedir(),'OneDrive/Documents',name,'Projects'),alt=join(homedir(),'Documents',name,'Projects');
  for(const base of [dir,alt])if(existsSync(base))for(const id of readdirSync(base)){const folder=join(base,id);if(!folders.has(folder.toLowerCase()))folders.set(folder.toLowerCase(),folder);}}
 return [...folders.values()].filter((f):f is string=>!!f&&existsSync(join(f,'.dream','project.sqlite')));
}

function readProject(folder:string){
 const temp=mkdtempSync(join(tmpdir(),'gumbo-dashboard-')),copy=join(temp,'project.sqlite'),src=join(folder,'.dream','project.sqlite');
 try{
  for(const ext of ['','-wal','-shm'])if(existsSync(src+ext))copyFileSync(src+ext,copy+ext);
  const db=new DatabaseSync(copy);
  try{
   const tables=new Set((db.prepare("select name from sqlite_master where type='table'").all() as {name:string}[]).map(t=>t.name));
   const meta=new Map((db.prepare('select key,value from meta').all() as {key:string;value:string}[]).map(r=>[r.key,r.value]));
   let name=folder.split(/[\\/]/).pop()!,id=name;try{const p=JSON.parse(meta.get('project')??'{}');name=p.name??name;id=p.id??id;}catch{}
   const messages=db.prepare('select role,text,turn_id,created_at from messages where turn_id is not null order by created_at,rowid').all() as {role:string;text:string;turn_id:string;created_at:string}[];
   const edits=new Map<string,any>();
   for(const m of messages){let edit=edits.get(m.turn_id);
    if(!edit){if(m.role!=='user')continue;let status='unknown';try{status=JSON.parse(meta.get('turn_activity:'+m.turn_id)??'{}').status??status;}catch{}
     let model=meta.get('agent-model:'+m.turn_id)??null,route:any=null;try{route=JSON.parse(meta.get('routing:'+m.turn_id)??'null');}catch{}
     edit={turnId:m.turn_id,request:m.text,at:m.created_at,status,model,modelChoice:meta.get('model-choice:'+m.turn_id)??null,work:route?.work??null,difficulty:route?.difficulty??null,reply:null as string|null,repliedAt:null as string|null};edits.set(m.turn_id,edit);}
    else if(m.role==='assistant'){edit.reply=m.text;edit.repliedAt=m.created_at;}}
   const calls=tables.has('ai_usage')?(db.prepare('select request_id,turn_id,model,purpose,phase,input_tokens,cache_read,cache_write,output_tokens,cost_usd cost,duration_ms,stop_reason,created_at from ai_usage order by created_at').all() as any[]):[];
   return {id,name,folder,edits:[...edits.values()],calls};
  }finally{db.close();}
 }catch(error){return {id:folder,name:folder.split(/[\\/]/).pop()!,folder,edits:[],calls:[],error:(error as Error).message};}
 finally{rmSync(temp,{recursive:true,force:true});}
}

async function data(){
 const started=Date.now(),[remote,projects]=await Promise.all([gateway(),Promise.resolve(projectFolders().map(readProject))]);
 return {generatedAt:new Date().toISOString(),tookMs:Date.now()-started,gateway:remote,projects};
}

const page=()=>readFileSync(join(here,'index.html'),'utf8');
createServer(async(req,res)=>{
 try{
  if(req.url==='/'||req.url==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page());return;}
  if(req.url==='/api/data'){const body=JSON.stringify(await data());res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);return;}
  res.writeHead(404).end('Not found');
 }catch(error){res.writeHead(500,{'Content-Type':'text/plain'}).end((error as Error).message);}
}).listen(PORT,'127.0.0.1',()=>console.log(`Spending dashboard: http://127.0.0.1:${PORT}`));
