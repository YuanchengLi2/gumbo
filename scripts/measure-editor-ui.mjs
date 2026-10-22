// Times the editor's hand interactions (drag, trim, zoom, scroll, select, typing, a long streamed request, switching
// projects) on a large project, for one or more production renderer builds in ONE app launch, so builds compare under the
// same conditions. The window is never seen: DREAM_HEADLESS keeps it hidden, and it is shown only off-screen, fully
// transparent, click-through and off the taskbar, because a hidden window draws no frames to time.
//
//   node scripts/measure-editor-ui.mjs <label>=<renderer build dir> [...] [--rounds 2] [--out result.json]
// Build a renderer with:  (cd apps/desktop && npx vite build --config vite.renderer.config.ts --outDir <dir>)
import {_electron as electron} from '@playwright/test';
import {mkdtempSync,copyFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const args=process.argv.slice(2),flag=(name,fallback)=>{const n=args.indexOf('--'+name);return n<0?fallback:args[n+1];};
const builds=args.filter((a,n)=>!a.startsWith('--')&&!args[n-1]?.startsWith('--')).map(a=>{const [label,dir]=a.split('=');return{label,url:pathToFileURL(resolve(dir,'index.html')).href};});
const rounds=Number(flag('rounds',2)),out=flag('out'),only=flag('only')?.split(',');
const executable=resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'../../../apps/desktop/out/Dream-win32-x64/Dream.exe'),fixture=resolve(process.env.DREAM_FIXTURE??'../../../artifacts/fixtures/source.mp4');
if(!builds.length||!existsSync(executable)||!existsSync(fixture))throw new Error('Usage: label=buildDir ... (package: '+executable+', fixture: '+fixture+')');
const CLIPS=Number(flag('clips',220)),OVERLAYS=Number(flag('overlays',60)),TURNS=Number(flag('turns',150));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const profile=mkdtempSync(join(tmpdir(),'gumbo-ui-profile-')),source=join(profile,'source.mp4');copyFileSync(fixture,source);
const app=await electron.launch({executablePath:executable,args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
const results=[];
try{
 const page=await app.firstWindow();
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSkipTaskbar(true);w.setOpacity(0);w.setIgnoreMouseEvents(true);w.setBounds({x:-6000,y:-6000,width:1536,height:960});w.webContents.setBackgroundThrottling(false);w.showInactive();});
 await page.waitForFunction(()=>!!window.dream);
 // Every video picture the preview uploads to the graphics card, with the video's time: the picture on screen freezes
 // when that time stops moving while playing (the main thread can be smooth while the preview is not).
 await page.addInitScript(()=>{const ids=new WeakMap();let next=0;window.__pic=[];const wrap=proto=>{const upload=proto.texImage2D;proto.texImage2D=function(...a){const el=a[a.length-1];
  if(window.__picOn&&el instanceof HTMLVideoElement){if(!ids.has(el))ids.set(el,++next);window.__pic.push([performance.now(),ids.get(el),el.currentTime]);}return upload.apply(this,a);};};
  wrap(WebGL2RenderingContext.prototype);
  // Sound against picture: every media element that plays, sampled while the preview plays (same source, same moment).
  window.__media=new Set();const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.__media.add(this);return play.call(this);};
  window.__sync=[];setInterval(()=>{if(!window.__picOn)return;const playing=[...window.__media].filter(m=>!m.paused&&m.readyState>=2),asset=m=>/dream-media:\/\/([^/]+)/.exec(m.src)?.[1];
   for(const a of playing.filter(m=>m instanceof HTMLAudioElement)){const gaps=playing.filter(m=>m instanceof HTMLVideoElement&&asset(m)===asset(a)).map(v=>Math.round(Math.abs(a.currentTime-v.currentTime)*1000));if(gaps.length)window.__sync.push(Math.min(...gaps));if(Math.min(...gaps)>100)(window.__syncOff??=[]).push({at:Math.round(performance.now()),gap:Math.min(...gaps),audio:+a.currentTime.toFixed(2),videos:playing.filter(m=>m instanceof HTMLVideoElement&&asset(m)===asset(a)).map(v=>+v.currentTime.toFixed(2)),audios:playing.filter(m=>m instanceof HTMLAudioElement).length});}},100);});
 const grant=async path=>app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},path);
 // Two projects: the large one, and a second to switch to.
 const folders=[];
 for(const name of ['Large','Second']){const folder=mkdtempSync(join(profile,name+'-'));folders.push(folder);await grant(folder);await page.evaluate(()=>window.dream.pickProject(true));await page.evaluate(async([folder,name])=>window.dream.command({type:'create',folder,name}),[folder,name]);
  await grant(source);const [path]=await page.evaluate(()=>window.dream.pickMedia());await page.evaluate(path=>window.dream.command({type:'import',paths:[path],copy:true}),path);
  const deadline=Date.now()+90000;while(!(await page.evaluate(async()=>(await window.dream.command({type:'state'})).footage.assets[0]?.playback?.ready??false))){if(Date.now()>deadline)throw new Error('Import did not finish');await sleep(500);}
  const state=await page.evaluate(()=>window.dream.command({type:'state'})),asset=state.footage.assets[0].id,clips=name==='Large'?CLIPS:20,overlays=name==='Large'?OVERLAYS:4;
  const ops=[...Array(clips)].map((_,n)=>({type:'insert_clip',position:n,clip:{id:'c'+n,assetId:asset,srcIn:(n*.37)%4,srcOut:(n*.37)%4+1+(n%3)*.5,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'Seed'},reason:'Seed'}))
   .concat([...Array(overlays)].map((_,n)=>({type:'add_item',item:{id:'o'+n,type:'overlay',component:'media',source:{assetId:asset,srcIn:0,srcOut:2},start:{kind:'project',at:'start',offsetSec:n*3.1},durationSec:2,params:{x:.5,y:.5,scale:.4,opacity:1,mute:true,fit:'contain'},layer:n%3,reason:'Seed'},reason:'Seed'})));
  await page.evaluate(([ops,version])=>window.dream.command({type:'apply',ops,label:'Seed',expectedVersionId:version,requestId:crypto.randomUUID(),snapToSpeech:false}),[ops,state.versionId]);}
 const large=folders[0];

 // A long chat history: turns of a request, a reply and a dozen finished steps each.
 const history=base=>{const t0=Date.parse('2026-10-01T10:00:00Z'),messages=[];for(let n=0;n<TURNS;n++){const at=t=>new Date(t0+n*600000+t*1000).toISOString(),turnId='turn-'+n;
  messages.push({id:'u'+n,role:'user',text:`Request ${n}: tighten the pacing in the second act and add a title over clip ${n}.`,createdAt:at(0),turnId});
  messages.push({id:'a'+n,role:'assistant',turnId,createdAt:at(60),text:`I tightened **act two** by trimming ${n%7+2} clips and added the title.\n\n- Cut the pause before the reveal\n- Moved the B-roll under the voice\n- Title: *Chapter ${n}*\n\nThe edit now runs ${30+n%20} seconds.`,
   activity:{steps:[],status:'complete',changes:[],events:[...Array(12)].map((_,k)=>({id:`${turnId}-e${k}`,sequence:k,kind:k%4===3?'commentary':'action',tool:k%4===3?undefined:'edit_file',text:k%4===3?`Looking at clip ${k} and the beat it lands on before changing anything.`:`Edited project.json (clip c${k})`,status:'complete',startedAt:at(k*4),updatedAt:at(k*4+3)}))}});}
  return{...base,messages};};
 const inject=state=>app.evaluate(({BrowserWindow},payload)=>BrowserWindow.getAllWindows()[0].webContents.send('dream:event',{type:'state',payload}),state);
 const openLarge=async()=>{await page.evaluate(folder=>window.dream.command({type:'open',folder}),large);};

 // Recorders inside the page: every frame, long tasks, and slow inputs (Event Timing reports inputs over 16 ms).
 const arm=()=>page.evaluate(()=>{const w=window;w.__perf={frames:[],long:[],events:[]};if(w.__armed)return;w.__armed=true;
  new PerformanceObserver(l=>{for(const e of l.getEntries())w.__perf.long.push(e.duration);}).observe({type:'longtask'});
  new PerformanceObserver(l=>{for(const e of l.getEntries())w.__perf.events.push({name:e.name,dur:e.duration,delay:e.processingStart-e.startTime,run:e.processingEnd-e.processingStart,paint:e.startTime+e.duration-e.processingEnd});}).observe({type:'event',durationThreshold:16});
  const tick=t=>{w.__perf.frames.push(t);requestAnimationFrame(tick);};requestAnimationFrame(tick);});
 const collect=async(label,scenario,started)=>{const p=await page.evaluate(()=>window.__perf);const gaps=p.frames.slice(1).map((t,n)=>t-p.frames[n]).sort((a,b)=>a-b),q=f=>gaps.length?+gaps[Math.min(gaps.length-1,Math.floor(gaps.length*f))].toFixed(1):0;
  const events=p.events.filter(e=>!['pointerover','pointerout','pointerenter','pointerleave','mouseover','mouseout','gotpointercapture','lostpointercapture'].includes(e.name)).map(e=>e.dur).sort((a,b)=>a-b);
  const r={build:label,scenario,ms:Math.round(performance.now()-started),frames:gaps.length,p50:q(.5),p95:q(.95),max:q(1),janky:gaps.filter(g=>g>34).length,longTasks:p.long.length,longMs:Math.round(p.long.reduce((a,b)=>a+b,0)),slowInputs:events.length,inputP95:events.length?Math.round(events[Math.floor(events.length*.95)]):0,inputMax:events.length?Math.round(events.at(-1)):0};
  // Where the slowest inputs' time went: waiting to start, their handlers, and from the handlers to the next frame on screen.
  if(args.includes('--inputs'))console.log(scenario,'slowest inputs',JSON.stringify(p.events.sort((a,b)=>b.dur-a.dur).slice(0,8).map(e=>`${e.name} ${Math.round(e.dur)}=${Math.round(e.delay)}+${Math.round(e.run)}+${Math.round(e.paint)}`)));
  results.push(r);console.log(JSON.stringify(r));return r;};
 // --profile scenario,... writes a CPU profile per build and scenario, and prints the functions that took longest.
 const profiled=flag('profile')?.split(',')??[];let cdp;
 const report=(label,scenario,profile)=>{const nodes=new Map(profile.nodes.map(n=>[n.id,n])),self=new Map(),dt=new Map();profile.samples.forEach((id,n)=>dt.set(id,(dt.get(id)??0)+(profile.timeDeltas[n+1]??0)/1000));
  const parent=new Map();for(const n of profile.nodes)for(const c of n.children??[])parent.set(c,n.id);const total=new Map();
  for(const [id,ms] of dt){const n=nodes.get(id),name=n.callFrame.functionName||'(anonymous)',where=name+' '+n.callFrame.url.split('/').pop()+':'+n.callFrame.lineNumber;self.set(where,(self.get(where)??0)+ms);const seen=new Set();for(let at=id;at!==undefined;at=parent.get(at)){const f=nodes.get(at).callFrame,w=(f.functionName||'(anonymous)')+' '+f.url.split('/').pop()+':'+f.lineNumber;if(!seen.has(w)){seen.add(w);total.set(w,(total.get(w)??0)+ms);}}}
  const top=(m,k)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,k).map(([w,ms])=>ms.toFixed(0).padStart(6)+' '+w).join('\n');
  console.log(`--- ${label} ${scenario} self\n${top(self,25)}\n--- total\n${top(total,45)}`);if(out)writeFileSync(out.replace(/\.json$/,'')+`-${label}-${scenario}.cpuprofile`,JSON.stringify(profile));};
 // --trace scenario,... records a Chromium trace and prints where the renderer's main thread spent its time (script,
 // style, layout, paint), which a CPU profile shows only as "(program)".
 const traced=flag('trace')?.split(',')??[];
 const traceReport=async(label,scenario,file)=>{const {readFileSync}=await import('node:fs'),raw=JSON.parse(readFileSync(file,'utf8')),events=raw.traceEvents??raw;
  const main=new Set(events.filter(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>e.pid+':'+e.tid)),sum=new Map();
  for(const e of events)if(e.ph==='X'&&main.has(e.pid+':'+e.tid)&&e.dur)sum.set(e.name,(sum.get(e.name)??[0,0]).map((v,n)=>v+(n?1:e.dur/1000)));
  // The other threads that draw a frame: compositor, raster workers, viz and the GPU process.
  const names=new Map(events.filter(e=>e.name==='thread_name').map(e=>[e.pid+':'+e.tid,e.args.name])),per=new Map();
  for(const e of events)if(e.ph==='X'&&e.dur){const t=names.get(e.pid+':'+e.tid)??'';if(!/Compositor|Viz|CrGpuMain|Raster|Media/.test(t))continue;const k=t.replace(/\d+$/,'')+' / '+e.name;per.set(k,(per.get(k)??0)+e.dur/1000);}
  console.log(`--- ${label} ${scenario} drawing threads (ms)\n`+[...per].sort((a,b)=>b[1]-a[1]).slice(0,25).map(([k,ms])=>ms.toFixed(0).padStart(6)+' '+k).join('\n'));
  console.log(`--- ${label} ${scenario} trace (ms, count)\n`+[...sum].filter(([n])=>!/^(ThreadControllerImpl|RunTask|TaskQueue|Sequence|SimpleWatcher|Receive|MessagePipe|Scheduler|BlinkScheduler|ThreadPool)/.test(n)).sort((a,b)=>b[1][1]-a[1][1]).slice(0,22).map(([n,[c,ms]])=>ms.toFixed(0).padStart(6)+' '+String(c).padStart(5)+' '+n).join('\n'));};
 const measure=async(label,scenario,fn)=>{if(only&&!only.includes(scenario))return;await sleep(400);await arm();const profiling=profiled.includes(scenario),tracing=traced.includes(scenario);if(profiling){cdp??=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:200});await cdp.send('Profiler.start');}
  if(tracing)await app.evaluate(({contentTracing})=>contentTracing.startRecording({included_categories:['devtools.timeline','disabled-by-default-devtools.timeline','__metadata']}));
  const started=performance.now();await fn();await sleep(150);const r=await collect(label,scenario,started);if(profiling)report(label,scenario,(await cdp.send('Profiler.stop')).profile);
  if(tracing)await traceReport(label,scenario,await app.evaluate(({contentTracing})=>contentTracing.stopRecording()));return r;};

 const box=async selector=>{const b=await page.locator(selector).first().boundingBox();if(!b)throw new Error('Not on screen: '+selector);return b;};
 const visibleClip=async n=>page.evaluate(n=>{const lane=document.querySelector('.manual-timeline-scroll').getBoundingClientRect(),clips=[...document.querySelectorAll('.manual-track.video .manual-clip.timeline-item')].map(e=>e.getBoundingClientRect()).filter(r=>r.left>lane.left+80&&r.right<lane.right-20&&r.width>14);const r=clips[n%Math.max(1,clips.length)];return r&&{x:r.left+r.width/2,y:r.top+r.height/2,left:r.left,right:r.right};},n);
 const drag=async(from,dx,steps)=>{await page.mouse.move(from.x,from.y);await page.mouse.down();for(let n=1;n<=steps;n++){await page.mouse.move(from.x+dx*n/steps,from.y);await sleep(16);}await page.keyboard.press('Escape');await page.mouse.up();};
 const layout=async name=>{await page.locator(`.layout-switch [role=radio]:has-text("${name}")`).click();await page.locator('.manual-timeline').waitFor();await sleep(800);};

 async function load(label,url){
  await openLarge();await page.goto(url);await page.locator('.manual-timeline .manual-clip').first().waitFor({timeout:60000});
  let state=await page.evaluate(()=>window.dream.command({type:'state'}));
  // The window's own first read of the project can land after the history, so it is sent until it shows.
  // The service's state moves on while it still prepares the imported media, and an older one is refused: read it again each time.
  for(let n=0;;n++){const fresh=n?await page.evaluate(()=>window.dream.command({type:'state'})):state;await inject(history(fresh));try{await page.locator('.conversation-turn').nth(TURNS-1).waitFor({state:'attached',timeout:10000});state=fresh;break;}catch(error){if(n>=5)throw error;}}await sleep(2500);
  // Zoom in so the timeline holds more than a screen: scrolling and the off-screen clips matter.
  for(let n=0;n<6;n++)await page.keyboard.press('Equal');await sleep(500);return state;}

 // --geometry: where every element of a few chat turns (mid-history and at the bottom) and the timeline's blocks sit, so
 // builds can be checked to draw the same picture.
 const geometry={};
 const shape=()=>page.evaluate(()=>{const round=v=>Math.round(v*10)/10,scroller=document.querySelector('.sidebar-scroll'),turns=[...document.querySelectorAll('.conversation-turn')];
  const of=(nodes)=>nodes.map(t=>{const r=t.getBoundingClientRect();return{h:round(r.height),kids:[...t.querySelectorAll('*')].filter(e=>e.getClientRects().length).map(e=>{const k=e.getBoundingClientRect();return e.tagName+'.'+e.className.toString().slice(0,30)+' '+[k.left-r.left,k.top-r.top,k.width,k.height].map(round).join(',');})};});
  const gaps=nodes=>nodes.slice(1).map((t,n)=>round(t.getBoundingClientRect().top-nodes[n].getBoundingClientRect().bottom));
  const out={};turns[100].scrollIntoView({block:'start'});out.mid={turns:of(turns.slice(100,103)),gaps:gaps(turns.slice(100,103))};
  scroller.scrollTop=scroller.scrollHeight;out.bottom={turns:of(turns.slice(-3)),gaps:gaps(turns.slice(-3))};
  out.clips=[...document.querySelectorAll('.manual-clip')].slice(0,40).map(e=>{const k=e.getBoundingClientRect();return e.className+' '+[k.left,k.top,k.width,k.height].map(round).join(',')+' '+e.innerHTML.length;});return out;});
 async function run(label,url){
  const state=await load(label,url);
  if(args.includes('--geometry')){await shape();await sleep(500);geometry[label]=await shape();const first=Object.values(geometry)[0],now=geometry[label];
   const diff=(a,b,path)=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(Array.isArray(a)&&Array.isArray(b)&&a.length===b.length){a.forEach((x,n)=>diff(x,b[n],path+'['+n+']'));return;}if(a&&b&&typeof a==='object'&&!Array.isArray(a)){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],path+'.'+k);return;}console.log('geometry differs',path,JSON.stringify(a)?.slice(0,300),'→',JSON.stringify(b)?.slice(0,300));};
   if(first!==now)diff(first,now,label);console.log('geometry checked',label);
   // Pictures to compare by eye: the timeline, and the chat box with a selected clip and a hovered one.
   if(out){const c=await visibleClip(5);await page.mouse.click(c.x,c.y);await sleep(2500);const base=out.replace(/\.json$/,'')+'-'+label;await page.locator('.manual-timeline').screenshot({path:base+'-timeline.png'});await page.locator('.composer').screenshot({path:base+'-composer.png'});
    // The player at the clip's first frame, the frame its tile should show.
    await page.mouse.click(c.x,c.y,{button:'right'});await page.locator('.clip-menu button:has-text("Move playhead to start")').click();await sleep(1500);await page.locator('.preview-frame').screenshot({path:base+'-player.png'});
    const tile=page.locator('.selection-strip .media-tile').first();await tile.hover();await sleep(1200);await page.locator('.composer').screenshot({path:base+'-composer-hover.png'});await page.mouse.move(5,5);await page.keyboard.press('Escape');await sleep(300);}}
  // --css: a style added for an experiment (what a cost disappears without).
  if(flag('css'))await page.addStyleTag({content:flag('css')});if(flag('eval'))await page.evaluate(flag('eval'));
  await measure(label,'idle',()=>sleep(2000));
  await measure(label,'select',async()=>{for(let n=0;n<24;n++){const c=await visibleClip(n*3);await page.mouse.click(c.x,c.y,{modifiers:n%4===3?['Shift']:[]});await sleep(60);}});
  await measure(label,'drag',async()=>{const c=await visibleClip(4);await drag(c,240,60);});
  await measure(label,'trim',async()=>{const c=await visibleClip(6);await drag({x:c.right-3,y:c.y},120,40);});
  const lane=await box('.manual-timeline-scroll');
  await measure(label,'scroll',async()=>{await page.mouse.move(lane.x+lane.width/2,lane.y+60);for(let n=0;n<40;n++){await page.mouse.wheel(n<20?60:-60,0);await sleep(16);}});
  await measure(label,'zoom',async()=>{await page.mouse.move(lane.x+lane.width/2,lane.y+60);await page.keyboard.down('Control');for(let n=0;n<16;n++){await page.mouse.wheel(0,n<8?-100:100);await sleep(40);}await page.keyboard.up('Control');
   await page.locator('input[aria-label="Timeline zoom"]').focus();for(let n=0;n<20;n++){await page.keyboard.press(n<10?'ArrowRight':'ArrowLeft');await sleep(30);}});
  const composer=page.locator('textarea[aria-label="Ask Gumbo to edit"]');
  await measure(label,'typing',async()=>{await composer.focus();await page.keyboard.type('make the second act tighter and add a lower third ',{delay:30});await composer.fill('');});
  // A long request streams: notes word by word, steps starting and finishing, usage; typing meanwhile.
  await measure(label,'streaming',async()=>{const state=await page.evaluate(()=>window.dream.command({type:'state'})),turnId='live-turn',now=new Date().toISOString(),live=history(state);live.messages.push({id:'ulive',role:'user',text:'Rework the whole edit',createdAt:now,turnId});
   await inject({...live,aiStatus:'running',experience:{...(state.experience??{firstDraftVersionId:null}),turnId,steps:[],runStartedAt:now,activity:{steps:[],status:'running',changes:[],events:[],phase:'editing'}}});await sleep(300);
   const streaming=app.evaluate(({BrowserWindow},turnId)=>new Promise(done=>{const w=BrowserWindow.getAllWindows()[0].webContents,send=(type,payload)=>w.send('dream:event',{type,payload,turnId});let n=0,text='',step=0;
    const timer=setInterval(()=>{n++;text+=' word'+n;const requestId='note-'+Math.floor(n/60);send('ai.commentary',{turnId,requestId,text:n%60?text.split(' ').slice(-(n%60)).join(' '):'',status:'streaming'});
     if(n%30===0){step++;const at=new Date().toISOString();send('ai.activity',{turnId,event:{id:'s'+step,sequence:1000+step,kind:'action',tool:'edit_file',text:'Edited project.json (clip c'+step+')',status:'running',startedAt:at,updatedAt:at}});if(step>1)send('ai.activity',{turnId,event:{id:'s'+(step-1),sequence:1000+step-1,revision:1,kind:'action',tool:'edit_file',text:'Edited project.json (clip c'+(step-1)+')',status:'complete',startedAt:at,updatedAt:at}});}
     if(n%60===0)send('ai.usage',{turnId,model:'deepseek-flash',costUsd:.001,durationMs:900,usage:{input_tokens:9000,output_tokens:400}});
     if(n>=240){clearInterval(timer);done();}},25);}),turnId);
   await sleep(500);await composer.focus();await page.keyboard.type('also fix the color on the last clip ',{delay:40});await streaming;await composer.fill('');});
  await inject(history(state));await sleep(1000);
  // --keys: the chat box disappears while it is typed in (as when the editor layout comes back after a run); the next
  // letters must not split the timeline or play the preview.
  if(args.includes('--keys')){const c=await visibleClip(3);await page.mouse.click(c.x,c.y);await composer.focus();await page.keyboard.type('tighten ',{delay:20});const count=()=>page.locator('.manual-clip.timeline-item').count(),before=await count();
   await composer.evaluate(e=>{window.__box={e,parent:e.parentNode,next:e.nextSibling};e.remove();});await sleep(200);await page.keyboard.press('s');await page.keyboard.press('Space');await page.keyboard.press('Delete');await sleep(800);
   const playing=await page.locator('button[aria-label="Pause"]').count(),after=await count();await page.evaluate(()=>{const b=window.__box;b.parent.insertBefore(b.e,b.next);});await composer.fill('');
   console.log(JSON.stringify({build:label,check:'keys',splitOrDeleted:after!==before,playing:playing>0,activeIsChat:await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'))}));}
  // --qol: media dragged from the library shows where it lands and lands there; a trim shows its edge's frame in the
  // preview and gives the playhead's back when it ends.
  if(args.includes('--qol')){await page.evaluate(()=>document.activeElement?.blur?.());await page.keyboard.press('Home');await sleep(800);
   await page.evaluate(()=>{window.__pic=[];window.__picOn=true;});await sleep(500);const shown=async()=>page.evaluate(()=>{const p=window.__pic;window.__pic=[];return [...new Set(p.map(e=>e[2].toFixed(2)))];});const before=await shown();
   const c=await visibleClip(6);await page.mouse.move(c.right-3,c.y);await page.mouse.down();for(let n=1;n<=20;n++){await page.mouse.move(c.right-3-n*3,c.y);await sleep(20);}await sleep(400);const during=await shown();
   await page.keyboard.press('Escape');await page.mouse.up();await sleep(800);const after=await shown();
   console.log(JSON.stringify({build:label,check:'trim-peek',before,during:during.slice(-3),after:after.slice(-3)}));
   await page.evaluate(()=>{window.__picOn=false;});
   // Native drags cannot be driven from outside here, so the drag's own events are sent, carrying the asset as the library does.
   const spine=async()=>(await page.evaluate(()=>window.dream.command({type:'state'}))).timeline.spine.length,clips=await spine(),assetId=(await page.evaluate(()=>window.dream.command({type:'state'}))).footage.assets[0].id;
   const mark=await page.evaluate(async id=>{const lane=document.querySelector('.manual-track.video .manual-track-lane'),edges=[...document.querySelectorAll('.manual-track.video .manual-clip.timeline-item')].map(e=>e.getBoundingClientRect().left).filter(x=>x>lane.getBoundingClientRect().left+60),x=edges[3]+4,y=lane.getBoundingClientRect().top+20,data=new DataTransfer();data.setData('application/x-dream-asset',id);
    const send=type=>lane.dispatchEvent(new DragEvent(type,{dataTransfer:data,clientX:x,clientY:y,bubbles:true,cancelable:true}));send('dragenter');send('dragover');await new Promise(r=>setTimeout(r,300));const m=document.querySelector('.cut-target'),r=m?.getBoundingClientRect();
    const out=r?{offEdgePx:Math.round(r.left+r.width/2-edges[3]),pointerPx:4}:null;send('drop');return out;},assetId);
   await sleep(2500);console.log(JSON.stringify({build:label,check:'drop-mark',mark,clipsAdded:(await spine())-clips}));}

  // --playback: playing through the cuts, starting and stopping, and scrubbing, timed by the preview's own pictures.
  if(args.includes('--playback')){
   const pictures=async from=>{const pic=await page.evaluate(()=>{const p=window.__pic;window.__pic=[];return p;}),changes=[];let last;
    for(const [t,id,time] of pic){const k=id+':'+time.toFixed(3);if(k!==last){changes.push(t);last=k;}}
    const gaps=changes.slice(2).map((t,n)=>t-changes[n+1]);return{first:changes.length>1?Math.round(changes[1]-from):null,updates:changes.length,longest:Math.round(Math.max(0,...gaps)),stalls:gaps.filter(g=>g>100).length,last:changes.length?Math.round(changes.at(-1)-from):null};};
   const press=async key=>{const at=await page.evaluate(()=>performance.now());await page.keyboard.press(key);return at;};
   await page.evaluate(()=>document.activeElement?.blur?.());await page.keyboard.press('Home');await sleep(1500);
   await measure(label,'play',async()=>{await page.evaluate(()=>{window.__pic=[];window.__picOn=true;});await page.evaluate(()=>{window.__sync=[];});const at=await press('Space');await sleep(8000);await page.keyboard.press('Space');const r=await pictures(at),sync=(await page.evaluate(()=>window.__sync)).map(Math.abs).sort((a,b)=>a-b);r.syncOff=await page.evaluate(()=>{const o=window.__syncOff;window.__syncOff=[];return o;});r.syncMs=sync.length?{p50:sync[sync.length>>1],p95:sync[Math.floor(sync.length*.95)],n:sync.length}:null;console.log(JSON.stringify({build:label,check:'play',...r}));await sleep(600);});
   await measure(label,'playpause',async()=>{const firsts=[];for(let n=0;n<4;n++){await page.evaluate(()=>{window.__pic=[];});const at=await press('Space');await sleep(700);firsts.push((await pictures(at)).first);await page.keyboard.press('Space');await sleep(500);}console.log(JSON.stringify({build:label,check:'playpause',firsts}));});
   const ruler=await box('.project-player .scrubber');
   await measure(label,'scrub',async()=>{await page.evaluate(()=>{window.__pic=[];});const y=ruler.y+ruler.height/2;await page.mouse.move(ruler.x+20,y);await page.mouse.down();for(let n=1;n<=60;n++){await page.mouse.move(ruler.x+20+n*(ruler.width-40)/60,y);await sleep(16);}const up=await page.evaluate(()=>performance.now());await page.mouse.up();await sleep(1200);
    const r=await pictures(up);console.log(JSON.stringify({build:label,check:'scrub',updates:r.updates,settledAfterRelease:r.last}));});
   await page.evaluate(()=>{window.__picOn=false;});await page.keyboard.press('Home');}
  await measure(label,'switch',async()=>{for(let n=0;n<2;n++){await page.locator('button[aria-label="Back to projects"]').click();await page.locator('.project-card').first().waitFor();await page.locator('.project-card',{hasText:n?'Large':'Second'}).first().click();await page.locator('.manual-timeline .manual-clip').first().waitFor();await sleep(600);}});
  // The editor layout: properties and handles follow selection and drags too.
  if(!only||only.some(s=>s.startsWith('editor'))){await openLarge();await page.goto(url);await page.locator('.manual-timeline .manual-clip').first().waitFor({timeout:60000});await layout('Editor');for(let n=0;n<6;n++)await page.keyboard.press('Equal');await sleep(800);
   await measure(label,'editor-select',async()=>{for(let n=0;n<24;n++){const c=await visibleClip(n*3);await page.mouse.click(c.x,c.y);await sleep(60);}});
   await measure(label,'editor-drag',async()=>{const c=await visibleClip(4);await drag(c,240,60);});
   await layout('Gumbo');}
 }
 for(let round=0;round<rounds;round++)for(const b of builds)await run(b.label,b.url);
}finally{
 // The service can be busy (making proxies of the imported media); the copy is ended either way so none is left behind.
 const pid=app.process().pid;await Promise.race([app.close().catch(()=>{}),sleep(15000)]);try{if(process.platform==='win32')(await import('node:child_process')).execSync(`taskkill /PID ${pid} /T /F`,{stdio:'ignore'});else process.kill(pid);}catch{}}

// Medians per build and scenario across rounds.
const median=v=>{const s=[...v].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];},keys=['ms','p50','p95','max','janky','longTasks','longMs','slowInputs','inputP95','inputMax'];
const table={};for(const r of results){const k=r.scenario;table[k]??={};(table[k][r.build]??=[]).push(r);}
const summary=Object.fromEntries(Object.entries(table).map(([scenario,byBuild])=>[scenario,Object.fromEntries(Object.entries(byBuild).map(([b,rs])=>[b,Object.fromEntries(keys.map(k=>[k,median(rs.map(r=>r[k]))]))]))]));
console.log('\nmedians:');for(const [scenario,byBuild] of Object.entries(summary))for(const [b,m] of Object.entries(byBuild))console.log(scenario.padEnd(14),b.padEnd(10),keys.map(k=>k+'='+m[k]).join(' '));
if(out)writeFileSync(out,JSON.stringify({results,summary},null,1));
