/** Renames a published changelog update in place (dream_community_posts, kind 'update'), keeping its replies and votes:
 * for an entry whose title changed after it was published, since publish-changelog.ts knows entries by a slug made from
 * the title and would add the new title as a second update.
 *   npx tsx scripts/rename-changelog-post.ts <old-slug> <new-slug>            (prints what it would change)
 *   npx tsx scripts/rename-changelog-post.ts <old-slug> <new-slug> --publish  (writes to the live database)
 * The new title and text come from CHANGELOG.md. Needs what publish-changelog.ts needs. */
import postgres from 'postgres';
import {readFileSync} from 'node:fs';
import {changelogEntries} from './publish-changelog';

const [from,to]=process.argv.slice(2).filter(a=>!a.startsWith('--'));
if(!from||!to)throw new Error('Give the old slug and the new one.');
const entry=changelogEntries(readFileSync('CHANGELOG.md','utf8')).find(e=>e.slug===to);
if(!entry)throw new Error(`CHANGELOG.md has no entry with the slug ${to}.`);
if(!process.argv.includes('--publish')){console.log(`${from}\n -> ${to}\n ${entry.title} (${entry.body.length} characters)\nAdd --publish to write it.`);process.exit(0);}
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)]));
const url=new URL(readFileSync('supabase/.temp/pooler-url','utf8').trim());url.password=encodeURIComponent(env.DREAM_DB_PASSWORD??'');
const sql=postgres(url.toString(),{ssl:'require',max:1,idle_timeout:5,connect_timeout:15,connection:{application_name:'gumbo-changelog'}});
try{
 const rows=await sql`update public.dream_community_posts set slug=${to},title=${entry.title},body=${entry.body} where slug=${from} and kind='update' returning id`;
 console.log(rows.length?`Renamed ${from} to ${to}.`:`No update has the slug ${from}.`);
}finally{await sql.end();}
