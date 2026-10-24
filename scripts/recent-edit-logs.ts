/** The latest edit logs of one account, read-only from the gateway's database (dream_edit_logs), for studying how Roux
 * did: each run's request, how it ended, time, cost, calls and tool errors; with --turn, that run's steps.
 *   npx tsx scripts/recent-edit-logs.ts <email> [--limit 5] [--turn <turn id>] [--out file.json]
 * Needs DREAM_DB_PASSWORD in .env.local and the pooler address `supabase link` saved (as scripts/dashboard does). */
import postgres from 'postgres';
import {readFileSync,writeFileSync} from 'node:fs';

const args=process.argv.slice(2),flag=(name:string)=>{const n=args.indexOf('--'+name);return n<0?undefined:args[n+1];};
const email=args.find(a=>a.includes('@'));if(!email)throw new Error('Usage: recent-edit-logs.ts <email> [--limit 5] [--turn id] [--out file]');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const url=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim());url.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
const sql=postgres(url.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{default_transaction_read_only:true,application_name:'gumbo-edit-logs'}});
try{
 const [user]=await sql`select id from auth.users where lower(email)=lower(${email}) limit 1`;
 if(!user)throw new Error('No account with that email.');
 const turn=flag('turn');
 if(!turn){
  const rows=await sql`select turn_id,created_at,platform,app_version,project,left(request,300) as request,status,round(cost_usd::numeric,3) as cost,calls,tool_calls,tool_errors,round(duration_ms/1000.0) as seconds,models from public.dream_edit_logs where user_id=${user.id} order by created_at desc limit ${Number(flag('limit')??5)}`;
  for(const r of rows)console.log(JSON.stringify(r));
 }else{
  const [row]=await sql`select log from public.dream_edit_logs where user_id=${user.id} and turn_id=${turn} order by created_at desc limit 1`;
  if(!row)throw new Error('No such run.');
  const out=flag('out');if(out){writeFileSync(out,JSON.stringify(row.log,null,1));console.log('saved',out);}
  else console.log(JSON.stringify(row.log).slice(0,4000));
 }
}finally{await sql.end();}
