/** YouTube creators for the composer's @ menu and the agent's study_creator tool, through the YouTube Data API (key in
 * YOUTUBE_API_KEY). { query } searches channels (100 units of the 10,000-a-day quota, so the menu searches only once the
 * typing pauses); { handle } returns one channel and its 12 latest uploads: titles, lengths, views and thumbnail addresses
 * (about 4 units). Nothing is downloaded but this public metadata: the agent learns a creator's style from it, from
 * thumbnails and from Gumbo's style library, never from their videos. Without a key both answer { notSetUp: true }. */
type Fetcher=typeof fetch;
const API='https://www.googleapis.com/youtube/v3';

/** Seconds of an ISO 8601 duration such as PT1H2M3S. */
export const isoSeconds=(value:unknown)=>{const m=/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(value??''));return m?((+(m[1]??0)*24+ +(m[2]??0))*60+ +(m[3]??0))*60+ +(m[4]??0):undefined;};

async function api(fetcher:Fetcher,path:string,params:Record<string,string>,key:string){
 const url=`${API}/${path}?`+new URLSearchParams({...params,key});
 const response=await fetcher(url,{signal:AbortSignal.timeout(10_000)});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(`YouTube answered ${response.status}${body?.error?.message?`: ${String(body.error.message).slice(0,160)}`:''}`);
 return body as any;
}
const channelOf=(c:any)=>({id:String(c.id),handle:String(c.snippet?.customUrl??'').replace(/^@/,''),title:String(c.snippet?.title??''),avatar:c.snippet?.thumbnails?.default?.url as string|undefined,subscribers:c.statistics?.hiddenSubscriberCount?undefined:Number(c.statistics?.subscriberCount)||undefined});

/** allow: spends one of the account's monthly creator searches (billing.ts PLANS limits); false when they are used up. */
export async function handleCreators(body:any,options:{key?:string;fetcher?:Fetcher;allow?:()=>Promise<{ok:boolean;limit:number}>}):Promise<{status:number;body:unknown}>{
 const fetcher=options.fetcher??fetch,key=options.key;
 const query=typeof body?.query==='string'?body.query.trim().slice(0,80):'',handle=typeof body?.handle==='string'?body.handle.trim().replace(/^@/,'').slice(0,100):'';
 if(!query&&!handle)return{status:400,body:{error:'Give a query or a handle.'}};
 if(!key)return{status:200,body:{notSetUp:true,creators:[]}};
 try{
  if(query){
   // Only searches spend the allowance: the agent studying a creator a request named is part of that request.
   const allowed=options.allow?await options.allow():{ok:true,limit:0};if(!allowed.ok)return{status:200,body:{creators:[],limited:{limit:allowed.limit}}};
   const found=await api(fetcher,'search',{part:'snippet',type:'channel',q:query,maxResults:'6'},key);
   const ids=(found.items??[]).map((i:any)=>i.id?.channelId).filter(Boolean);
   if(!ids.length)return{status:200,body:{creators:[]}};
   const channels=await api(fetcher,'channels',{part:'snippet,statistics',id:ids.join(',')},key);
   const byId=new Map((channels.items??[]).map((c:any)=>[c.id,c]));
   return{status:200,body:{creators:ids.map((id:string)=>byId.get(id)).filter(Boolean).map(channelOf).filter((c:any)=>c.handle)}};
  }
  const channels=await api(fetcher,'channels',{part:'snippet,statistics,contentDetails',forHandle:'@'+handle},key),channel=channels.items?.[0];
  if(!channel)return{status:404,body:{error:`No YouTube channel @${handle}.`}};
  const uploads=channel.contentDetails?.relatedPlaylists?.uploads;
  const items=uploads?(await api(fetcher,'playlistItems',{part:'contentDetails',playlistId:uploads,maxResults:'12'},key)).items??[]:[];
  const ids=items.map((i:any)=>i.contentDetails?.videoId).filter(Boolean);
  const videos=ids.length?(await api(fetcher,'videos',{part:'snippet,contentDetails,statistics',id:ids.join(',')},key)).items??[]:[];
  return{status:200,body:{channel:{...channelOf(channel),description:String(channel.snippet?.description??'').slice(0,400),videoCount:Number(channel.statistics?.videoCount)||undefined},
   videos:videos.map((v:any)=>({title:String(v.snippet?.title??''),durationSec:isoSeconds(v.contentDetails?.duration),views:Number(v.statistics?.viewCount)||undefined,publishedAt:v.snippet?.publishedAt,thumbnail:(v.snippet?.thumbnails?.medium??v.snippet?.thumbnails?.default)?.url}))}};
 }catch(error){return{status:502,body:{error:(error as Error).message}};}
}
