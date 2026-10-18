/** What a new user told Gumbo when it first opened (the desktop app's onboarding): what to call them, what they make, how
 * much they have edited and how they found Gumbo, one row per account (migrations/202610180002_profiles.sql). The app
 * reads it back on another computer, so someone who already answered is not asked again; together the answers say who
 * Gumbo is for. Only the ids below are kept (the app's contracts list the same ones), so nothing free-form but the name. */
export const ONBOARDING={
 makes:['youtube','shorts','podcasts','vlogs','gaming','business','tutorials','personal','other'],
 experience:['new','some','pro'],
 heard:['youtube','tiktok','x','reddit','friend','search','other']
} as const;
export type ProfileRow={display_name:string;makes:string[];experience:string|null;heard:string|null;onboarded_at?:string|null};
export type ProfilePorts={read(user:string):Promise<ProfileRow|null>;save(user:string,row:ProfileRow):Promise<void>};

/** The answers as the app asks for them; onboardedAt is null for an account that has not answered. */
export async function readProfile(user:string,ports:ProfilePorts){
 const row=await ports.read(user);
 return row?{name:row.display_name,makes:row.makes,experience:row.experience,heard:row.heard,onboardedAt:row.onboarded_at??null}:{name:'',makes:[],experience:null,heard:null,onboardedAt:null};
}

/** Keeps the answers; an id the app does not offer is dropped rather than refused, so an older app's answers still save. */
export async function saveProfile(body:any,user:string,ports:ProfilePorts):Promise<{status:number;body:unknown}>{
 if(!body||typeof body!=='object')return{status:400,body:{error:'There are no answers to save.'}};
 const one=(list:readonly string[],value:unknown)=>typeof value==='string'&&list.includes(value)?value:null;
 const makes=[...new Set((Array.isArray(body.makes)?body.makes:[]).filter((m:unknown)=>one(ONBOARDING.makes,m)))] as string[];
 await ports.save(user,{display_name:String(body.name??'').trim().slice(0,80),makes,experience:one(ONBOARDING.experience,body.experience),heard:one(ONBOARDING.heard,body.heard)});
 return{status:200,body:{saved:true}};
}

/** The ports over the gateway's Supabase client (service role). Saving again keeps when the account first answered. */
export function supabaseProfilePorts(db:any):ProfilePorts{
 return{
  read:async user=>{const {data,error}=await db.from('dream_profiles').select('display_name,makes,experience,heard,onboarded_at').eq('user_id',user).maybeSingle();if(error)throw new Error(error.message);return data;},
  save:async(user,row)=>{const {error}=await db.from('dream_profiles').upsert({user_id:user,...row,updated_at:new Date().toISOString()},{onConflict:'user_id'});if(error)throw new Error(error.message);}
 };
}
