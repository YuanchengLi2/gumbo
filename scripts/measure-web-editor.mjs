// Times the hand editor on the web, headless in Edge, against a served build: a timeline of several clips and a title,
// then dragging a clip, trimming one, scrubbing, zooming and playing. Per phase: animation frames, long tasks on the
// page's main thread and how long input took to show; a CPU profile names where the main thread spent it.
//
//   pnpm --filter @dream/web exec vite build --mode test && GUMBO_TEST_FILES=1 pnpm --filter @dream/web preview
//   node scripts/measure-web-editor.mjs [--base http://localhost:5181] [--clips 8] [--out result.json]
import {chromium} from '@playwright/test';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

const args=process.argv.slice(2),flag=(name,fallback)=>{const n=args.indexOf('--'+name);return n<0?fallback:args[n+1];};
const base=flag('base','http://localhost:5181'),clips=Number(flag('clips',8)),out=flag('out');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1536,height:960}});
// Whisper's model is not downloaded: speech is not what is measured here.
await page.route(/huggingface\.co|hf\.co\//,route=>route.abort());
await page.addInitScript(()=>{if(window!==window.top)return;const w=window;w.__phase=null;w.__m={};const bucket=()=>w.__phase&&(w.__m[w.__phase]??={frames:[],long:[],events:[]});
 let last=0;const frame=t=>{const b=bucket();if(b&&last)b.frames.push(t-last);last=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 new PerformanceObserver(l=>{const b=bucket();if(b)for(const e of l.getEntries())b.long.push(e.duration);}).observe({type:'longtask'});
 new PerformanceObserver(l=>{const b=bucket();if(b)for(const e of l.getEntries())b.events.push([e.name,e.duration]);}).observe({type:'event',durationThreshold:16});});
// Every command the editor sends, with how long the project worker took to answer it.
await page.addInitScript(()=>{if(window!==window.top)return;window.__cmd=[];const wrap=()=>{const d=window.dream;if(!d||d.__wrapped)return;const c=d.command;d.command=async x=>{const t=performance.now();try{return await c(x);}finally{window.__cmd.push([x?.type,Math.round(performance.now()-t)]);}};d.__wrapped=true;};const iv=setInterval(()=>{wrap();if(window.dream?.__wrapped)clearInterval(iv);},5);});
const phase=name=>page.evaluate(n=>{window.__phase=n;},name);
const state=()=>page.evaluate(()=>window.dream.command({type:'state'}));

await page.goto(base+'/app/');await page.getByText('What are we cooking today?').waitFor({timeout:90_000});
await page.evaluate(()=>window.dream.createProject({requestId:'measure-editor',text:'',paths:[]}));await page.reload();
await page.getByRole('button',{name:'Untitled project'}).first().click();await page.getByText('Your canvas is ready').waitFor({timeout:30_000});
await page.evaluate(async url=>{const blob=await (await fetch(url)).blob();const paths=await window.dream.registerDropped([new File([blob],'a.mp4',{type:'video/mp4'}),new File([blob],'b.mp4',{type:'video/mp4'})]);await window.dream.command({type:'import',paths,copy:true});},'/app/@fs/'+resolve('artifacts/fixtures/source.mp4').split('\\').join('/'));
await page.waitForFunction(async()=>{const s=await window.dream.command({type:'state'});return s.footage.assets.length===2&&s.footage.assets.every(a=>a.status==='ready');},null,{timeout:90_000});
// Once importing has settled (speech may still be heard), the hand editor.
await page.waitForFunction(async()=>(await window.dream.command({type:'state'})).jobs.every(j=>!['running','queued'].includes(j.status)),null,{timeout:120_000});
await sleep(1000);await page.getByRole('radio',{name:/Editor/}).click();await page.getByRole('button',{name:/^Text$/}).first().waitFor({timeout:10_000});await sleep(800);
const ids=(await state()).footage.assets.map(a=>a.id);
for(let n=0;n<clips;n++){await page.evaluate(id=>{const lane=document.querySelector('.manual-track-lane[data-track="video"]');const box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
 const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},ids[n%2]);await sleep(1500);}
try{await page.getByRole('button',{name:/^Text$/}).first().click({timeout:5000});await sleep(500);await page.getByText('Bold title').first().click();await sleep(800);}catch{await page.screenshot({path:'artifacts/perf/editor-no-text.png'});console.log('no Text panel button; see artifacts/perf/editor-no-text.png');}
await page.getByRole('button',{name:/^Media$/}).first().click({timeout:5000}).catch(()=>{});await sleep(1500);
console.log('timeline:',(await state()).timeline.spine.length,'clips');
{const cmds=await page.evaluate(()=>window.__cmd.filter(([t])=>t!=='state'));const by={};for(const [t,ms] of cmds)(by[t]??=[]).push(ms);console.log('setup commands (ms):',JSON.stringify(by));}
console.log('layout:',await page.evaluate(()=>[...document.querySelectorAll('.layout-switch button')].map(b=>b.textContent+'='+b.getAttribute('aria-checked')).join(' ')),'video items:',await page.locator('.manual-track-lane[data-track="video"] .timeline-item').count(),'all items:',await page.locator('.timeline-item').count());
await page.screenshot({path:'artifacts/perf/editor-setup.png'});

const cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');
const items=page.locator('.manual-track-lane[data-track="video"] .timeline-item');
const centre=async i=>{const b=await items.nth(i).boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2,b};};
await phase('idle');await sleep(2000);
// Select a clip, then drag it along its track.
await phase('select');const c1=await centre(1);await page.mouse.click(c1.x,c1.y);await sleep(800);
await phase('drag clip');await page.mouse.move(c1.x,c1.y);await page.mouse.down();for(let s=1;s<=60;s++){await page.mouse.move(c1.x+s*4,c1.y);await sleep(16);}await page.mouse.up();await sleep(800);
// Trim the right edge of another clip.
await phase('trim');const c2=await centre(0);const edge={x:c2.b.x+c2.b.width-2,y:c2.y};await page.mouse.move(edge.x,edge.y);await page.mouse.down();for(let s=1;s<=40;s++){await page.mouse.move(edge.x-s*3,edge.y);await sleep(16);}await page.mouse.up();await sleep(800);
// Scrub along the ruler.
await phase('scrub');const ruler=await page.locator('.manual-ruler, .timeline-ruler, [class*="ruler"]').first().boundingBox();
if(ruler){await page.mouse.move(ruler.x+20,ruler.y+ruler.height/2);await page.mouse.down();for(let s=1;s<=60;s++){await page.mouse.move(ruler.x+20+s*12,ruler.y+ruler.height/2);await sleep(16);}await page.mouse.up();}await sleep(800);
// Zoom the timeline with its slider.
await phase('zoom');const zoom=page.locator('input[type=range]').last();const zb=await zoom.boundingBox();if(zb){await page.mouse.move(zb.x+zb.width*.3,zb.y+zb.height/2);await page.mouse.down();for(let s=1;s<=30;s++){await page.mouse.move(zb.x+zb.width*(.3+s*.015),zb.y+zb.height/2);await sleep(20);}await page.mouse.up();}await sleep(800);
// Play.
await phase('play');await page.getByRole('button',{name:'Play'}).first().click();await sleep(5000);await page.getByRole('button',{name:'Pause'}).first().click().catch(()=>{});
await phase(null);
const {profile}=await cdp.send('Profiler.stop');
const summary=await page.evaluate(()=>{const q=(a,p)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return Math.round(s[Math.min(s.length-1,Math.floor(p*s.length))]);};
 return Object.fromEntries(Object.entries(window.__m).map(([k,b])=>[k,{frames:b.frames.length,p50:q(b.frames,.5),p95:q(b.frames,.95),max:q(b.frames,1),slow:b.frames.filter(f=>f>34).length,long:b.long.length,longMs:Math.round(b.long.reduce((s,d)=>s+d,0)),eventP95:q(b.events.map(e=>e[1]),.95),eventMax:q(b.events.map(e=>e[1]),1)}]));});
console.table(summary);
const cmds=await page.evaluate(()=>window.__cmd.filter(([t])=>t!=='state'));const by={};for(const [t,ms] of cmds)(by[t]??=[]).push(ms);console.log('commands (ms):',JSON.stringify(by));
const self=new Map(),byId=new Map(profile.nodes.map(n=>[n.id,n]));profile.samples.forEach((id,i)=>{const f=byId.get(id).callFrame,key=`${f.functionName||'(anon)'} ${(f.url||'').split('/').pop()}:${f.lineNumber+1}:${f.columnNumber+1}`;self.set(key,(self.get(key)??0)+(profile.timeDeltas[i]??0)/1000);});
console.log([...self.entries()].filter(([k])=>!/^\((idle|program|garbage collector)\)/.test(k)).sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,v])=>`${Math.round(v)} ms  ${k}`).join('\n'));
console.log('gc ms',Math.round([...self.entries()].filter(([k])=>k.startsWith('(garbage')).reduce((s,[,v])=>s+v,0)));
if(out)writeFileSync(out,JSON.stringify({summary,profile}));
await browser.close();
