/** Prints the briefing (first message) the agent got for a request, piece by piece with sizes, from a copy of the project database.
 *   pnpm exec tsx scripts/briefing-preview.ts "C:/Users/you/Documents/Dream/Projects/<id>" <turnId prefix>
 */
import {mkdtempSync,mkdirSync,copyFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
const [folder,prefix]=process.argv.slice(2);
const copy=mkdtempSync(join(tmpdir(),'gumbo-briefing-'));mkdirSync(join(copy,'.dream'));
for(const f of ['project.sqlite','project.sqlite-wal','project.sqlite-shm'])if(existsSync(join(folder,'.dream',f)))copyFileSync(join(folder,'.dream',f),join(copy,'.dream',f));
const db=new ProjectDB(copy,'Briefing');
try{
 const key=(db.db.prepare("SELECT key FROM meta WHERE key LIKE ? AND key LIKE '%:main' ORDER BY rowid DESC LIMIT 1").get(`code-agent:${prefix}%`) as any)?.key;
 const first=db.loadState<any>(key)?.messages?.[0]?.content;const blocks:any[]=typeof first==='string'?[{type:'text',text:first}]:first;
 console.log('blocks',blocks.map(b=>`${b.type}:${(b.text??'').length}`).join(', '));
 const text:string=blocks[0].text,start=text.indexOf('{');
 // The end of the JSON object that starts at start (strings and escapes respected).
 let depth=0,inString=false,end=start;for(let i=start;i<text.length;i++){const ch=text[i];if(inString){if(ch==='\\')i++;else if(ch==='"')inString=false;continue;}if(ch==='"')inString=true;else if(ch==='{')depth++;else if(ch==='}'){depth--;if(!depth){end=i+1;break;}}}
 const brief=JSON.parse(text.slice(start,end));
 console.log('briefing JSON',end-start,'chars | before:',JSON.stringify(text.slice(0,start)),'| after:',JSON.stringify(text.slice(end)).slice(0,1500));
 for(const b of blocks.slice(1))console.log('next block:',JSON.stringify(b.text??b.type).slice(0,400));
 const walk=(o:any,path:string,depth:number)=>{for(const [k,v] of Object.entries(o)){const s=JSON.stringify(v)??'';console.log(`${'  '.repeat(depth)}${path}${k}: ${s.length} chars${s.length<160?'  '+s:''}`);if(v&&typeof v==='object'&&!Array.isArray(v)&&depth<2&&s.length>400)walk(v,'',depth+1);}};
 walk(brief,'',0);
 const second:string=blocks[1]?.text??'',at=second.indexOf('Project context: ');console.log('REQUEST TEXT:',JSON.stringify(second.slice(0,at)).slice(0,700));
 if(at>=0){console.log('--- project context');walk(JSON.parse(second.slice(at+17)),'',0);}
}finally{db.close();}
