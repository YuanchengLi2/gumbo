/** Searches free-to-use media libraries for the agent: music, sound effects, footage and images it may download and put in a
 * video. Openverse, Wikimedia Commons and the Internet Archive need no key; Pexels, Pixabay, Freesound and Jamendo join when
 * their key is set here (PEXELS_API_KEY, PIXABAY_API_KEY, FREESOUND_API_KEY, JAMENDO_CLIENT_ID), and OPENVERSE_CREDENTIALS
 * (client_id:client_secret of a free Openverse app) lifts Openverse's anonymous limit of 20 searches a minute and 200 a day.
 * Only licenses that allow use in a published, edited video come back (public domain, CC0, CC BY, CC BY-SA, the Pexels and
 * Pixabay licenses); non-commercial ones only when asked for, never no-derivatives ones. Each result carries what crediting
 * it takes. The libraries match every word of a query, so one that finds too little is searched again more loosely. */
export type MediaKind='music'|'sound'|'footage'|'image';
export type Found={id:string;source:string;kind:'audio'|'video'|'image';title:string;creator:string;license:string;licenseUrl?:string;attribution?:string;page:string;download:string;durationSec?:number;width?:number;height?:number;sizeBytes?:number};
export const mediaKeys={pexels:'PEXELS_API_KEY',pixabay:'PIXABAY_API_KEY',freesound:'FREESOUND_API_KEY',jamendo:'JAMENDO_CLIENT_ID',openverse:'OPENVERSE_CREDENTIALS'} as const;
type Keys=Partial<Record<keyof typeof mediaKeys,string>>;
const agent={'User-Agent':'Figjam/1.0 (video editor; media search)'};
const entities:Record<string,string>={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '};
const strip=(html:unknown)=>String(html??'').replace(/<[^>]*>/g,'').replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi,(all,code:string)=>code[0]==='#'?String.fromCodePoint(code[1]==='x'||code[1]==='X'?parseInt(code.slice(2),16):Number(code.slice(1))):entities[code.toLowerCase()]??all).replace(/\s+/g,' ').trim().slice(0,200);
const words=(q:string)=>q.split(/\s+/).filter(Boolean);

/** A license as a short name, and whether a published, edited video may use it. */
export function licenseOf(raw:string,allowNonCommercial=false):{name:string;usable:boolean;credit:boolean}{
 const text=raw.toLowerCase().replace(/https?:\/\/(www\.)?creativecommons\.org\/(licenses|publicdomain)\//,'').replace(/[_]/g,' ').trim();
 if(/^(cc0|zero|publicdomain\/zero)|cc0|public ?domain|^pdm|^mark|no known copyright/.test(text))return{name:/cc0|zero/.test(text)?'CC0':'Public domain',usable:true,credit:false};
 if(/pexels/.test(text))return{name:'Pexels License',usable:true,credit:false};
 if(/pixabay/.test(text))return{name:'Pixabay Content License',usable:true,credit:false};
 const m=text.match(/\b(?:cc[ -])?(by(?:[- ](?:nc|sa|nd))*)(?:[ /-]*([\d.]+))?/);if(!m)return{name:raw.slice(0,40),usable:false,credit:true};
 const parts=m[1].replace(/ /g,'-').split('-'),name='CC '+parts.map(p=>p.toUpperCase()).join('-')+(m[2]?' '+m[2]:'');
 return{name,usable:!parts.includes('nd')&&(allowNonCommercial||!parts.includes('nc')),credit:true};
}
const credit=(f:{title:string;creator:string;license:string;page:string},needs:boolean)=>needs?`"${f.title}" by ${f.creator||'unknown'} (${f.license}), ${f.page}`:undefined;
/** Seconds from "187.4", "3:07" or "1:03:07". */
const seconds=(value:unknown)=>{const s=String(value??'').trim();if(!s)return undefined;const t=s.includes(':')?s.split(':').reduce((sum,part)=>sum*60+Number(part),0):Number(s);return Number.isFinite(t)&&t>0?Math.round(t):undefined;};

async function get(fetcher:typeof fetch,url:string,headers:Record<string,string>={}){
 const response=await fetcher(url,{headers:{...agent,...headers},signal:AbortSignal.timeout(12_000)});if(!response.ok)throw new Error(`${new URL(url).host} answered ${response.status}`);
 // The Internet Archive reports a failed search inside a 200 answer.
 const body=await response.json();if(typeof body?.error==='string')throw new Error(`${new URL(url).host}: ${body.error.slice(0,100)}`);return body;
}
/** A strict search's results, filled up from a looser search when the strict one found fewer than wanted. */
async function loosened(n:number,strict:()=>Promise<Found[]>,loose?:()=>Promise<Found[]>){
 const first=await strict();if(first.length>=n||!loose)return first;
 const seen=new Set(first.map(f=>f.id));return[...first,...(await loose()).filter(f=>!seen.has(f.id))].slice(0,n);
}

let openverseToken:{value:string;until:number}|undefined;
async function openverseAuth(f:typeof fetch,credentials?:string):Promise<Record<string,string>>{
 if(!credentials?.includes(':'))return{};
 if(!openverseToken||openverseToken.until<Date.now()){
  const [client_id,client_secret]=credentials.split(':'),response=await f('https://api.openverse.org/v1/auth_tokens/token/',{method:'POST',headers:{...agent,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id,client_secret}),signal:AbortSignal.timeout(12_000)});
  // A token that cannot be had leaves Openverse searched anonymously.
  const body=response.ok?await response.json().catch(()=>({})):{};if(typeof body.access_token!=='string')return{};
  openverseToken={value:body.access_token,until:Date.now()+(Number(body.expires_in)||3600)*1000-60_000};
 }
 return{Authorization:'Bearer '+openverseToken.value};
}
async function openverse(f:typeof fetch,q:string,kind:MediaKind,n:number,nc:boolean,credentials?:string):Promise<Found[]>{
 if(kind==='footage')return[];const audio=kind!=='image',auth=await openverseAuth(f,credentials);
 // Openverse has no OR: the looser search keeps the first half of the words. Most sound effects there carry no category, so
 // only music is filtered by it.
 const search=async(text:string)=>((await get(f,`https://api.openverse.org/v1/${audio?'audio':'images'}/?q=${encodeURIComponent(text)}&page_size=${n}${nc?'':'&license_type=commercial,modification'}${kind==='music'?'&category=music':''}`,auth)).results??[]).map((r:any)=>{const l=licenseOf(`${r.license} ${r.license_version??''}`,nc),found={id:'openverse:'+r.id,source:'Openverse ('+String(r.source??r.provider??'')+')',kind:audio?'audio' as const:'image' as const,title:strip(r.title)||'Untitled',creator:strip(r.creator),license:l.name,licenseUrl:r.license_url,page:r.foreign_landing_url??'',download:r.url,durationSec:r.duration?Math.round(r.duration/100)/10:undefined,width:r.width,height:r.height,sizeBytes:r.filesize};return l.usable&&r.url?{...found,attribution:credit(found,l.credit)}:undefined;}).filter(Boolean) as Found[];
 const w=words(q);return loosened(n,()=>search(q),w.length>1?()=>search(w.slice(0,Math.ceil(w.length/2)).join(' ')):undefined);
}
async function commons(f:typeof fetch,q:string,kind:MediaKind,n:number,nc:boolean):Promise<Found[]>{
 const type=kind==='footage'?'video':kind==='image'?'bitmap':'audio';
 // Pages come keyed by id; index is their rank in the search. MIDI files are notes, not sound, and are left out.
 const search=async(text:string)=>Object.values((await get(f,`https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=${n}&gsrsearch=${encodeURIComponent(text+' filetype:'+type)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiextmetadatafilter=LicenseShortName|Artist|LicenseUrl`)).query?.pages??{}).sort((a:any,b:any)=>(a.index??0)-(b.index??0)).map((p:any)=>{const i=p.imageinfo?.[0];if(!i||/midi/i.test(String(i.mime)))return;const meta=i.extmetadata??{},l=licenseOf(String(meta.LicenseShortName?.value??''),nc),found={id:'commons:'+p.pageid,source:'Wikimedia Commons',kind:kind==='footage'?'video' as const:kind==='image'?'image' as const:'audio' as const,title:String(p.title??'').replace(/^File:/,'').replace(/\.[a-z0-9]+$/i,''),creator:strip(meta.Artist?.value),license:l.name,licenseUrl:meta.LicenseUrl?.value,page:i.descriptionurl,download:i.url,durationSec:i.duration?Math.round(i.duration*10)/10:undefined,width:i.width||undefined,height:i.height||undefined,sizeBytes:i.size};return l.usable?{...found,attribution:credit(found,l.credit)}:undefined;}).filter(Boolean) as Found[];
 const w=words(q);return loosened(n,()=>search(q),w.length>1?()=>search(w.join(' OR ')):undefined);
}
// Lucene's operators in a query are read as plain words.
const lucene=(q:string)=>q.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g,' ').replace(/\s+/g,' ').trim();
async function archive(f:typeof fetch,q:string,kind:MediaKind,n:number):Promise<Found[]>{
 if(kind==='image'||kind==='sound')return[];const media=kind==='footage'?'movies':'audio',text=lucene(q);if(!text)return[];
 // A license filter with several wildcards overloads the Archive's search ("Invalid or no response from Elasticsearch");
 // leaving out non-commercial and no-derivatives licenses works, and most of its music is one of those.
 const search=`https://archive.org/advancedsearch.php?q=${encodeURIComponent(`(title:(${text}) OR subject:(${text}) OR description:(${text})) AND mediatype:${media} AND licenseurl:[* TO *] AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*`)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=licenseurl&rows=${Math.min(n,5)}&output=json`;
 const docs=(await get(f,search)).response?.docs??[];
 // The best playable copy of each item: full-size H.264 before the small 512kb copy; MP3 before Ogg and FLAC.
 const formats=kind==='footage'?['h.264','mpeg4','h.264 ia','512kb mpeg4']:['vbr mp3','mp3','128kbps mp3','ogg vorbis','flac'];
 return(await Promise.all(docs.map(async(d:any)=>{try{
  const l=licenseOf(String(d.licenseurl??''));if(!l.usable)return;
  const files=(await get(f,`https://archive.org/metadata/${encodeURIComponent(d.identifier)}`)).files??[],file=formats.map(format=>files.find((x:any)=>String(x.format).toLowerCase()===format)).find(Boolean);if(!file)return;
  const found={id:'archive:'+d.identifier+'/'+file.name,source:'Internet Archive',kind:kind==='footage'?'video' as const:'audio' as const,title:strip(d.title),creator:strip(Array.isArray(d.creator)?d.creator[0]:d.creator),license:l.name,licenseUrl:d.licenseurl,page:`https://archive.org/details/${d.identifier}`,download:`https://archive.org/download/${encodeURIComponent(d.identifier)}/${String(file.name).split('/').map(encodeURIComponent).join('/')}`,durationSec:seconds(file.length),width:Number(file.width)||undefined,height:Number(file.height)||undefined,sizeBytes:file.size?Number(file.size):undefined};
  return{...found,attribution:credit(found,l.credit)};
 }catch{return;}}))).filter(Boolean) as Found[];
}
async function pexels(f:typeof fetch,key:string,q:string,kind:MediaKind,n:number):Promise<Found[]>{
 if(kind==='footage')return((await get(f,`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=${n}`,{Authorization:key})).videos??[]).map((v:any)=>{const file=[...(v.video_files??[])].filter((x:any)=>x.file_type==='video/mp4').sort((a:any,b:any)=>Math.abs((a.height??0)-1080)-Math.abs((b.height??0)-1080))[0];return file?{id:'pexels:v'+v.id,source:'Pexels',kind:'video' as const,title:v.url?.split('/').filter(Boolean).at(-1)?.replace(/-\d+$/,'').replace(/-/g,' ')||'Pexels video',creator:v.user?.name??'',license:'Pexels License',page:v.url,download:file.link,durationSec:v.duration,width:file.width,height:file.height}:undefined;}).filter(Boolean);
 if(kind==='image')return((await get(f,`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=${n}`,{Authorization:key})).photos??[]).map((p:any)=>({id:'pexels:p'+p.id,source:'Pexels',kind:'image' as const,title:p.alt||'Pexels photo',creator:p.photographer??'',license:'Pexels License',page:p.url,download:p.src?.original,width:p.width,height:p.height}));
 return[];
}
async function pixabay(f:typeof fetch,key:string,q:string,kind:MediaKind,n:number):Promise<Found[]>{
 if(kind==='footage')return((await get(f,`https://pixabay.com/api/videos/?key=${key}&q=${encodeURIComponent(q)}&per_page=${Math.max(3,n)}`)).hits??[]).map((h:any)=>{const v=h.videos?.large?.url?h.videos.large:h.videos?.medium;return v?.url?{id:'pixabay:v'+h.id,source:'Pixabay',kind:'video' as const,title:h.tags||'Pixabay video',creator:h.user??'',license:'Pixabay Content License',page:h.pageURL,download:v.url,durationSec:h.duration,width:v.width,height:v.height,sizeBytes:v.size}:undefined;}).filter(Boolean);
 if(kind==='image')return((await get(f,`https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&per_page=${Math.max(3,n)}&image_type=photo`)).hits??[]).map((h:any)=>({id:'pixabay:p'+h.id,source:'Pixabay',kind:'image' as const,title:h.tags||'Pixabay image',creator:h.user??'',license:'Pixabay Content License',page:h.pageURL,download:h.largeImageURL,width:h.imageWidth,height:h.imageHeight}));
 return[];
}
async function freesound(f:typeof fetch,key:string,q:string,kind:MediaKind,n:number,nc:boolean):Promise<Found[]>{
 if(kind!=='sound'&&kind!=='music')return[];
 return((await get(f,`https://freesound.org/apiv2/search/text/?query=${encodeURIComponent(q)}&page_size=${n}&fields=id,name,username,license,duration,previews,url&token=${key}`)).results??[]).map((r:any)=>{const l=licenseOf(String(r.license??''),nc);const found={id:'freesound:'+r.id,source:'Freesound',kind:'audio' as const,title:r.name,creator:r.username,license:l.name,licenseUrl:r.license,page:r.url,download:r.previews?.['preview-hq-mp3'],durationSec:r.duration?Math.round(r.duration*10)/10:undefined};return l.usable&&found.download?{...found,attribution:credit(found,l.credit)}:undefined;}).filter(Boolean);
}
async function jamendo(f:typeof fetch,key:string,q:string,kind:MediaKind,n:number,nc:boolean):Promise<Found[]>{
 if(kind!=='music')return[];
 return((await get(f,`https://api.jamendo.com/v3.0/tracks/?client_id=${key}&format=json&limit=${n}&search=${encodeURIComponent(q)}&audiodownload_allowed=true&include=licenses`)).results??[]).map((r:any)=>{const l=licenseOf(String(r.license_ccurl??''),nc);const found={id:'jamendo:'+r.id,source:'Jamendo',kind:'audio' as const,title:r.name,creator:r.artist_name,license:l.name,licenseUrl:r.license_ccurl,page:r.shareurl,download:r.audiodownload,durationSec:r.duration};return l.usable&&r.audiodownload?{...found,attribution:credit(found,l.credit)}:undefined;}).filter(Boolean);
}

export async function handleMediaSearch(body:any,{keys,fetcher=fetch}:{keys:Keys;fetcher?:typeof fetch}){
 const query=String(body?.query??'').trim().slice(0,200),kind=body?.kind as MediaKind,limit=Math.max(1,Math.min(12,Number(body?.limit)||8)),nc=body?.nonCommercial===true;
 if(!query)return{status:400,body:{error:'Say what to search for.'}};if(!['music','sound','footage','image'].includes(kind))return{status:400,body:{error:'kind must be music, sound, footage or image.'}};
 // Keyed libraries first: their footage and music are the strongest; the open archives fill in.
 type Source=[string,()=>Promise<Found[]>];
 const sources:Source[]=[...(keys.pexels?[['Pexels',()=>pexels(fetcher,keys.pexels!,query,kind,limit)] as Source]:[]),...(keys.pixabay?[['Pixabay',()=>pixabay(fetcher,keys.pixabay!,query,kind,limit)] as Source]:[]),...(keys.freesound?[['Freesound',()=>freesound(fetcher,keys.freesound!,query,kind,limit,nc)] as Source]:[]),...(keys.jamendo?[['Jamendo',()=>jamendo(fetcher,keys.jamendo!,query,kind,limit,nc)] as Source]:[]),
  ['Openverse',()=>openverse(fetcher,query,kind,limit,nc,keys.openverse)],['Wikimedia Commons',()=>commons(fetcher,query,kind,limit,nc)],['Internet Archive',()=>archive(fetcher,query,kind,limit)]];
 const settled=await Promise.allSettled(sources.map(([,run])=>run()));
 const results=settled.flatMap(r=>r.status==='fulfilled'?r.value:[]).filter(r=>/^https:\/\//.test(r.download)).slice(0,limit*3);
 const status=Object.fromEntries(sources.map(([name],i)=>[name,settled[i].status==='fulfilled'?'searched':String((settled[i] as PromiseRejectedResult).reason?.message??'failed').slice(0,120)]));
 return{status:200,body:{query,kind,results,sources:status,notSetUp:Object.entries(mediaKeys).filter(([id])=>!keys[id as keyof Keys]).map(([id])=>id)}};
}
