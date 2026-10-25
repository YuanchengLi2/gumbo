import {onWeb} from './platform';

/** Trying Gumbo without an account, on the web: usegumbo.app/app/?try=1 (from the homepage and share pages, which may
 * add ?prompt= to fill the box). The first request runs as a guest (the web account's startGuest, a few credits from
 * the gateway); the next request, or exporting, asks to sign in. Sample clips are offered for anyone without their own
 * at hand. The try lasts for this tab; how many requests it used is kept in this browser. */
export type Sample={id:string;label:string;detail:string;prompt:string;files:string[];poster:string;credit?:string};
export const SAMPLES:Sample[]=[
 {id:'skate',label:'Skate session',detail:'3 clips · 30 s',prompt:'Make a fast, punchy 15-second skate edit from these clips, cut on the action, with music that hits on the cuts.',files:['skate-1.mp4','skate-2.mp4','skate-3.mp4'],poster:'skate-1.jpg'},
 {id:'travel',label:'Travel shots',detail:'4 vertical clips · 20 s',prompt:'Make a 15-second travel recap in 9:16 with a big title and upbeat music.',files:['travel-1.mp4','travel-2.mp4','travel-3.mp4','travel-4.mp4'],poster:'travel-1.jpg'},
 {id:'obby',label:'Roblox obby run',detail:'1 clip · 20 s',prompt:'Make a funny 15-second fails montage: cut to every fall and slam a red FAIL stamp on it.',files:['obby.mp4'],poster:'obby.jpg',credit:'Gameplay: Dope Gameplays (CC BY)'}
];
const TRY='gumbo-try',USED='gumbo-try-used',FREE_REQUESTS=1;
const read=(store:Storage,key:string)=>{try{return store.getItem(key);}catch{return null;}};

/** Begins a try when the address asks for one, and drops ?try and ?prompt from it; the request to fill in, if any. */
export function startTrial():string|null{
 if(!onWeb())return null;const here=new URL(location.href);if(here.searchParams.get('try')!=='1')return null;
 const prompt=here.searchParams.get('prompt')?.slice(0,2000)??null;here.searchParams.delete('try');here.searchParams.delete('prompt');history.replaceState(history.state,'',here.toString());
 try{sessionStorage.setItem(TRY,'1');}catch{}return prompt;
}
export const trying=()=>onWeb()&&read(sessionStorage,TRY)==='1';
export const freeRequestsLeft=()=>Math.max(0,FREE_REQUESTS-(Number(read(localStorage,USED))||0));
export function useFreeRequest(){try{localStorage.setItem(USED,String((Number(read(localStorage,USED))||0)+1));}catch{}}

/** A sample's clips as files, as if dropped on the page. */
export async function sampleFiles(sample:Sample){
 const base=import.meta.env.BASE_URL??'/';
 return Promise.all(sample.files.map(async name=>{const response=await fetch(`${base}samples/${name}`);if(!response.ok)throw new Error(`The sample ${name} could not be loaded.`);return new File([await response.blob()],name,{type:'video/mp4'});}));
}
export const samplePoster=(sample:Sample)=>`${import.meta.env.BASE_URL??'/'}samples/${sample.poster}`;
