// Times Gumbo on the web, headless in Edge, against a served build: the home screen idle and typed into, a long clip
// imported (its processing in the workers), and the editor playing it. For each phase: animation frames (how smooth),
// long tasks on the page's main thread, and how long key presses and clicks took to show. A CPU profile of the page
// over the import and playback lists where its main thread spent the time.
//
//   pnpm --filter @dream/web exec vite build --mode test && GUMBO_TEST_FILES=1 pnpm --filter @dream/web preview
//   node scripts/measure-web-ui.mjs [--clip artifacts/perf/long-1080p.mp4] [--base http://localhost:5181] [--out result.json]
// The clip must be inside the repo (the test build serves it at /app/@fs/). Whisper's model download is blocked, so a
// signed-out import measures the rest of the processing; pass --whisper to allow it.
import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const args=process.argv.slice(2),flag=(name,fallback)=>{const n=args.indexOf('--'+name);return n<0?fallback:args[n+1];};
const base=flag('base','http://localhost:5181'),clip=resolve(flag('clip','artifacts/perf/long-1080p.mp4')),out=flag('out');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1536,height:960}});
if(!args.includes('--whisper'))await page.route(/huggingface\.co|hf\.co\//,route=>route.abort());
const logs=[];page.on('console',m=>{if(['error','warning'].includes(m.type())||m.text().startsWith('[speech]'))logs.push(`${m.type()}: ${m.text()}`);});
await page.addInitScript(()=>{if(window!==window.top)return;
 const w=window;w.__phase=null;w.__m={};const bucket=()=>w.__phase&&(w.__m[w.__phase]??={frames:[],long:[],events:[]});
 let last=0;const frame=t=>{const b=bucket();if(b&&last)b.frames.push(t-last);last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 new PerformanceObserver(list=>{const b=bucket();if(b)for(const e of list.getEntries())b.long.push(e.duration);}).observe({type:'longtask',buffered:false});
 new PerformanceObserver(list=>{const b=bucket();if(b)for(const e of list.getEntries())b.events.push([e.name,e.duration]);}).observe({type:'event',durationThreshold:16,buffered:false});
});
const state=()=>page.evaluate(()=>window.dream.command({type:'state'}));
const phase=name=>page.evaluate(n=>{window.__phase=n;},name);
const summary=async()=>page.evaluate(()=>{const q=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return Math.round(s[Math.min(s.length-1,Math.floor(p*s.length))]);};
 return Object.fromEntries(Object.entries(window.__m).map(([k,b])=>[k,{frames:b.frames.length,frameP50:q(b.frames,.5),frameP95:q(b.frames,.95),frameMax:q(b.frames,1),slowFrames:b.frames.filter(f=>f>50).length,
  longTasks:b.long.length,longMs:Math.round(b.long.reduce((s,d)=>s+d,0)),longMax:q(b.long,1),events:b.events.length,eventP95:q(b.events.map(e=>e[1]),.95),eventMax:q(b.events.map(e=>e[1]),1),
  slowEvents:[...new Set(b.events.filter(e=>e[1]>=100).map(e=>e[0]))]}]));});

const cdp=await page.context().newCDPSession(page);
await page.goto(base+'/app/');await page.getByText('What are we cooking today?').waitFor({timeout:60_000});
await sleep(1500);
await phase('home idle');await sleep(4000);
await phase('home typing');const box=page.getByRole('textbox').first();await box.click();await box.pressSequentially('Make a fast-paced recap of my trip with music that builds',{delay:40});await sleep(500);await box.fill('');

await phase(null);
await page.evaluate(()=>window.dream.createProject({requestId:'measure',text:'',paths:[]}));
await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
await page.getByText('Your canvas is ready').waitFor({timeout:30_000});await sleep(1000);
await phase('editor idle');await sleep(3000);

await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');
await page.getByRole('button',{name:'Media'}).first().click();
const started=Date.now();await phase('importing');
await page.evaluate(async url=>{const file=new File([await (await fetch(url)).blob()],'long.mp4',{type:'video/mp4'}),data=new DataTransfer();data.items.add(file);
 const panel=document.querySelector('.project-media');for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));},'/app/@fs/'+clip.replace(/\\/g,'/'));
const steps={};let ready=false;
for(let i=0;i<300&&!ready;i++){await sleep(1000);const s=await state();for(const j of s.jobs??[]){if(!steps[j.step])steps[j.step]={};if(j.status==='complete'&&!steps[j.step].doneSec)steps[j.step].doneSec=Math.round((Date.now()-started)/1000);steps[j.step].status=j.status;}
 ready=['playback_audio','waveform','preview_proxy','thumbnail'].every(k=>steps[k]?.status==='complete'||steps[k]?.status==='failed');}
// Typing while it still processes (transcription, shots), as someone would.
await phase('typing while processing');const chat=page.getByRole('textbox').first();await chat.click().catch(()=>{});await chat.pressSequentially('Cut the slow parts',{delay:40}).catch(()=>{});await chat.fill('').catch(()=>{});
await phase(null);
const asset=(await state()).footage.assets[0];
await page.evaluate(id=>{const lane=document.querySelector('.manual-track-lane[data-track="video"]'),box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
 const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id).catch(e=>logs.push('place: '+e.message));
await sleep(2000);
await phase('playing');await page.getByRole('button',{name:'Play'}).first().click().catch(e=>logs.push('play: '+e.message));await sleep(10_000);await page.getByRole('button',{name:'Pause'}).first().click().catch(()=>{});
await phase('after');await sleep(3000);
const {profile}=await cdp.send('Profiler.stop');
const result={summary:await summary(),steps,asset:{durationSec:asset?.durationSec,width:asset?.width,height:asset?.height},logs:logs.slice(0,40)};

// Self time by function, over the import and playback.
const self=new Map(),byId=new Map(profile.nodes.map(n=>[n.id,n]));const dt=profile.timeDeltas;
profile.samples.forEach((id,i)=>{const n=byId.get(id),f=n.callFrame,key=`${f.functionName||'(anonymous)'} ${(f.url||'').split('/').pop()}:${f.lineNumber+1}`;self.set(key,(self.get(key)??0)+(dt[i]??0)/1000);});
const total=[...self.values()].reduce((a,b)=>a+b,0);
result.profile={totalMs:Math.round(total),top:[...self.entries()].filter(([k])=>!/^\((idle|program|garbage collector)\)/.test(k)).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>`${Math.round(v)} ms  ${k}`),
 idleMs:Math.round([...self.entries()].filter(([k])=>k.startsWith('(idle)')).reduce((s,[,v])=>s+v,0)),gcMs:Math.round(self.get('(garbage collector) :0')??0)};
console.log(JSON.stringify(result,null,1));
if(out)writeFileSync(out,JSON.stringify({result,profile},null,1));
await browser.close();
