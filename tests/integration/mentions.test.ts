import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveMentions,mentionLines,styleSummary,styleFromOtherProjects} from '../../apps/project-service/src/mentions';
import {ProjectDB} from '@dream/project-db';
import {handleCreators,isoSeconds} from '../../supabase/functions/dream-gateway/creators';
import {matchCreators,creatorStyle} from '@dream/config';

/** @ references (apps/project-service/src/mentions.ts, the gateway's creators.ts, packages/config creator-styles.ts). */
const home=()=>mkdtempSync(join(tmpdir(),'gumbo-mentions-'));
function project(root:string,name:string,updatedAt:string,timeline:any,files:Record<string,string>={}){
 const folder=join(root,name.replace(/\W+/g,'-'));mkdirSync(join(folder,'Workspace','context'),{recursive:true});
 writeFileSync(join(folder,'Workspace','context','published-project.json'),JSON.stringify({format:'dream-workspace',version:1,timeline,outputs:[]}));
 writeFileSync(join(folder,'Workspace','context','assets.json'),JSON.stringify([{id:'a1',filename:'beach.mp4'},{id:'song',filename:'summer.mp3'},{id:'s1',filename:'title.tsx',scene:true}]));
 for(const [path,text] of Object.entries(files)){mkdirSync(join(folder,'Workspace',path,'..'),{recursive:true});writeFileSync(join(folder,'Workspace',path),text);}
 return{id:name,name,folder,updatedAt};
}
const clip=(id:string,len:number,framing:any={},extra:any={})=>({id,assetId:'a1',srcIn:0,srcOut:len,speed:1,framing:{mode:'fill',scale:1,x:.5,y:.5,...framing},audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',...extra});
const vietnam={schemaVersion:1,id:'t',settings:{fps:30,width:1920,height:1080},spine:[clip('c1',2,{filter:'vivid',filterIntensity:.4,saturation:1.2,contrast:1.1}),clip('c2',3,{filter:'vivid',filterIntensity:.4,saturation:1.3,contrast:1.1,scale:1.2},{transitionIn:{type:'whip',durationSec:.3}}),clip('c3',4)],
 attached:[{id:'t1',type:'overlay',start:{kind:'project',at:'start',offsetSec:0},durationSec:3,component:'source',params:{text:'HANOI'},source:{assetId:'s1',srcIn:0,srcOut:3},layer:0,reason:''},{id:'x1',type:'sfx',start:{kind:'project',at:'start',offsetSec:1},durationSec:1,component:'sfx',params:{preset:'Bright whoosh'},layer:0,reason:''}],
 captions:{style:'word_pop',params:{font:'Montserrat',color:'#ffffff'},overrides:[]},music:[{id:'m',assetId:'song',srcIn:0,srcOut:9,start:{kind:'project',at:'start',offsetSec:0},gainDb:-16,duckUnderSpeechDb:12,fadeInSec:.3,fadeOutSec:1,reason:''}],beats:[]};

it('resolves media, other projects and creators the @ menu writes',()=>{
 const root=home(),current=join(root,'current');mkdirSync(current);
 const library=[project(root,'Vietnam trip highlight','2026-10-18T10:00:00Z',vietnam),{id:'here',name:'This one',folder:current,updatedAt:'2026-10-19T00:00:00Z'}];
 const found=resolveMentions('Use @[beach.mp4] first, color it like @[Vietnam trip], intro like @MrBeast, and @[Nowhere].',[{id:'a1',filename:'beach.mp4'}],current,library);
 expect(found).toEqual([
  {text:'@[beach.mp4]',kind:'media',assetId:'a1',filename:'beach.mp4'},
  expect.objectContaining({text:'@[Vietnam trip]',kind:'project',project:'Vietnam trip highlight'}),
  expect.objectContaining({text:'@[Nowhere]',kind:'unknown'}),
  expect.objectContaining({text:'@MrBeast',kind:'creator',handle:'MrBeast',styleGuide:true}),
 ]);
 // An email address or the current project is not a reference.
 expect(resolveMentions('mail me at me@example.com',[],current,library)).toEqual([]);
 expect(resolveMentions('like @[This one]',[],current,library)[0].kind).toBe('unknown');
});

it('tells a message how another project was edited, and what a creator\'s style is or how to learn it',()=>{
 const root=home(),current=join(root,'current');mkdirSync(current);
 const library=[project(root,'Vietnam trip highlight','2026-10-18T10:00:00Z',vietnam,{'src/title.tsx':'export default function Title(){return null;}'})];
 const [media,trip,nowhere,known,unknown]=mentionLines('Use @[beach.mp4], color it like @[vietnam], intro like @MrBeast, pacing like @nobody123 and @[Nowhere].',[{id:'a1',filename:'beach.mp4'}],current,library);
 expect(media).toBe('@[beach.mp4] is the source a1 "beach.mp4".');
 expect(trip).toMatch(/^@\[vietnam\] is the user's project "Vietnam trip highlight"\. How it was edited: /);
 const style=JSON.parse(trip.slice(trip.indexOf('{')));
 expect(style.color.filters).toEqual(['vivid on 2 clips (intensity about 0.4)']);expect(style.color.average.saturation).toBe(1.25);
 expect(style.captions).toEqual({style:'word_pop',params:'{"font":"Montserrat","color":"#ffffff"}'});
 expect(style.transitions.used).toEqual(['whip 1']);expect(style.framing.punchIns).toBe(1);
 expect(style.titlesAndScenes[0]).toMatchObject({component:'title.tsx',count:1});expect(style.sound.music[0]).toEqual({file:'summer.mp3',gainDb:-16,duckUnderSpeechDb:12});
 expect(known).toMatch(/^@MrBeast is MrBeast\. Gumbo's guide to their editing style: .+ never use their footage/);
 expect(unknown).toMatch(/^@nobody123 is a creator whose style the user wants\. Learn it with web/);
 expect(nowhere).toMatch(/no media file or project has this name/);
 expect(styleSummary({timeline:{spine:[],attached:[],music:[]}})).toMatchObject({color:'no grading',transitions:'hard cuts only',captions:'none'});
});


it('finds creators in the style library by handle, name or alias',()=>{
 expect(matchCreators('mr')[0].handle).toBe('MrBeast');expect(matchCreators('markro')[0].handle).toBe('MarkRober');
 expect(matchCreators('@vox')[0].handle).toBe('Vox');expect(creatorStyle('mkbhd')?.name).toBe('Marques Brownlee');
 expect(creatorStyle('Marques Brownlee')?.handle).toBe('mkbhd');expect(creatorStyle('unknownperson')).toBeUndefined();
});

it('searches YouTube channels and reads one channel\'s latest uploads, and needs a key for either',async()=>{
 expect(isoSeconds('PT1H2M3S')).toBe(3723);expect(isoSeconds('PT45S')).toBe(45);expect(isoSeconds('P1DT1S')).toBe(86401);
 expect(await handleCreators({query:'mr beast'},{})).toEqual({status:200,body:{notSetUp:true,creators:[]}});
 expect((await handleCreators({},{key:'k'})).status).toBe(400);
 const calls:string[]=[];
 const fetcher=(async(url:string)=>{calls.push(url);const path=new URL(url).pathname.split('/').pop();
  const body=path==='search'?{items:[{id:{channelId:'UC1'}}]}
   :path==='channels'?{items:[{id:'UC1',snippet:{title:'MrBeast',customUrl:'@mrbeast',thumbnails:{default:{url:'https://yt3.ggpht.com/a.jpg'}},description:'Hi'},statistics:{subscriberCount:'300000000',videoCount:'800'},contentDetails:{relatedPlaylists:{uploads:'UU1'}}}]}
   :path==='playlistItems'?{items:[{contentDetails:{videoId:'v1'}}]}
   :{items:[{snippet:{title:'$1 vs $1,000,000',publishedAt:'2026-10-01',thumbnails:{medium:{url:'https://i.ytimg.com/vi/v1/mqdefault.jpg'}}},contentDetails:{duration:'PT18M2S'},statistics:{viewCount:'90000000'}}]};
  return new Response(JSON.stringify(body));}) as unknown as typeof fetch;
 const search=await handleCreators({query:'mr beast'},{key:'k',fetcher});
 expect(search.body).toEqual({creators:[{id:'UC1',handle:'mrbeast',title:'MrBeast',avatar:'https://yt3.ggpht.com/a.jpg',subscribers:300000000}]});
 const channel=await handleCreators({handle:'@MrBeast'},{key:'k',fetcher}) as any;
 expect(channel.body.videos).toEqual([{title:'$1 vs $1,000,000',durationSec:1082,views:90000000,publishedAt:'2026-10-01',thumbnail:'https://i.ytimg.com/vi/v1/mqdefault.jpg'}]);
 expect(calls.some(u=>u.includes('forHandle=%40MrBeast'))).toBe(true);
 const failing=(async()=>new Response(JSON.stringify({error:{message:'quota exceeded'}}),{status:403})) as unknown as typeof fetch;
 expect(await handleCreators({query:'x'},{key:'k',fetcher:failing})).toEqual({status:502,body:{error:'YouTube answered 403: quota exceeded'}});
});

it('opens every conversation with what the user wanted in their other projects, newest first, without test copies',()=>{
 const root=home(),current=join(root,'current');mkdirSync(current);
 const notesOf=<T extends {folder:string}>(p:T,notes:string):T=>{const db=new ProjectDB(p.folder,'x');try{db.setMeta('preferences',notes);}finally{db.close();}return p;};
 const white=notesOf(project(root,'Northern vlog','2026-10-16T10:00:00Z',vietnam),'Captions: the user asked for white captions.');
 const shorts=project(root,'Gojo Short','2026-10-17T10:00:00Z',vietnam,{'GUMBO.md':'# Gojo Short: project memory\n\nRoux reads this.\n\n## Preferences\n- Likes vertical shorts with a blurred background.\n\n## Notes\n- The fight starts at 12 s.\n'});
 const evalCopy=notesOf(project(root,'EVAL DeepSeek: cut','2026-10-18T10:00:00Z',vietnam),'Eval run notes.');
 const silent=project(root,'No notes','2026-10-19T10:00:00Z',vietnam);
 expect(styleFromOtherProjects(current,[white,shorts,evalCopy,silent],'6')).toEqual([
  '- Gojo Short (2026-10-17): - Likes vertical shorts with a blurred background.',
  '- Northern vlog (2026-10-16): Captions: the user asked for white captions.',
 ]);
 expect(styleFromOtherProjects(current,[silent],'all')).toEqual([]);
 // The plan decides how many projects are remembered: Free remembers the newest one (also before the plan is known).
 expect(styleFromOtherProjects(current,[white,shorts],'1')).toEqual(['- Gojo Short (2026-10-17): - Likes vertical shorts with a blurred background.']);
 expect(styleFromOtherProjects(current,[white,shorts],undefined)).toHaveLength(1);
 expect(styleFromOtherProjects(current,[white,shorts],'all')).toHaveLength(2);
});

it('spends one monthly creator search per @ search and stops at the plan limit, never for the agent studying a creator',async()=>{
 const {supabaseDb}=await import('../fixtures/supabase-db');const {randomUUID}=await import('node:crypto');
 const db=await supabaseDb(),user=randomUUID();
 await db.query('insert into auth.users(id,email) values($1,$2)',[user,'a@example.com']);await db.query('insert into public.dream_accounts(id,email) values($1,$2)',[user,'a@example.com']);
 const use=async(limit:number)=>(await db.query<{n:number}>('select public.dream_use_allowance($1,$2,$3) as n',[user,'creator_search',limit])).rows[0].n;
 expect([await use(2),await use(2),await use(2)]).toEqual([1,2,-1]);
 expect(await use(3)).toBe(3);
 let searched=0;const fetcher=(async()=>{searched++;return new Response(JSON.stringify({items:[]}));}) as unknown as typeof fetch;
 expect(await handleCreators({query:'mr beast'},{key:'k',fetcher,allow:async()=>({ok:false,limit:10})})).toEqual({status:200,body:{creators:[],limited:{limit:10}}});
 expect(searched).toBe(0);
 let spent=0;await handleCreators({handle:'MrBeast'},{key:'k',fetcher,allow:async()=>{spent++;return{ok:true,limit:10};}});expect(spent).toBe(0);
});
