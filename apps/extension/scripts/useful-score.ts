/** The usefulness suite's scoreboard (test/e2e/useful.spec.ts): from a run's results (one JSON line per moment), how often
 * Tab was useful, how often it showed something wrong, how often memory brought the fact a moment needed, how fast words
 * and moves showed, how many requests a moment made and what it cost. Printed, and saved to artifacts/tab-useful/ so runs
 * can be compared as Tab changes. With a second file, the moments whose verdict changed are listed.
 *   npx tsx apps/extension/scripts/useful-score.ts <results.jsonl> [<earlier.jsonl>]
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,basename} from 'node:path';

type Row={name:string;setting:string;verdict:string;text:string;move:string;firstTextMs?:number;firstMoveMs?:number;reached?:boolean;usd:number;prompt?:string;calls:{purpose:string;model:string;firstMs?:number}[]};
// The last line for each moment counts (a moment run again replaces the one before).
const load=(file:string)=>[...new Map(readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l) as Row).map(r=>[r.name,r])).values()];
const pct=(xs:(number|undefined)[],p:number)=>{const y=xs.filter((x):x is number=>typeof x==='number').sort((a,b)=>a-b);return y.length?y[Math.min(y.length-1,Math.floor(p*y.length))]:undefined;};
export function score(rows:Row[]){
 const facts=rows.filter(r=>r.reached!==undefined),models=new Map<string,(number|undefined)[]>();
 for(const r of rows)for(const c of r.calls)if(c.purpose==='tab'||c.purpose==='action'){const k=`${c.purpose} ${c.model}`;models.set(k,[...(models.get(k)??[]),c.firstMs]);}
 return{moments:rows.length,useful:rows.filter(r=>r.verdict==='useful').length,wrongShown:rows.filter(r=>r.verdict==='wrong').length,
  factReached:`${facts.filter(r=>r.reached).length}/${facts.length}`,
  wordsShownMs:{p50:pct(rows.map(r=>r.firstTextMs),.5),p90:pct(rows.map(r=>r.firstTextMs),.9)},movesShownMs:{p50:pct(rows.map(r=>r.firstMoveMs),.5),p90:pct(rows.map(r=>r.firstMoveMs),.9)},
  firstTokenMs:Object.fromEntries([...models].map(([k,xs])=>[k,{p50:pct(xs,.5),p90:pct(xs,.9),n:xs.length}])),
  textRequestsPerMoment:pct(rows.map(r=>r.calls.filter(c=>c.purpose==='tab').length),.5),usd:+rows.reduce((s,r)=>s+r.usd,0).toFixed(4),
  bySetting:Object.fromEntries([...new Set(rows.map(r=>r.setting))].map(s=>{const of=rows.filter(r=>r.setting===s);return[s,`${of.filter(r=>r.verdict==='useful').length}/${of.length}`];}))};
}
const [file,earlier]=process.argv.slice(2);
if(!file)throw new Error('Give a results file: useful-score.ts <results.jsonl> [<earlier.jsonl>]');
const rows=load(file),board=score(rows);
console.log(JSON.stringify(board,null,1));
for(const r of rows)console.log(`${r.verdict.padEnd(44)} ${r.name}`);
if(earlier){
 const before=new Map(load(earlier).map(r=>[r.name,r.verdict]));
 console.log('\nChanged since the earlier run:');
 for(const r of rows){const was=before.get(r.name);if(was!==undefined&&was!==r.verdict)console.log(`  ${r.name}: ${was} → ${r.verdict}`);}
}
const dir=resolve(import.meta.dirname,'../../../artifacts/tab-useful');mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,`${basename(file).replace(/\.jsonl$/,'')}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`),JSON.stringify({file,board,rows:rows.map(({calls,prompt,...r})=>({...r,calls:calls.length}))},null,1));
