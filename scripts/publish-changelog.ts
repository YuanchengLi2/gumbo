/** Publishes CHANGELOG.md's entries to usegumbo.app/community as updates (dream_community_posts, kind 'update'), once
 * each: an entry already there is updated in place, keeping its replies and votes. Entries are dated at noon UTC, the
 * newest of a day last, so the page lists them as the file does.
 *   npx tsx scripts/publish-changelog.ts            (prints what it would publish)
 *   npx tsx scripts/publish-changelog.ts --publish  (writes to the live database)
 * Needs DREAM_DB_PASSWORD in .env.local and the pooler address `supabase link` saved (as scripts/recent-edit-logs.ts). */
import postgres from 'postgres';
import {readFileSync} from 'node:fs';

export type Entry={slug:string;date:string;title:string;body:string;createdAt:string};
export function changelogEntries(text:string):Entry[]{
 const entries:Entry[]=[],blocks=text.split(/^## /m).slice(1);
 for(const block of blocks){
  const [heading,...rest]=block.split('\n'),m=/^(\d{4}-\d{2}-\d{2})\s+·\s+(.+?)\s*$/.exec(heading);
  if(!m)throw new Error(`A changelog heading must be "## YYYY-MM-DD · Title": ${heading}`);
  const slug=`${m[1]}-${m[2].toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}`.slice(0,120);
  entries.push({slug,date:m[1],title:m[2],body:rest.join('\n').trim(),createdAt:''});
 }
 // Within a day the file lists the newest first: it gets the latest time.
 const byDay=new Map<string,Entry[]>();for(const e of entries)byDay.set(e.date,[...(byDay.get(e.date)??[]),e]);
 for(const day of byDay.values())day.forEach((e,n)=>{e.createdAt=new Date(Date.parse(`${e.date}T12:00:00Z`)+(day.length-n)*60_000).toISOString();});
 if(new Set(entries.map(e=>e.slug)).size!==entries.length)throw new Error('Two changelog entries share a date and title.');
 return entries;
}

if(import.meta.url===`file:///${process.argv[1]?.replace(/\\/g,'/')}`||process.argv[1]?.endsWith('publish-changelog.ts')){
 const entries=changelogEntries(readFileSync('CHANGELOG.md','utf8'));
 if(!process.argv.includes('--publish')){for(const e of entries)console.log(`${e.createdAt}  ${e.slug}\n  ${e.title} (${e.body.length} characters)`);console.log(`\n${entries.length} entries. Add --publish to write them to the live database.`);}
 else{
  const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
  const url=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim());url.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
  const sql=postgres(url.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{application_name:'gumbo-changelog'}});
  try{
   for(const e of entries)await sql`insert into public.dream_community_posts(kind,title,body,slug,created_at) values('update',${e.title},${e.body},${e.slug},${e.createdAt})
    on conflict(slug) do update set title=excluded.title,body=excluded.body`;
   console.log(`Published ${entries.length} entries.`);
  }finally{await sql.end();}
 }
}
