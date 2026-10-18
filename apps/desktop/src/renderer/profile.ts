import {useEffect,useState} from 'react';
import type {AppSettings,OnboardingAnswers} from '@dream/contracts';
import {Smartphone,Scissors,Plane,Captions,Mic,Gamepad2,Presentation,GraduationCap,Heart,Youtube,type LucideIcon} from 'lucide-react';

/** The onboarding's answers (components/onboarding). Finishing it writes the name and what you make to the creator profile
 * the agent reads with every request (Settings > Profile), and all the answers to the account (the gateway's profiles),
 * which keeps them for the next computer. Answers given before signing in wait on this computer and go at sign-in. */
export type MakeId=OnboardingAnswers['makes'][number];
export type Experience=NonNullable<OnboardingAnswers['experience']>;
export type Heard=NonNullable<OnboardingAnswers['heard']>;
export const makes:[MakeId,string][]=[['youtube','YouTube videos'],['shorts','Shorts, Reels and TikToks'],['podcasts','Podcasts and interviews'],['vlogs','Vlogs and travel'],['gaming','Gaming'],['business','Business and marketing'],['tutorials','Tutorials and courses'],['personal','Family and friends'],['other','Something else']];
export const experiences:[Experience,string,string][]=[['new','New to editing','Say what you want and Gumbo does the cutting.'],['some','I’ve made a few','CapCut, iMovie or an editor on my phone.'],['pro','I edit a lot','Premiere, Resolve or Final Cut.']];
export const sources:[Heard,string][]=[['youtube','YouTube'],['tiktok','TikTok or Instagram'],['x','X (Twitter)'],['reddit','Reddit'],['friend','A friend or colleague'],['search','A search'],['other','Somewhere else']];

const ANSWERS='gumbo-onboarding',UNSENT='gumbo-onboarding-unsent',DONE='gumbo-onboarded';
const read=(key:string)=>{try{return localStorage.getItem(key);}catch{return null;}};
const write=(key:string,value:string|null)=>{try{if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value);}catch{}};
/** Whether this computer has been through the onboarding, or used Gumbo before there was one (the welcome it saw then). */
export const onboarded=()=>read(DONE)==='1'||read('gumbo-welcomed')==='1';
export const markOnboarded=()=>write(DONE,'1');
export const savedAnswers=():OnboardingAnswers|null=>{try{return JSON.parse(read(ANSWERS)??'null');}catch{return null;}};

/** Requests to start from, fitted to what they make: one click puts it in the home screen's box. */
const starters:Record<MakeId|'any',[LucideIcon,string,string][]>={
 youtube:[[Youtube,'YouTube video','Edit my footage into a YouTube video with a strong hook in the first 10 seconds, B-roll over the talking parts and music under it.']],
 shorts:[[Smartphone,'Vertical Short','Turn my clips into a punchy 30-second vertical Short with bold captions and music on the beat.']],
 podcasts:[[Mic,'Podcast clips','Find the three best moments in this podcast and make each one a 45-second vertical clip with captions.']],
 vlogs:[[Plane,'Travel recap','Make a cinematic recap of my best moments, with titles and music on the beat.']],
 gaming:[[Gamepad2,'Gaming highlights','Cut my gameplay down to the best plays and funniest moments, with zooms, sound effects and captions.']],
 business:[[Presentation,'Product demo','Make a 45-second product demo from my screen recording, with zooms on the clicks and captions.']],
 tutorials:[[GraduationCap,'Tutorial','Turn my recording into a clear tutorial: cut the mistakes and pauses, and add a title for each step.']],
 personal:[[Heart,'Family video','Make a warm two-minute video of these moments, with gentle music and a title at the start.']],
 other:[],
 any:[[Scissors,'Cut the silences','Remove the long silences and every um, keeping every word, and tighten the pacing.'],[Captions,'Add captions','Add bold, readable captions that follow the speech.'],[Smartphone,'Vertical Short','Turn my clips into a punchy 30-second vertical Short with bold captions and music on the beat.']]
};
export function startersFor(made:readonly MakeId[]=savedAnswers()?.makes??[],count=4){
 const picked=[...made.flatMap(m=>starters[m]),...starters.any];
 return picked.filter(([,title],i)=>picked.findIndex(([,t])=>t===title)===i).slice(0,count);
}

/** Sends the answers waiting on this computer to the account; they stay waiting while signed out or offline. */
export async function sendAnswers(){
 if(read(UNSENT)!=='1')return;const answers=savedAnswers();if(!answers){write(UNSENT,null);return;}
 try{const result=await window.dream.command<{saved?:boolean}|null>({type:'account',action:'profile',profile:answers});if(result?.saved)write(UNSENT,null);}catch{}
}
/** Keeps the answers: the name and what they make go to the creator profile (what they make only when it is empty, so
 * nothing written in Settings is replaced), and everything to the account. */
export async function saveAnswers(answers:OnboardingAnswers){
 write(ANSWERS,JSON.stringify(answers));write(UNSENT,'1');
 const settings=await window.dream.settings().catch(()=>null),made=answers.makes.filter(m=>m!=='other').map(m=>makes.find(([id])=>id===m)![1]).join(', ');
 const profile={...(answers.name?{name:answers.name}:{}),...(made&&!settings?.profile.makes?{makes:made}:{})};
 if(Object.keys(profile).length)await window.dream.saveSettings({profile} as Partial<AppSettings>).then(()=>profileChanged()).catch(()=>{});
 await sendAnswers();
}

export type AccountProfile={name:string;makes:MakeId[];experience:Experience|null;heard:Heard|null;onboardedAt:string|null};
/** The answers the account already gave (on another computer), or null when it has none or the gateway can't say. */
export async function accountAnswers():Promise<AccountProfile|null>{
 try{const result=await window.dream.command<AccountProfile|{unavailable:true}|null>({type:'account',action:'profile'});return result&&!('unavailable' in result)&&result.onboardedAt?result:null;}catch{return null;}
}
/** An account that answered on another computer: its answers fill this computer's profile where it is still empty. */
export async function restoreAnswers(profile:AccountProfile){
 write(ANSWERS,JSON.stringify({name:profile.name,makes:profile.makes,...(profile.experience?{experience:profile.experience}:{}),...(profile.heard?{heard:profile.heard}:{})}));
 const settings=await window.dream.settings().catch(()=>null),made=profile.makes.filter(m=>m!=='other').map(m=>makes.find(([id])=>id===m)?.[1]).filter(Boolean).join(', ');
 const patch={...(profile.name&&!settings?.profile.name?{name:profile.name}:{}),...(made&&!settings?.profile.makes?{makes:made}:{})};
 if(Object.keys(patch).length)await window.dream.saveSettings({profile:patch} as Partial<AppSettings>).then(()=>profileChanged()).catch(()=>{});
}

/** The name Gumbo calls you (Settings > Profile), for the home screen's greeting; it follows changes made anywhere. */
let name:string|undefined;const listeners=new Set<()=>void>();
export function profileChanged(){void window.dream.settings().then(s=>{name=s.profile.name.trim();listeners.forEach(l=>l());},()=>{});}
export function useCreatorName(){
 const [value,setValue]=useState(name??'');
 useEffect(()=>{const update=()=>setValue(name??'');listeners.add(update);if(name===undefined)profileChanged();return()=>{listeners.delete(update);};},[]);
 return value;
}
