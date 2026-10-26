import {model} from './model';
import {recent,db} from './db';
import {loadSettings} from '../shared/settings';
import {tabRequest,emptyRecall} from '../shared/prompts';
import {cleanSuggestion,lastWordOf,agreed} from '../shared/suggestion';
import {momentsFrom,score,summarize,type Sample,type Summary} from '../shared/meter';
/** Tab's accuracy on the user's own writing: moments are cut from what they wrote, Tab predicts each one exactly as it
 * would while they type (the same prompt, memory and checks, two predictions agreeing), and the predictions are scored
 * against what they actually wrote next. A check costs about a cent. The result is kept, so the popup can show it. */
export async function measureTab(count=30):Promise<Summary&{at:number}|{error:string}>{
 const settings=await loadSettings(),mine=(await recent('writing',400)).filter(w=>w.text.length>=40);
 if(mine.length<5)return{error:'Write a little more first: Tab is measured on your own writing.'};
 const samples:Sample[]=mine.map(w=>({site:w.site,intent:w.intent,label:w.label,text:w.text}));
 const moments=momentsFrom(samples,count,Date.now()%100000),results:{score:ReturnType<typeof score>;firstMs?:number;suggestion:string;truth:string}[]=[];
 for(let i=0;i<moments.length;i+=3){
  await Promise.all(moments.slice(i,i+3).map(async moment=>{
   const {sample}=moment,context:any={site:sample.site,url:'',title:'',language:'',editor:'contenteditable',singleLine:false,intent:sample.intent,label:sample.label};
   const recall={...emptyRecall(),facts:settings.facts,style:samples.filter(s=>s!==sample&&s.intent===sample.intent).slice(0,3).map(s=>({site:s.site,intent:s.intent,text:s.text}))};
   const {system,messages,known}=tabRequest(context,moment.before,'',recall),lastWord=lastWordOf(moment.before);
   const started=performance.now();let firstMs:number|undefined;
   const one=async()=>{let raw='';await model({model:settings.models.tab,system,messages,max_tokens:40,purpose:'tab'},{onEvent:e=>{if(e.data?.delta?.type==='text_delta'){raw+=e.data.delta.text;firstMs??=performance.now()-started;}}}).catch(()=>null);return cleanSuggestion(raw,{before:moment.before,after:'',singleLine:false,known,final:true,lastWord});};
   const [a,b]=await Promise.all([one(),one()]),suggestion=agreed(a,b);
   results.push({score:score(suggestion,moment.truth),firstMs,suggestion,truth:moment.truth});
  }));
 }
 const summary={...summarize(results),at:Date.now()};
 await (await db()).put('meta',summary,'tab-meter');
 return summary;
}
