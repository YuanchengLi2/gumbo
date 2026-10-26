import {siteOf} from './settings';
/** Addresses as a person reads them: the site and the start of the path, and the search someone ran (from ?q=, ?query=,
 * ?search_query=, … on any site). */
const cut=(s:string,n:number)=>s.length>n?s.slice(0,n-1)+'…':s;
export function shortUrl(url:string){try{const u=new URL(url);const path=u.pathname==='/'?'':cut(decodeURIComponent(u.pathname),48);return siteOf(url)+path;}catch{return cut(url,60);}}
export function searchOf(url:string):string|undefined{
 try{const u=new URL(url);for(const k of ['q','query','search_query','search','keywords','k','term','text'])if(u.searchParams.get(k)?.trim())return cut(u.searchParams.get(k)!.replace(/\s+/g,' ').trim(),100);}catch{}
 return undefined;
}
