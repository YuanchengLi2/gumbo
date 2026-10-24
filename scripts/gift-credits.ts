/** Gives an account free credits (a 'gift' grant that never expires), once: the source names the gift, and a source is
 * granted only one time, so running it again (or every day until the person signs up) never gives twice.
 *   npx tsx scripts/gift-credits.ts <email> <credits> <source>     e.g. ... genemans@hotmail.com 300 gift:welcome:genemans
 * Prints "granted", "already granted" or "no account yet" (the email has not signed in to Gumbo). Also marks their
 * waitlist entry invited. Needs DREAM_DB_PASSWORD in .env.local and the pooler address `supabase link` saved. */
import postgres from 'postgres';
import {readFileSync} from 'node:fs';

const [email,amount,source]=process.argv.slice(2),credits=Number(amount);
if(!email?.includes('@')||!(credits>0)||!source)throw new Error('Usage: gift-credits.ts <email> <credits> <source>');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const url=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim());url.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
const sql=postgres(url.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{application_name:'gumbo-gift-credits'}});
try{
 const [account]=await sql`select id from public.dream_accounts where lower(email)=lower(${email}) limit 1`;
 if(!account){console.log('no account yet');}
 else{
  const [{granted}]=await sql`select public.dream_grant_credits(${account.id},'gift',null,${credits},${source},now(),null) as granted`;
  await sql`update public.dream_waitlist set invited_at=coalesce(invited_at,now()) where email=lower(${email})`;
  console.log(granted?'granted':'already granted');
 }
}finally{await sql.end();}
