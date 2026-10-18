/** Where an editing session's prompt tokens go. Every call re-reads the conversation so far, so a part's cost is its size
 * times the calls that carry it. Prints the fixed prefix of each role (system prompt and tools, as the code builds them
 * now) and, for each project folder, the share of re-read tokens by part: the fixed prefix as it was sent, the briefing,
 * each tool's results (images counted by their pixel size), the agent's own turns and engine notes.
 * Usage: tsx scripts/cost-anatomy.ts [project folder ...]. Works on a copy of each database, so an open project is fine. */
import {copyFileSync,existsSync,mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {codePrompt} from '../packages/orchestrator/src/code-prompt';
import {toolsFor,type AgentRole} from '../packages/orchestrator/src/code-tools';

const textTokens=(chars:number)=>chars/4;
/** Width and height from a base64 JPEG or PNG header. */
export function imageSize(base64:string):{width:number;height:number}|undefined{
 const bytes=Buffer.from(base64.slice(0,140_000),'base64');
 if(bytes[0]===0x89&&bytes[1]===0x50)return{width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 for(let i=2;i+9<bytes.length;){if(bytes[i]!==0xff){i++;continue;}const marker=bytes[i+1];if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker))return{height:bytes.readUInt16BE(i+5),width:bytes.readUInt16BE(i+7)};i+=2+bytes.readUInt16BE(i+2);}
}
/** The provider fits an image within 1568 px on its long edge and about 1.15 megapixels, then charts it at w×h/750 tokens. */
export function imageTokens(width:number,height:number){const s=Math.min(1,1568/Math.max(width,height),Math.sqrt(1_150_000/(width*height)));return Math.ceil(width*s*height*s/750);}
const blockTokens=(block:any):number=>{
 if(block?.type==='image'){const size=block.source?.data?imageSize(block.source.data):undefined;return size?imageTokens(size.width,size.height):1600;}
 if(block?.type==='tool_result'&&Array.isArray(block.content))return block.content.reduce((n:number,b:any)=>n+blockTokens(b),0);
 return textTokens(JSON.stringify(block).length);
};
const imagesIn=(block:any):number=>block?.type==='image'?blockTokens(block):block?.type==='tool_result'&&Array.isArray(block.content)?block.content.reduce((n:number,b:any)=>n+imagesIn(b),0):0;

export function fixedPrefix(){
 // Replies and plans are sent the editing agent's tools, so they share its prefix.
 const size=(system:string,role:AgentRole)=>{const tools=JSON.stringify(toolsFor(role));return{system:Math.round(textTokens(system.length)),tools:Math.round(textTokens(tools.length))};};
 return{editing:size(codePrompt,'solo')};
}

export function anatomy(folder:string){
 const copy=mkdtempSync(join(tmpdir(),'dream-cost-'));mkdirSync(join(copy,'.dream'));
 for(const suffix of ['','-wal','-shm'])if(existsSync(join(folder,'.dream','project.sqlite'+suffix)))copyFileSync(join(folder,'.dream','project.sqlite'+suffix),join(copy,'.dream','project.sqlite'+suffix));
 const db=new ProjectDB(copy);
 try{
  const usage=db.db.prepare('SELECT COUNT(*) AS calls,SUM(cost_usd) AS cost,SUM(cache_read) AS read,SUM(cache_write) AS write,SUM(input_tokens) AS input,SUM(output_tokens) AS output FROM ai_usage').get() as any;
  let fixed=0;for(const row of db.db.prepare("SELECT json FROM events WHERE type='ai.context'").all() as {json:string}[]){const c=JSON.parse(row.json);if(c.systemCharacters)fixed=textTokens(c.systemCharacters+c.toolCharacters);}
  const parts:Record<string,number>={},add=(part:string,n:number)=>{parts[part]=(parts[part]??0)+n;};let looks=0,lookTokens=0;
  for(const {key} of db.db.prepare("SELECT key FROM meta WHERE key LIKE 'code-agent:%:main' OR key LIKE 'code-agent:%:readonly%' OR key LIKE 'code-agent:%:reply%'").all() as {key:string}[]){
   const checkpoint=db.loadState<any>(key);if(!checkpoint?.messages)continue;
   const names:Record<string,string>={},messages:{role:string;parts:Record<string,number>}[]=[];
   for(const m of checkpoint.messages){
    const entry:Record<string,number>={},blocks=typeof m.content==='string'?[{type:'text',text:m.content}]:m.content;
    for(const b of blocks){
     let part:string;
     if(m.role==='assistant'){if(b.type==='tool_use')names[b.id]=b.name;part=b.type==='thinking'?'agent thinking':b.type==='tool_use'?'agent tool calls (code written)':'agent text';}
     else if(b.type==='tool_result'){const name=names[b.tool_use_id]??'?',images=imagesIn(b);if(images){entry[`images from ${name}`]=(entry[`images from ${name}`]??0)+images;if(name==='view_media'){looks++;lookTokens+=images;}}part='results of '+name;entry[part]=(entry[part]??0)+blockTokens(b)-images;continue;}
     else part=messages.length===0?'briefing (first message)':m.dreamSource?'engine notes':'user text';
     entry[part]=(entry[part]??0)+blockTokens(b);
    }
    messages.push({role:m.role,parts:entry});
   }
   // Each assistant message is one call, which read the fixed prefix and every message before it.
   messages.forEach((m,k)=>{if(m.role!=='assistant')return;add('fixed: system prompt and tools',fixed);for(const earlier of messages.slice(0,k))for(const [p,n] of Object.entries(earlier.parts))add(p,n);});
  }
  return{usage,fixedTokens:Math.round(fixed),parts,looks,tokensPerLook:looks?Math.round(lookTokens/looks):0};
 }finally{db.close();rmSync(copy,{recursive:true,force:true});}
}

if(process.argv[1]?.endsWith('cost-anatomy.ts')){
 const prefix=fixedPrefix();
 console.log('Fixed prefix now (tokens): '+Object.entries(prefix).map(([role,p])=>`${role} ${p.system}+${p.tools}=${p.system+p.tools}`).join(', '));
 for(const folder of process.argv.slice(2)){
  const a=anatomy(folder),u=a.usage,total=Object.values(a.parts).reduce((x,y)=>x+y,0);
  console.log(`\n${folder}\n  ${u.calls} calls, $${(u.cost??0).toFixed(2)}; average prompt ${Math.round((u.read+u.write+u.input)/Math.max(1,u.calls)/1000)}K tokens; fixed prefix as sent ${Math.round(a.fixedTokens/1000)}K; ${a.looks} looks at about ${a.tokensPerLook} image tokens each`);
  for(const [part,n] of Object.entries(a.parts).sort((x,y)=>y[1]-x[1]).slice(0,14))console.log(`  ${(100*n/total).toFixed(1).padStart(5)}%  ${part}`);
 }
}
