import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';

it('starts the reads of one response together, records them in order, and never runs a read ahead of an earlier write',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-parallel-')));let running=0,peak=0;const order:string[]=[];
 try{
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));
  const workspace={initialize:async()=>{},context:()=>({}),execute:async(name:string,input:any)=>{order.push('start '+(input.assetId??input.path));running++;peak=Math.max(peak,running);await new Promise(r=>setTimeout(r,name==='read_transcript'?60:5));running--;order.push('end '+(input.assetId??input.path));return{text:name+' '+(input.assetId??input.path)};}};
  let n=0;const seen:any[]=[];
  await codeAgent({db,workspace:workspace as any,turnId:'turn',text:'Cut the best moments',model:'claude-haiku-5-5',role:'solo',signal:new AbortController().signal,publish:()=>{},infer:async(_m,_s,messages:any)=>{seen.push(messages.at(-1));n++;
   if(n===1)return{content:[{type:'tool_use',id:'t1',name:'read_transcript',input:{assetId:'a'}},{type:'tool_use',id:'t2',name:'read_transcript',input:{assetId:'b'}},{type:'tool_use',id:'t3',name:'read_transcript',input:{assetId:'c'}}]};
   if(n===2)return{content:[{type:'tool_use',id:'w',name:'write_file',input:{path:'src/x.tsx',content:'x'}},{type:'tool_use',id:'r',name:'read_file',input:{path:'src/x.tsx'}}]};
   return{content:[{type:'tool_use',id:'f',name:'finish',input:{status:'blocked',summary:'Stopped for the test.',nextAction:'None.'}}]};}});
  expect(peak).toBe(3);
  expect(seen[1].content.map((r:any)=>r.tool_use_id)).toEqual(['t1','t2','t3']);expect(seen[1].content.map((r:any)=>JSON.parse(r.content).text)).toEqual(['read_transcript a','read_transcript b','read_transcript c']);
  expect(order.slice(-4)).toEqual(['start src/x.tsx','end src/x.tsx','start src/x.tsx','end src/x.tsx']);
 }finally{db.close();}
});
