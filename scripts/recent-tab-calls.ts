/** The latest Gumbo for Chrome calls of one account, read-only from the gateway's database (dream_usage): when, which
 * model, and the gap since the call before, for studying how often Tab asks (no text is kept for these calls).
 *   npx tsx scripts/recent-tab-calls.ts <email> [--hours 6]
 * Needs DREAM_DB_PASSWORD in .env.local and the pooler address `supabase link` saved (as recent-edit-logs.ts does). */
import postgres from 'postgres';
import {readFileSync} from 'node:fs';

const args=process.argv.slice(2),flag=(name:string)=>{const n=args.indexOf('--'+name);return n<0?undefined:args[n+1];};
const email=args.find(a=>a.includes('@'));
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const url=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim());url.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
const sql=postgres(url.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{default_transaction_read_only:true,application_name:'gumbo-tab-calls'}});
try{
 const columns=(await sql`select column_name from information_schema.columns where table_schema='public' and table_name='dream_usage'`).map(c=>c.column_name);
 console.log('columns:',columns.join(', '));
 // Without an email: the accounts that made calls lately, to find the one in use.
 if(!email){for(const r of await sql`select u.email,count(*)::int as calls,max(d.created_at) as last from public.dream_usage d join auth.users u on u.id=d.user_id where d.created_at>now()-interval '6 hours' group by u.email order by last desc limit 10`)console.log(r.email,r.calls,new Date(r.last).toISOString());process.exit(0);}
 const [user]=await sql`select id from auth.users where lower(email)=lower(${email}) limit 1`;
 if(!user)throw new Error('No account with that email.');
 const since=new Date(Date.now()-Number(flag('hours')??6)*3_600_000);
 const rows=await sql`select * from public.dream_usage where user_id=${user.id} and created_at>=${since} order by created_at`;
 let last=0;
 for(const r of rows){const at=new Date(r.created_at).getTime();console.log(JSON.stringify({at:new Date(at).toISOString().slice(11,23),gapS:last?Math.round((at-last)/100)/10:null,model:r.model,purpose:r.purpose,status:r.status,cost:Number(r.cost_usd??0).toFixed(5),in:r.input_tokens,out:r.output_tokens,cacheRead:r.cache_read_tokens,cacheWrite:r.cache_write_tokens}));last=at;}
 console.log(`${rows.length} calls since ${since.toISOString()}`);
}finally{await sql.end();}
