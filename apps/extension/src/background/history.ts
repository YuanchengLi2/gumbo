import {brain} from './actions';
import {add,putSealed,getSealed} from './db';
import {invalidate} from './recall';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {pageKindOf,type Step} from '../shared/learn';
import {categoryOf} from '../shared/page-kind';
import {calibrateWhenReady} from './memory/projects';
/** What the user already has, brought in once (and again from the popup): the last 60 days of Chrome's history, whose
 * visits and the links between them (referringVisitId) teach the learner where the user usually goes from where, and at
 * what hours, and become memory's visits (chained the same way, the newest 20,000; a second import adds only what is
 * newer than the first); and their bookmarks. Titles and addresses become searchable memory. It works in batches that
 * yield, while the computer is idle, and says how far it got. Nothing from blocked sites, and nothing leaves the
 * computer. */
export type ImportState={state:'idle'|'running'|'done';pages:number;visits:number;bookmarks:number;at?:number};
let running:Promise<ImportState>|undefined;
const DAY=86_400_000,yieldNow=()=>new Promise(r=>setTimeout(r,0));

export async function importState():Promise<ImportState>{return(await getSealed<ImportState>('import'))??{state:'idle',pages:0,visits:0,bookmarks:0};}
export function importHistory(days=60):Promise<ImportState>{
 return running??=(async()=>{
  const state:ImportState={state:'running',pages:0,visits:0,bookmarks:0};await putSealed('import',state);
  try{
   const settings=await loadSettings(),since=Date.now()-days*DAY;
   const items=(await chrome.history.search({text:'',startTime:since,maxResults:100_000})).filter(i=>i.url&&/^https?:/.test(i.url)&&activeOn(settings,siteOf(i.url)));
   // The pages visited most carry the habits; the long tail of one-off visits is left out of the visit walk.
   items.sort((a,b)=>(b.visitCount??0)-(a.visitCount??0));
   const visits:{id:string;url:string;title:string;at:number;from?:string;transition:string}[]=[];
   for(let i=0;i<Math.min(items.length,4000);i++){
    const item=items[i];
    for(const v of await chrome.history.getVisits({url:item.url!}))if((v.visitTime??0)>=since)visits.push({id:v.visitId,url:item.url!,title:item.title??'',at:v.visitTime??0,from:v.referringVisitId&&v.referringVisitId!=='0'?v.referringVisitId:undefined,transition:v.transition});
    if(i%50===49){state.pages=i+1;await yieldNow();}
   }
   visits.sort((a,b)=>a.at-b.at);
   const byId=new Map(visits.map(v=>[v.id,v])),l=await brain();
   const step=(v:typeof visits[number]):Step=>({kind:'navigate',pageKind:pageKindOf(v.url),key:'nav:'+pageKindOf(v.url),label:v.title||v.url,url:v.url,title:v.title,at:v.at});
   for(const [i,v] of visits.entries()){
    const from=v.from?byId.get(v.from):undefined;
    // A link followed from another page is a chain; a typed address or a bookmark starts one (a routine for its hour).
    if(from&&pageKindOf(from.url)!==pageKindOf(v.url))l.observe(step(from),step(v));
    else if(!from&&/typed|auto_bookmark|generated|keyword/.test(v.transition))l.observe(undefined,step(v));
    if(i%500===499)await yieldNow();
   }
   state.visits=visits.length;await putSealed('learner',l.toJSON());
   // Memory's visits, chained by the link each came from; only those newer than an import before this one.
   const since2=(await getSealed<number>('import-visits-until'))??0,ids=new Map<string,number>();
   const fresh=visits.filter(v=>v.at>since2).slice(-20_000);
   for(const [i,v] of fresh.entries()){
    const id=await add('visits',{tab:-1,window:-1,session:0,url:v.url,site:siteOf(v.url),title:v.title,pageKind:pageKindOf(v.url),kind:categoryOf(v.url,v.title),in:v.at,activeMs:0,visibleMs:0,readMs:0,from:v.from?ids.get(v.from):undefined,transition:v.transition,source:'import'}).catch(()=>undefined) as number|undefined;
    if(id!==undefined)ids.set(v.id,id);
    if(i%200===199)await yieldNow();
   }
   if(fresh.length)await putSealed('import-visits-until',fresh.at(-1)!.at);
   // Titles and addresses as memory search can find ("that article about pricing pages I read last week").
   for(const item of items.slice(0,4000)){
    await add('passages',{ref:item.url!,kind:'page',text:`${item.title??''} ${item.url}`,at:item.lastVisitTime??Date.now(),site:siteOf(item.url!),title:item.title||item.url!,url:item.url}).catch(()=>{});
    state.pages++;
   }
   try{
    const walk=(nodes:chrome.bookmarks.BookmarkTreeNode[],folder:string):{title:string;url:string;folder:string}[]=>nodes.flatMap(n=>n.url?[{title:n.title,url:n.url,folder}]:walk(n.children??[],n.title||folder));
    for(const mark of walk(await chrome.bookmarks.getTree(),'').filter(m=>/^https?:/.test(m.url)&&activeOn(settings,siteOf(m.url)))){
     await add('notes',{text:`Bookmark${mark.folder?` in ${mark.folder}`:''}: ${mark.title} (${mark.url})`,url:mark.url,title:mark.title,at:Date.now(),source:'import'}).catch(()=>{});state.bookmarks++;
    }
   }catch{}
   invalidate();
   Object.assign(state,{state:'done',at:Date.now()});await putSealed('import',state);
   // Projects learn their threshold from the visits just brought in.
   void calibrateWhenReady();
   return state;
  }catch(error){Object.assign(state,{state:'idle'});await putSealed('import',state).catch(()=>{});throw error;}
  finally{running=undefined;}
 })();
}
