/** Quick render: an export's coded scenes drawn in the cloud (services/scene-render on Modal), many frames at once, instead
 * of one by one in the user's browser. The gateway only decides who may and hands out a pass: a token signed with the
 * secret it shares with the render service, naming the account, how many frames it may draw, and when it runs out. The
 * scene's files then go straight to the render service, never through here.
 * DREAM_SCENE_RENDER_URL and DREAM_SCENE_RENDER_SECRET set it up; DREAM_SCENE_RENDER_PLANS lists the plans that get it
 * (Pro and Max unless set); the owner always does. */
export const PASS_SECONDS=15*60,MAX_FRAMES=60*60*10;
const DEFAULT_PLANS=['pro','max','max20'];
const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function sign(secret:string,text:string){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return base64url(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))));
}
/** A pass: base64url(claims).base64url(HMAC-SHA256(secret, that first part)). */
export async function sceneRenderToken(secret:string,claims:{sub:string;exp:number;frames:number}){
 const body=base64url(new TextEncoder().encode(JSON.stringify(claims)));return `${body}.${await sign(secret,body)}`;
}
export async function sceneRenderPass(user:{id:string},account:{plan?:string|null;is_admin?:boolean|null}|null,env:(name:string)=>string|undefined,now=Date.now()){
 const url=env('DREAM_SCENE_RENDER_URL'),secret=env('DREAM_SCENE_RENDER_SECRET');
 if(!url||!secret)return {status:200,body:{available:false,reason:'Quick render is not set up yet.'}};
 const plans=(env('DREAM_SCENE_RENDER_PLANS')?.split(',').map(p=>p.trim()).filter(Boolean))??DEFAULT_PLANS;
 if(!account?.is_admin&&!plans.includes(account?.plan??'free'))return {status:200,body:{available:false,reason:'Quick render comes with Pro and Max.'}};
 const exp=Math.floor(now/1000)+PASS_SECONDS;
 return {status:200,body:{available:true,url,token:await sceneRenderToken(secret,{sub:user.id,exp,frames:MAX_FRAMES}),expiresAt:exp}};
}
