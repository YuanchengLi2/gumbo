// Deletes the temporary test accounts scripts/eval-roux.ts makes (roux-eval-…@example.invalid) that a stopped run left
// behind on the live project. Needs the Supabase CLI logged in, and DREAM_DB_PASSWORD in .env.local with the pooler
// address `supabase link` saved.  npx tsx scripts/remove-eval-accounts.ts
import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import postgres from 'postgres';

const ref=readFileSync('supabase/.temp/project-ref','utf8').trim(),base=`https://${ref}.supabase.co`;
const keys=JSON.parse(execSync(`npx supabase projects api-keys --project-ref ${ref} --output json`,{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const service=keys.find((k:any)=>k.name==='service_role')?.api_key;if(!service)throw new Error('Could not read the project keys.');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const url=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim());url.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
const sql=postgres(url.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15});
try{
 const rows=await sql`select id,email from auth.users where email like 'roux-eval-%@example.invalid'`;
 for(const {id,email} of rows){const response=await fetch(`${base}/auth/v1/admin/users/${id}`,{method:'DELETE',headers:{apikey:service,Authorization:'Bearer '+service}});console.log(`${email}: ${response.ok?'deleted':`failed (${response.status})`}`);}
 if(!rows.length)console.log('No test accounts left.');
}finally{await sql.end();}
