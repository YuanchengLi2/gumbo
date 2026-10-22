import {test,expect} from '@playwright/test';
import {existsSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {liveSession,videoLength,outOfRange,type Session} from './live-session';

/** A lean stress matrix for Roux 1 (Auto): twelve projects, each its own content and a request or two that tends to go
 * wrong (vague, follow-ups, undo and ask again, captions and music, impossible, not in English), in the packaged app with
 * no window, then an export. Each step records status, cost, calls and failures (session.json, session-report.txt in the
 * project folder); a case's problems are soft, so the whole matrix always runs. Live spend: run only when approved. */
const CONTENT=resolve('artifacts/stress-content'),files=(dir:string)=>readdirSync(join(CONTENT,dir)).filter(f=>/\.(mp4|jpg)$/.test(f)).map(f=>join(CONTENT,dir,f));
const AUTO={model:'auto' as const};
const captions=(s:any)=>!!(s.timeline.captions?.style||s.timeline.attached.some((i:any)=>i.kind==='caption'||i.type==='caption'||i.text));
const music=(s:any)=>s.timeline.music.length>0;
const lengthIn=(lo:number,hi:number)=>(s:any)=>{const n=videoLength(s);return n>=lo&&n<=hi?undefined:`length ${n.toFixed(1)} s, wanted ${lo}-${hi} s`;};
const base=(s:any)=>!s.timeline.spine.length?'empty timeline':outOfRange(s).length?`clips past their source: ${outOfRange(s).join(', ')}`:undefined;
const all=(...checks:((s:any)=>string|undefined)[])=>(_b:any,a:any)=>checks.map(c=>c(a)).filter(Boolean).join('; ')||undefined;
const need=(what:string,ok:(s:any)=>boolean)=>(s:any)=>ok(s)?undefined:`no ${what}`;
const spanish=(_b:any,a:any)=>/\b(?:he|los|las|subtítulos|silencios|añadido|quitado|vídeo)\b/i.test(a.messages.filter((m:any)=>m.role==='assistant').at(-1)?.text??'')?undefined:'reply not in Spanish';
const japanese=(_b:any,a:any)=>/[぀-ヿ一-龯]/.test(a.messages.filter((m:any)=>m.role==='assistant').at(-1)?.text??'')?undefined:'reply not in Japanese';

/** Exports the current edit through the export window, as a user does, and checks the file plays for the timeline's length. */
async function exportEdit(session:Session,name:string){
 const {app,page,folder}=session,out=join(folder,'Exports');
 await app.evaluate(({dialog}:any,out:string)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[out]});},out);
 await page.getByRole('button',{name:'Export',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'Export'});
 await dialog.getByLabel('Choose folder').click();await dialog.getByLabel('Name').fill(name);
 const started=Date.now();await dialog.getByRole('button',{name:'Export',exact:true}).click();
 await expect(dialog.getByText('Exported')).toBeVisible({timeout:1_800_000});
 const file=join(out,name+'.mp4'),probe=process.env.DREAM_FFPROBE??resolve('../../../node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe');
 const seconds=existsSync(file)?Number(spawnSync(probe,['-v','error','-show_entries','format=duration','-of','csv=p=0',file],{encoding:'utf8'}).stdout.trim()):0;
 const state=await session.state(),wanted=videoLength(state),problem=!existsSync(file)||!statSync(file).size?'no export file':Math.abs(seconds-wanted)>.5?`export is ${seconds.toFixed(1)} s, timeline ${wanted.toFixed(1)} s`:undefined;
 session.record({name:'export',request:'export',status:problem?'failed':'complete',problem,targets:{},seconds:Math.round((Date.now()-started)/1000)});
 expect.soft(problem,'export').toBeUndefined();
}

type Case={name:string;content:string[];steps:{text:string;check?:(b:any,a:any)=>string|undefined;expect?:string;undoFirst?:boolean}[]};
const cases:Case[]=[
 {name:'talking-captions-music',content:files('talking'),steps:[{text:'Add captions and some quiet background music under the speech.',check:all(base,need('captions',captions),need('music',music))}]},
 {name:'talking-spanish',content:files('talking'),steps:[{text:'Quita los silencios y pon subtítulos grandes en el centro.',check:(b,a)=>[all(base,need('captions',captions))(b,a),spanish(b,a)].filter(Boolean).join('; ')||undefined}]},
 {name:'gameplay-vague',content:files('gameplay'),steps:[{text:'make it better',check:all(base)}]},
 {name:'gameplay-montage',content:files('gameplay'),steps:[{text:'Make a 30-second montage of the funniest fails with captions and music.',check:all(base,lengthIn(20,40),need('captions',captions),need('music',music))}]},
 {name:'skate-follow-up',content:files('skate'),steps:[{text:'Make a punchy 15-second edit cut on the action.',check:all(base,lengthIn(12,18))},{text:'Now slow down the last trick and add a title at the start that says SKATE DAY.',check:all(base)}]},
 {name:'skate-undo-reask',content:files('skate'),steps:[{text:'Put the clips in order and give them a strong teal-and-orange grade.',check:all(base)},{text:'Add the grade again, but much subtler this time.',undoFirst:true,check:all(base)}]},
 {name:'photos-slideshow',content:files('photos'),steps:[{text:'Turn these photos into a 20-second slideshow with gentle motion and music.',check:all(base,lengthIn(15,25),need('music',music))}]},
 {name:'4k-vertical',content:files('4k'),steps:[{text:'Make it vertical 9:16 for TikTok and speed-ramp into the trick.',check:all(base,need('vertical canvas',s=>s.timeline.settings.height>s.timeline.settings.width))}]},
 {name:'long-highlight',content:files('long'),steps:[{text:'Find the three best moments and make a 20-second highlight.',check:all(base,lengthIn(15,25))}]},
 {name:'shorts-rhythm',content:files('shorts'),steps:[{text:'Arrange these into a 20-second edit that cuts to a steady rhythm.',check:all(base,lengthIn(16,24))}]},
 // An honest refusal can end either way; the case looks for a hang, a loop or a blowup, and for a reply that says so.
 {name:'skate-impossible',content:files('skate'),steps:[{text:'Replace the skater with a real elephant doing the same trick, filmed for real, in 8K.',expect:'any'}]},
 {name:'skate-japanese',content:files('skate'),steps:[{text:'もっとかっこよくして、最後にタイトルを入れて。',check:(b,a)=>[all(base)(b,a),japanese(b,a)].filter(Boolean).join('; ')||undefined}]},
];

for(const c of cases)test(`roux stress: ${c.name}`,async()=>{
 test.skip(process.env.DREAM_ROUX_STRESS!=='1','Live spend: run only when approved.');test.setTimeout(3_600_000);
 if(process.env.DREAM_ROUX_CASES&&!process.env.DREAM_ROUX_CASES.split(',').includes(c.name))test.skip(true,'Not in DREAM_ROUX_CASES.');
 await liveSession(`roux-stress-${c.name}`,async session=>{
  await session.importFiles(c.content);
  for(const [n,step] of c.steps.entries()){
   if(step.undoFirst){const before=await session.state();await session.page.evaluate(()=>window.dream.command({type:'undo'}));const after=await session.state();session.record({name:'undo',request:'undo',status:after.versionId!==before.versionId?'complete':'failed',problem:after.versionId!==before.versionId?undefined:'undo changed nothing',targets:{},seconds:0});}
   const anyEnd=step.expect==='any';
   await session.ask(`${c.name} ${n+1}`,step.text,(b,a)=>anyEnd?undefined:step.check?.(b,a),(_b,_a,numbers)=>({'under $0.25':!!numbers&&numbers.costUsd<.25,'under 80 calls':!!numbers&&numbers.calls<80,'under 10 min':!!numbers&&numbers.seconds<600}),{...AUTO,...(anyEnd?{expect:'any'}:{})});
  }
  const state=await session.state();if(state.timeline.spine.length)await exportEdit(session,c.name);
  writeFileSync(join(session.folder,'final-state.json'),JSON.stringify({aiStatus:state.aiStatus,settings:state.timeline.settings,length:videoLength(state),messages:state.messages.map((m:any)=>({role:m.role,text:m.text}))},null,1));
 },{computer:false});
});
