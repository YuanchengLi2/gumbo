/** Exact token counts of Roux's fixed prefix (the system prompt and the tools) from Anthropic's free count_tokens endpoint,
 * which runs no model. Usage: tsx scripts/prefix-tokens.ts [model] [--each] */
import {existsSync,readFileSync} from 'node:fs';
import {systemPrompt,toolDefinitions} from '../packages/agent/src/index';

const readEnv=(path:string)=>existsSync(path)?Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).map(line=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{};
const key=process.env.ANTHROPIC_API_KEY??readEnv('.env.local').ANTHROPIC_API_KEY??readEnv('.secrets/anthropic.env').ANTHROPIC_API_KEY;
if(!key)throw new Error('ANTHROPIC_API_KEY is not available.');
const model=process.argv[2]?.startsWith('claude')?process.argv[2]:'claude-sonnet-5-5',messages=[{role:'user',content:'x'}];
async function count(body:object){
 const response=await fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',headers:{'x-api-key':key!,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,messages,...body})});
 const json:any=await response.json();if(!response.ok)throw new Error(JSON.stringify(json));return json.input_tokens as number;
}
const base=await count({}),system=systemPrompt(model),tools=toolDefinitions();
const rows:[string,number][]=[
 ['system prompt',await count({system})-base],
 [`tools (${tools.length})`,await count({tools})-base],
 ['prefix in all',await count({system,tools})-base],
];
for(const [name,n] of rows)console.log(String(n).padStart(7),' ',name);
if(process.argv.includes('--each'))for(const tool of tools)console.log(String(await count({tools:[tool]})-base).padStart(7),'   ',tool.name);
