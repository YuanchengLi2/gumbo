import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveMentions,pastProjects,studyCreator,styleSummary,yourStyle} from '../../apps/project-service/src/mentions';
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

it('resolves media, other projects and creators the @ menu writes, and says what to do with each',()=>{
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

it('reads how a past project was edited, lists the others, and reads its scene files read-only',()=>{
 const root=home(),current=join(root,'current');mkdirSync(current);
 const library=[project(root,'Vietnam trip highlight','2026-10-18T10:00:00Z',vietnam,{'src/title.tsx':'export default function Title(){return null;}'}),project(root,'Older vlog','2026-10-10T10:00:00Z',{...vietnam,captions:undefined})];
 const list=pastProjects({},current,library) as any;
 expect(list.projects.map((p:any)=>p.name)).toEqual(['Vietnam trip highlight','Older vlog']);
 expect(list.projects[0].look).toContain('vivid on 2 clips');
 const detail=pastProjects({project:'vietnam'},current,library) as any;
 expect(detail.style.color.filters).toEqual(['vivid on 2 clips (intensity about 0.4)']);
 expect(detail.style.color.average.saturation).toBe(1.25);
 expect(detail.style.captions).toEqual({style:'word_pop',params:'{"font":"Montserrat","color":"#ffffff"}'});
 expect(detail.style.transitions.used).toEqual(['whip 1']);expect(detail.style.framing.punchIns).toBe(1);
 expect(detail.style.titlesAndScenes[0]).toMatchObject({component:'title.tsx',count:1});
 expect(detail.style.sound.music[0]).toEqual({file:'summer.mp3',gainDb:-16,duckUnderSpeechDb:12});
 expect(detail.files).toEqual(['src/title.tsx']);
 expect((pastProjects({project:'Vietnam',file:'src/title.tsx'},current,library) as any).text).toContain('function Title');
 for(const file of ['../../secret.txt','context/assets.json','C:/Windows/win.ini'])expect(()=>pastProjects({project:'Vietnam',file},current,library)).toThrow();
 expect(()=>pastProjects({project:'Nope'},current,library)).toThrow(/No other project/);
 expect(styleSummary({timeline:{spine:[],attached:[],music:[]}})).toMatchObject({color:'no grading',transitions:'hard cuts only',captions:'none'});
});

it('studies a creator from the style guide, the channel and its thumbnails, and says how to learn an unknown one',async()=>{
 const signal=new AbortController().signal;
 const offline=await studyCreator('@MrBeast',undefined,signal) as any;
 expect(offline.styleGuide.length).toBeGreaterThan(4);expect(offline.rule).toContain('Never use their footage');
 const lookup=async()=>({channel:{title:'Some Creator',handle:'somecreator',subscribers:120000},videos:[{title:'I tried it',durationSec:45,views:1000,thumbnail:'https://i.ytimg.com/vi/x/mqdefault.jpg'},{title:'Long one',durationSec:900,views:5000,thumbnail:'https://evil.example/x.jpg'}]});
 const fetcher=(async()=>new Response(new Uint8Array([255,216,255]),{headers:{'content-type':'image/jpeg'}})) as unknown as typeof fetch;
 const online=await studyCreator('somecreator',lookup,signal,fetcher) as any;
 const text=JSON.parse(online.content[0].text);
 expect(text.latestUploads).toEqual(['I tried it | 0:45 | 1,000 views','Long one | 15:00 | 5,000 views']);expect(text.shortsShare).toBe('50% under a minute');
 // Only YouTube's own thumbnail host is fetched.
 expect(online.content.filter((b:any)=>b.type==='image')).toHaveLength(1);
 expect(text.next).toContain('web_search');
 const unknown=await studyCreator('nobody123',async()=>({notSetUp:true}),signal) as any;
 expect(unknown).toMatchObject({found:false});expect(unknown.next).toContain('web_search');
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

it('carries what the user asked for in their other projects into every request, newest first, without test copies',()=>{
 const root=home(),current=join(root,'current');mkdirSync(current);
 const notesOf=<T extends {folder:string}>(p:T,notes:string):T=>{const db=new ProjectDB(p.folder,'x');try{db.setMeta('preferences',notes);}finally{db.close();}return p;};
 const white=notesOf(project(root,'Northern vlog','2026-10-16T10:00:00Z',vietnam),'Captions: the user asked for white captions.');
 writeFileSync(join(white.folder,'Workspace','context','decisions.json'),JSON.stringify([{scope:'captions',text:'make the caption white'}]));
 const shorts=notesOf(project(root,'Gojo Short','2026-10-17T10:00:00Z',vietnam),'Likes vertical shorts with a blurred background.');
 const evalCopy=notesOf(project(root,'EVAL DeepSeek: cut','2026-10-18T10:00:00Z',vietnam),'Eval run notes.');
 const silent=project(root,'No notes','2026-10-19T10:00:00Z',vietnam);
 const style=(yourStyle(current,[white,shorts,evalCopy,silent],'6') as any).yourStyle;
 expect(style.fromOtherProjects).toEqual([
  {project:'Gojo Short',edited:'2026-10-17',notes:'Likes vertical shorts with a blurred background.'},
  {project:'Northern vlog',edited:'2026-10-16',notes:'Captions: the user asked for white captions.',rules:['make the caption white']},
 ]);
 expect(style.note).toContain('unless this request says otherwise');
 expect(yourStyle(current,[silent],'all')).toEqual({});
 // The plan decides how many projects are remembered: Free remembers the newest one (also before the plan is known).
 expect((yourStyle(current,[white,shorts],'1') as any).yourStyle.fromOtherProjects.map((p:any)=>p.project)).toEqual(['Gojo Short']);
 expect((yourStyle(current,[white,shorts],undefined) as any).yourStyle.fromOtherProjects).toHaveLength(1);
 expect((yourStyle(current,[white,shorts],'all') as any).yourStyle.fromOtherProjects).toHaveLength(2);
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
