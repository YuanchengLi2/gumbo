import {add} from './db';
import {invalidate} from './recall';
import {model} from './model';
import {token} from './auth';
import {endpoints} from '../shared/config';
import {gatewayGet} from '../shared/gateway';
import {loadSettings,saveSettings,type Settings} from '../shared/settings';
/** What the user already has, brought in: their Gumbo profile (name, what they make) when they sign in, and what another
 * assistant (ChatGPT, Claude) remembers about them, pasted in. A fact the user already set is never overwritten. */
async function mergeFacts(found:Partial<Settings['facts']>){
 const settings=await loadSettings(),facts={...settings.facts};
 for(const [key,value] of Object.entries(found) as [keyof Settings['facts'],string|undefined][])if(value&&!facts[key])facts[key]=value.slice(0,300);
 await saveSettings({facts});return facts;
}
export async function importProfile(){
 const bearer=await token();if(!bearer)return{};
 const {gateway}=await endpoints();
 const profile=await gatewayGet(gateway,bearer,'profile').catch(()=>null) as {name?:string;makes?:string[]}|null;
 if(!profile)return{};
 return mergeFacts({name:profile.name||undefined,other:profile.makes?.length?`Makes: ${profile.makes.join(', ')}`:undefined});
}
/** Another assistant's memory of the user: each statement kept as a note (searchable, used by every surface), and the
 * facts Tab may use (name, sign-off, email, a line about them) picked out by Haiku. */
export async function importAssistantMemory(text:string){
 const lines=text.split(/\r?\n+/).map(l=>l.replace(/^\s*[-*•\d.)]+\s*/,'').trim()).filter(l=>l.length>=4).slice(0,500);
 for(const line of lines)await add('notes',{text:line,title:'From your other assistant\'s memory',at:Date.now(),source:'import'});
 invalidate();
 let facts:Partial<Settings['facts']>={};
 try{
  const settings=await loadSettings();
  const {message}=await model({model:settings.models.notes,system:'From what an AI assistant remembers about a person, pick out: their name, how they sign off messages, their email address, and one short line about them that helps write in their voice (job, what they work on). Reply with one JSON object with the keys name, signOff, email, other, leaving out what is not there.',messages:[{role:'user',content:lines.join('\n').slice(0,20_000)}],max_tokens:300,purpose:'action',stream:false});
  const reply=(message?.content??[]).map((b:any)=>b.text??'').join(''),json=/\{[\s\S]*\}/.exec(reply)?.[0];
  if(json){const parsed=JSON.parse(json);facts={name:parsed.name,signOff:parsed.signOff,email:parsed.email,other:parsed.other};}
 }catch{}
 return{notes:lines.length,facts:await mergeFacts(facts)};
}
