/** Ctrl+K's actions without a connector: the model's JSON turned into a link that does the thing (a prefilled calendar
 * event, a mail, map or web search, a page) or a note to keep. */
export type Action={do:'calendar'|'search'|'note'|'open'|'page';label:string;url?:string;text?:string;task?:string};
const timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
/** The model's action as something to do: a link to open, or a note to keep. */
export function actionOf(text:string):Action|undefined{
 const json=/\{[\s\S]*\}/.exec(text)?.[0];if(!json)return;
 let a:any;try{a=JSON.parse(json);}catch{return;}
 const enc=encodeURIComponent;
 if(a.do==='calendar'&&a.title&&a.start){
  const stamp=(s:string)=>s.replace(/[-:]/g,'').replace(/(\d{8}T\d{4})$/,'$100');
  const start=new Date(a.start),end=a.end?new Date(a.end):new Date(start.getTime()+3_600_000);
  const local=(d:Date)=>`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}00`;
  const dates=isNaN(start.getTime())?stamp(a.start):`${local(start)}/${local(end)}`;
  const when=isNaN(start.getTime())?a.start:start.toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return{do:'calendar',label:`Add to Google Calendar: ${a.title} · ${when}`,url:`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${enc(a.title)}&dates=${dates}&ctz=${enc(timeZone())}${a.location?`&location=${enc(a.location)}`:''}${a.details?`&details=${enc(a.details)}`:''}`};
 }
 if(a.do==='search'&&a.query){
  const where=a.where==='mail'?'mail':a.where==='maps'?'maps':'web';
  const target=where==='mail'?`https://mail.google.com/mail/u/0/#search/${enc(a.query)}`:where==='maps'?`https://www.google.com/maps/search/?api=1&query=${enc(a.query)}`:`https://www.google.com/search?q=${enc(a.query)}`;
  return{do:'search',label:`${where==='mail'?'Search your mail':where==='maps'?'Find on Google Maps':'Search the web'}: ${a.query}`,url:target};
 }
 if(a.do==='note'&&a.text)return{do:'note',label:`Save to your notes: ${String(a.text).slice(0,80)}`,text:String(a.text)};
 // Something done in this page: the agent does it there, step by step, in the card.
 if(a.do==='page'&&a.task)return{do:'page',label:`Do it here: ${String(a.task).slice(0,120)}`,task:String(a.task)};
 if(a.do==='open'&&/^https?:\/\//.test(a.url??''))return{do:'open',label:`Open ${new URL(a.url).hostname}`,url:a.url};
}

