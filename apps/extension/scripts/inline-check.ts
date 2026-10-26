/** A live look at Ctrl+K: a handful of instructions (edit, answer, act, write from nothing, translate) through this
 * repository's gateway code and the real model, printing the mode it chose and what it wrote. SPENDS a fraction of a cent.
 *   npx tsx apps/extension/scripts/inline-check.ts [--model=claude-haiku-5-5] */
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {handleAI} from '../../../supabase/functions/dream-gateway/ai';
import {INLINE_SYSTEM,inlineStable,inlineFresh} from '../src/shared/prompts';
import {actionOf} from '../src/background/inline-action';

const model=process.argv.find(a=>a.startsWith('--model='))?.split('=')[1]??'claude-haiku-5-5';
const root=resolve(import.meta.dirname,'../../..');
const env=(file:string)=>existsSync(file)?Object.fromEntries(readFileSync(file,'utf8').split(/\r?\n/).map(l=>/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l)).filter(Boolean).map(m=>[m![1],m![2].replace(/^["']|["']$/g,'')])):{} as Record<string,string>;
const key=process.env.ANTHROPIC_API_KEY??env(resolve(root,'.secrets/anthropic.env')).ANTHROPIC_API_KEY;
const db={rpc:async()=>({data:randomUUID()}),from:()=>({update:()=>({eq:async()=>({})})})};
const cases=[
 {instruction:'more formal',selection:'hey can u send me the deck before tmrw? need it for the call',inField:true,site:'mail.google.com'},
 {instruction:'shorten',selection:'I wanted to reach out and let you know that, after a lot of careful thought and discussion with the team, we have decided to move the launch from Thursday to the following Monday so that we have more time to test.',inField:true,site:'mail.google.com'},
 {instruction:'what does this mean?',selection:'The API is idempotent, so retrying a request with the same key never charges twice.',inField:false,site:'docs.stripe.com'},
 {instruction:'add to calendar',selection:'Design review moved to Thursday Nov 5 at 3pm in the Lisbon room',inField:false,site:'app.slack.com'},
 {instruction:"reply saying I can't make it but thanks",selection:'',inField:true,site:'mail.google.com'},
 {instruction:'translate to Spanish',selection:'Thanks for your patience, the order ships tomorrow.',inField:true,site:'mail.google.com'},
 {instruction:'find our last email with Priya',selection:'Priya Raman',inField:false,site:'mail.google.com'},
];
for(const c of cases){
 const stable=inlineStable({site:c.site,title:'',intent:c.inField?'email':undefined,label:c.inField?'Message Body':undefined,selection:c.selection,before:'',after:'',inField:c.inField,facts:{}});
 const fresh=inlineFresh({instruction:c.instruction,now:new Date(),timeZone:'America/New_York',memory:[]});
 const result=await handleAI({model,system:INLINE_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable},{type:'text',text:fresh}]}],max_tokens:600,purpose:'inline',stream:false,requestId:randomUUID()},'check',{db,key,timeoutMs:60_000});
 const text=(result.body?.content??[]).map((b:any)=>b.text??'').join('');
 const action=/^\s*ACT/.test(text)?actionOf(text):undefined;
 console.log(`\n▸ ${c.instruction}${c.selection?`  «${c.selection.slice(0,60)}»`:''}\n${text.trim()}${action?`\n  → ${action.label}${action.url?`\n  → ${action.url}`:''}`:''}`);
}
