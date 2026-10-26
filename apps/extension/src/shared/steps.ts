/** A step of the agent (a tool call) in words, for the side panel and Ctrl+K's card alike: a verb (present while it runs,
 * past once done) and what it acted on. */
export type StepPart={name:string;input?:any;status:string;summary?:string};
const hostOf=(url?:string)=>{try{return new URL(url!).hostname.replace(/^www\./,'');}catch{return '';}};
export function stepWords(p:StepPart):[string,string?]{
 const i=p.input??{},t=i.target?.name??i.target?.text,ing=p.status==='drafting'||p.status==='running',q=(s?:string,n=40)=>s?`${s.slice(0,n)}${s.length>n?'…':''}`:undefined;
 const v=(now:string,past:string)=>ing?now:past;
 switch(p.name){
  case 'read_page':return[v('Reading','Read'),p.summary&&p.status==='done'?q(p.summary):'the page'];
  case 'click':return[v('Clicking','Clicked'),q(t)];
  case 'type':return[v('Typing','Typed'),q(i.text)];
  case 'key':return[v('Pressing','Pressed'),i.combo];
  case 'select':return[v('Choosing','Chose'),q(i.option)];
  case 'scroll':return[v('Scrolling','Scrolled'),i.by<0?'up':'down'];
  case 'wait':return[v('Waiting for','Waited for'),q(i.text)??'the page'];
  case 'open':return[v('Opening','Opened'),i.url?hostOf(i.url):undefined];
  case 'tabs':return[v('Looking at','Looked at'),'your tabs'];
  case 'switch_tab':return[v('Switching to','Switched to'),q(p.summary)??'another tab'];
  case 'history':return[v('Searching your history for','Searched your history for'),q(i.query)];
  case 'reopen_tab':return[v('Reopening','Reopened'),q(p.summary)??'a closed tab'];
  case 'search_memory':return[v('Searching memory for','Searched memory for'),q(i.query)];
  case 'gmail_search':return[v('Searching Gmail for','Searched Gmail for'),q(i.query)];
  case 'gmail_read':return[v('Reading','Read'),q(p.summary)??'an email'];
  case 'gmail_draft':return[v('Writing','Wrote'),'a Gmail draft'];
  case 'calendar_events':return[v('Checking','Checked'),'your calendar'];
  case 'calendar_create':return[v('Adding','Added'),q(i.title)];
  case 'drive_search':return[v('Searching Drive for','Searched Drive for'),q(i.query)];
  case 'doc_read':return[v('Reading','Read'),q(p.summary)??'a document'];
  case 'supabase_projects':return[v('Looking at','Looked at'),'Supabase'];
  case 'supabase_sql':return[v('Querying','Queried'),i.project];
  case 'vercel_deployments':return[v('Checking','Checked'),'deployments'];
  case 'vercel_build_log':return[v('Reading','Read'),'the build log'];
  case 'stripe_list':return[v('Reading','Read'),`Stripe ${i.resource??''}`.trim()];
 }
 return[p.name];
}
