/** Replays a finished request's conversation step by step as DeepSeek received it (the provider view, then the gateway's
 * Chat Completions form, or with --messages its Messages form, thinking included) and prints each step where the request
 * stopped being the previous one plus new messages: the part after that point was billed at the full input price instead
 * of the cache price. Reads a copy of the database, so a project open in Gumbo is never touched.
 *
 *   pnpm exec tsx scripts/cache-replay.ts "C:/Users/you/Documents/Dream/Projects/<id>" <turnId> [--messages]
 */
import {mkdtempSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {withoutSeenImages} from '../packages/orchestrator/src/conversation';
import {chatRequest,messagesRequest} from '../supabase/functions/dream-gateway/providers';

const [folder,turn]=process.argv.slice(2).filter(a=>a!=='--messages'),messagesRoute=process.argv.includes('--messages');if(!folder||!turn){console.error('Give a project folder and a turn id.');process.exit(1);}
const copy=mkdtempSync(join(tmpdir(),'gumbo-cache-replay-'));mkdirSync(join(copy,'.dream'));
for(const file of ['project.sqlite','project.sqlite-wal','project.sqlite-shm'])if(existsSync(join(folder,'.dream',file)))copyFileSync(join(folder,'.dream',file),join(copy,'.dream',file));
const db=new ProjectDB(copy,'Replay');
const short=(s:string)=>s.replace(/data:[^"]{40,}/g,m=>m.slice(0,30)+'…').slice(0,220);
try{
 const turnId=(db.db.prepare("SELECT key FROM meta WHERE key LIKE ? LIMIT 1").get(`code-agent:${turn}%:main`) as any)?.key?.split(':')[1]??turn;
 const messages=db.loadState<any>(`code-agent:${turnId}:main`)?.messages as any[];if(!messages){console.error('No saved conversation for that turn.');process.exit(1);}
 const model={provider:'deepseek',api:'chat',price:[.3,1.2],cachedRead:.006,vision:true,reasoning:false} as any;
 let previous:string[]|undefined,steps=0,changes=0,missedBytes=0;
 for(let i=1;i<=messages.length;i++){
  if(i<messages.length&&messages[i].role!=='assistant')continue;
  const body={system:'',messages:withoutSeenImages(messages.slice(0,i)),tools:[]};
  const wire=(messagesRoute?messagesRequest(body,{...model,api:'messages'},1000).messages:chatRequest(body,model,1000).messages).map(m=>JSON.stringify(m));steps++;
  if(previous){
   const n=Math.min(previous.length,wire.length);let j=0;while(j<n&&previous[j]===wire[j])j++;
   if(j<previous.length){
    // What was re-sent: the changed message from where it differs, and every message after it (pictures counted as about
    // 1,500 characters of text each, not their encoded size).
    const text=(m:string)=>m.replace(/data:[^"]+/g,()=>'x'.repeat(1500));let k=0;const was=text(previous[j]),now=text(wire[j]??'');while(k<was.length&&was[k]===now[k])k++;
    const lost=was.length-k+previous.slice(j+1).reduce((sum,m)=>sum+text(m).length,0);changes++;missedBytes+=lost;
    console.log(`step ${steps}: message ${j} of ${previous.length} changed, about ${Math.round(lost/3500)}K tokens after it re-sent`);
    console.log('   was: '+short(previous[j]));console.log('   now: '+short(wire[j]??'(gone)'));
   }
  }
  previous=wire;
 }
 console.log(`${steps} steps, ${changes} broke the prefix, about ${Math.round(missedBytes/3500)}K tokens re-sent in all`);
}finally{db.close();}
