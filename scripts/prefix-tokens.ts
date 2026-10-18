/** Exact token counts of the editing agent's fixed prefix (system prompt, Gumbo's tools, the web_search tool) from
 * Anthropic's free count_tokens endpoint, which runs no model. Usage: tsx scripts/prefix-tokens.ts [model] */
import {existsSync,readFileSync} from 'node:fs';
import {codePrompt} from '../packages/orchestrator/src/code-prompt';
import {toolsFor} from '../packages/orchestrator/src/code-tools';
import {webSearchTool} from '../packages/orchestrator/src/code-director';

const readEnv=(path:string)=>existsSync(path)?Object.fromEntries(readFileSync(path,'utf8').split(/\r?\n/).map(line=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{};
const key=process.env.ANTHROPIC_API_KEY??readEnv('.env.local').ANTHROPIC_API_KEY??readEnv('.secrets/anthropic.env').ANTHROPIC_API_KEY;
if(!key)throw new Error('ANTHROPIC_API_KEY is not available.');
const model=process.argv[2]??'claude-opus-5-5',messages=[{role:'user',content:'x'}];
async function count(body:object){
 const response=await fetch('https://api.anthropic.com/v1/messages/count_tokens',{method:'POST',headers:{'x-api-key':key!,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model,messages,...body})});
 const json:any=await response.json();if(!response.ok)throw new Error(JSON.stringify(json));return json.input_tokens as number;
}
const base=await count({}),solo=toolsFor('solo'),search=webSearchTool(model);
const rows:[string,number][]=[
 ['editor system prompt',await count({system:codePrompt})-base],
 [`editor tools (${solo.length})`,await count({tools:solo})-base],
 ['web_search tool',await count({tools:[search,...solo]})-await count({tools:solo})],
 ['editor prefix in all',await count({system:codePrompt,tools:[search,...solo]})-base],
];
for(const [name,n] of rows)console.log(String(n).padStart(7),' ',name);
if(process.argv.includes('--each'))for(const tool of solo)console.log(String(await count({tools:[tool]})-base).padStart(7),'   ',tool.name);
