import {model} from './model';
import {tabRequest,emptyRecall,TAB_SYSTEM,LEAN_TAB_SYSTEM} from '../shared/prompts';
import {cleanSuggestion,lastWordOf,alternativesOf} from '../shared/suggestion';
import type {FieldContext} from '../content/context';
/** Which model Tab should run on, measured from this computer through the real gateway: the same Tab prompt for each of a
 * set of moments (messages, a search box, an AI's prompt box, a form, a finished text), each model in turn, timed to its
 * first word and to the end, with what it wrote (cleaned as the page would show it) and whether it said the text is
 * done. A debug tool (the local log page asks for it); it spends a cent or two. */
type Case={name:string;context:Partial<FieldContext>;before:string;after?:string;expect:string};
const msg=(author:string,text:string)=>({author,text});
const CASES:Case[]=[
 {name:'email to teacher',context:{site:'mail.google.com',title:'Compose',intent:'email',label:'Message Body',singleLine:false,thread:[msg('Ms. Lee','Reminder: the Federalist 10 essay is due Friday. Office hours Thursday 3-4pm.')]},before:'Hi Ms. Lee,\n\nI wanted to ask if I could come to office hours on ',expect:'Thursday (from the thread)'},
 {name:'reply in chat',context:{site:'discord.com',title:'#study-group',intent:'chat',label:'Message #study-group',singleLine:true,thread:[msg('Sam','anyone wanna study for the apush test tmrw?')]},before:'yeah im down, ',expect:'short casual reply, their voice'},
 {name:'AI prompt box',context:{site:'google.com',title:'AI Mode',intent:'prompt',label:'Ask anything',singleLine:true,page:'AI Mode answer: In a textarea, pressing Tab moves focus to the next element by default. You can intercept it with a keydown listener and preventDefault.'},before:'how do i stop tab from ',expect:'finishes THEIR question, ends with done'},
 {name:'search box',context:{site:'google.com',title:'Google',intent:'search',label:'Search',singleLine:true},before:'federalist 10 summ',expect:'summary (one line)'},
 {name:'youtube search',context:{site:'youtube.com',title:'YouTube',intent:'search',label:'Search',singleLine:true},before:'ap gov unit 1 rev',expect:'review'},
 {name:'finished reply',context:{site:'mail.google.com',title:'Re: Saturday',intent:'email',label:'Message Body',singleLine:false,thread:[msg('Alex','Are you still good for Saturday at 2?')]},before:'Yes, still good for Saturday at 2! See you then.',expect:'empty + done'},
 {name:'comment',context:{site:'reddit.com',title:'r/APStudents',intent:'comment',label:'Add a comment',singleLine:false,thread:[msg('u/kel','Is Barron\'s or Princeton better for APUSH?')]},before:'I used Princeton and ',expect:'their opinion, short'},
 {name:'doc sentence',context:{site:'docs.google.com',title:'Federalist 10 essay',intent:'document',label:'Document',singleLine:false,headings:['Federalist 10: Factions']},before:'In Federalist No. 10, Madison argues that a large republic ',expect:'continues the argument, one sentence'},
 {name:'form name',context:{site:'forms.gle',title:'Club signup',intent:'form',label:'Full name',singleLine:true,form:[{label:'Email',value:''}]},before:'',expect:'empty (no name known)'},
 {name:'mid-word',context:{site:'mail.google.com',title:'Compose',intent:'email',label:'Message Body',singleLine:false},before:'Thanks for the reminder, I apprec',expect:'iate it'},
 {name:'spanish',context:{site:'classroom.google.com',title:'Spanish 2',intent:'comment',label:'Private comment',singleLine:false,language:'es'},before:'Hola profesora, tengo una pregunta sobre ',expect:'Spanish continuation'},
 {name:'yt search, whole',context:{site:'youtube.com',title:'YouTube',intent:'search',label:'Search',singleLine:true},before:'can thragg beat sukuna in a fight',expect:'done (nothing more)'},
 {name:'yt search, open',context:{site:'youtube.com',title:'YouTube',intent:'search',label:'Search',singleLine:true},before:'gothamchess vs ',expect:'a likely opponent or stop'},
 {name:'gemini prompt',context:{site:'gemini.google.com',title:'Gemini',intent:'prompt',label:'Enter a prompt here',singleLine:false,page:'Gemini: Claude Haiku 5.5 and GPT-6 Luna are both small fast models...'},before:'which is better for a browser extension that ',expect:'their question, short'},
 {name:'canvas discussion',context:{site:'rchs.instructure.com',title:'Constitution XI: Types of Democracy',intent:'post',label:'Reply',singleLine:false,page:'Prompt: Explain the difference between participatory, pluralist and elite democracy, with one example of each.'},before:'Participatory democracy is when ',expect:'defines it, their words'},
];
/** What is compared: a model, with a Tab prompt (the long assistant-style one, or the lean completion one). */
export const COMPARE=[{name:'gpt-oss',model:'cerebras-oss',system:LEAN_TAB_SYSTEM},{name:'qwen',model:'cerebras-qwen',system:LEAN_TAB_SYSTEM},{name:'haiku',model:'claude-haiku-5-5',system:LEAN_TAB_SYSTEM}];
void TAB_SYSTEM;
export async function compareModels(variants=COMPARE){
 const rows:{case:string;expect:string;model:string;firstMs?:number;totalMs:number;text:string;done:boolean;error?:string}[]=[];
 for(const c of CASES){
  const context={site:'',url:`https://${c.context.site}/`,title:'',language:'en',editor:'contenteditable',singleLine:false,intent:'other',label:'',...c.context} as FieldContext;
  const after=c.after??'';
  for(const v of variants){
   const m=v.name,{system,messages,known}=tabRequest(context,c.before,after,emptyRecall(),undefined,v.system);
   const started=performance.now();let first:number|undefined,raw='';
   try{
    const {message}=await model({model:v.model,system,messages,max_tokens:context.singleLine?70:110,purpose:'tab'},{onEvent:event=>{if(event.data?.type==='content_block_delta'&&event.data.delta?.type==='text_delta'){first??=performance.now()-started;raw+=event.data.delta.text;}}});
    raw||=(message?.content??[]).map((b:any)=>b.text??'').join('');
    const done=(raw.split('⟂')[0]??'').includes('∎'),[best='']=alternativesOf(raw.replace(/∎/g,''));
    const text=cleanSuggestion(best,{before:c.before,after,singleLine:context.singleLine,known,final:true,lastWord:lastWordOf(c.before)});
    rows.push({case:c.name,expect:c.expect,model:m,firstMs:first&&Math.round(first),totalMs:Math.round(performance.now()-started),text,done});
   }catch(error){rows.push({case:c.name,expect:c.expect,model:m,totalMs:Math.round(performance.now()-started),text:'',done:false,error:(error as Error).message});}
  }
 }
 return rows;
}
