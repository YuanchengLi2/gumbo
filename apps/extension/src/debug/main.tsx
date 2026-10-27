import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import '../shared/tokens.css';
import './debug.css';
import {Bowl} from '../shared/Bowl';
import {ask} from '../shared/protocol';
/** Memory, from the inside, on this computer only: what the session holds tab by tab (each visit, how long it was read,
 * what is in front now), the projects and their notes, the profile, what each surface was last given and why (each
 * item's score, part by part), how fast and how often each surface ran, and the numbers memory is tuned by. Opened from
 * the popup. It refreshes every few seconds. */
const ms=(n?:number)=>n===undefined?'–':n<1000?`${Math.round(n)} ms`:n<120_000?`${(n/1000).toFixed(1)} s`:`${Math.round(n/60_000)} min`;
const time=(at?:number)=>at?new Date(at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'';
function Debug(){
 const [data,setData]=useState<any>();
 const load=()=>void ask<any>({type:'debug.memory'}).then(setData).catch(()=>{});
 useEffect(()=>{load();const t=setInterval(load,4000);return()=>clearInterval(t);},[]);
 if(!data)return <main><p className="muted">Reading memory…</p></main>;
 const tabs=Object.values(data.live?.tabs??{}) as any[];
 return <main>
  <header><Bowl/><h1>Gumbo memory</h1><span className="muted small">on this computer only</span></header>
  <p className="muted small">{Object.entries(data.counts??{}).map(([k,v])=>`${v} ${k}`).join(' · ')}</p>
  <h2>This session</h2>
  <div className="tabs">{tabs.map(t=><div className="tab" key={t.tab}>
   <h3>Tab {t.tab}</h3>
   {t.visits.slice().reverse().map((v:any)=><div className="visit" key={v.in}>
    <div>{v.title||v.url} <span className="muted">· {v.kind}{v.project?` · ${data.projects.find((p:any)=>p.id===v.project)?.name??'project'}`:''}</span></div>
    <div className="muted">{time(v.in)}{v.out?`–${time(v.out)}`:' (now)'} · active {ms(v.activeMs)} · read {ms(v.readMs)} · {v.transition}{v.from?` · from #${v.from}`:''} · {Object.keys(v.seen??{}).length} blocks read</div>
   </div>)}
   {t.now&&<pre>{`${t.now.focus?`In “${t.now.focus.label}” (${t.now.focus.intent})${t.now.focus.typed?`: “${t.now.focus.typed.slice(-80)}”`:''}\n`:''}${t.now.selection?`Selected: ${t.now.selection.slice(0,120)}\n`:''}${t.now.visible.slice(0,400)}`}</pre>}
  </div>)}</div>
  <h2>Projects</h2>
  <table><thead><tr><th>Name</th><th>Note</th><th className="num">Visits</th><th className="num">Active</th><th>Sites</th></tr></thead><tbody>
   {data.projects.sort((a:any,b:any)=>b.lastAt-a.lastAt).slice(0,30).map((p:any)=><tr key={p.id}><td>{p.name}{p.candidate&&<span className="muted"> (candidate)</span>}</td><td className="small">{p.note?`${p.note.goal} — ${p.note.leftOff}${p.note.open.length?` · Open: ${p.note.open.join('; ')}`:''}`:<span className="muted">no note yet</span>}</td><td className="num">{p.visits}</td><td className="num">{ms(p.activeMs)}</td><td className="small">{p.sites.join(', ')}</td></tr>)}
  </tbody></table>
  <h2>Profile</h2>
  {data.profile?<pre>{JSON.stringify({who:data.profile.who,work:data.profile.work,people:data.profile.people,tools:data.profile.tools,facts:data.profile.facts?.slice(0,12).map((f:any)=>`${f.text} (${f.kind}, ×${f.count})`),routines:data.profile.routines,style:data.profile.style,updated:time(data.profile.updatedAt)},null,1)}</pre>:<p className="muted">Not built yet.</p>}
  <h2>What each surface was last given</h2>
  {Object.values(data.contexts??{}).map((c:any)=><div key={c.surface}>
   <h3>{c.surface} <span className="muted small">· {time(c.at)} · assembled in {c.ms} ms{c.searching?' · its search still running':''}{c.project?` · project ${c.project.name}`:''}</span></h3>
   <p className="small muted">Asked: “{c.query}”</p>
   <table><thead><tr><th>#</th><th>Item</th><th className="num">Score</th><th>Why</th></tr></thead><tbody>
    {c.items.map((i:any)=><tr key={i.id}><td className="num">{i.n||''}</td><td className="small">{i.layer} · {i.kind} · <b>{i.title.slice(0,80)}</b> <span className="muted">({i.when})</span><br/>{i.text.slice(0,160)}</td><td className="num">{i.score}</td><td className="small num">{Object.entries(i.parts).filter(([,v])=>(v as number)>0||(v as number)<0).map(([k,v])=>`${k} ${v}`).join(' · ')}</td></tr>)}
   </tbody></table>
   {c.stable&&<pre>{c.stable}</pre>}
  </div>)}
  {!Object.keys(data.contexts??{}).length&&<p className="muted">No surface has asked yet.</p>}
  <h2>Speed and how often</h2>
  <table><thead><tr><th>What</th><th className="num">Times (7 days)</th><th className="num">Typical</th><th className="num">9 in 10 within</th></tr></thead><tbody>
   {Object.entries(data.speed??{}).sort().map(([s,v]:any)=><tr key={s}><td>{s}</td><td className="num">{v.n}</td><td className="num">{ms(v.p50)}</td><td className="num">{ms(v.p90)}</td></tr>)}
  </tbody></table>
  <h2>Tuning</h2>
  {data.calibration?<>
   <p className="small">Project threshold {data.calibration.threshold}, learned {new Date(data.calibration.at).toLocaleDateString()} from {data.calibration.pairs.chain} pages reached one from the other (dark) and {data.calibration.pairs.random} unrelated pairs (light), by similarity 0 to 1:</p>
   <div className="hist">{data.calibration.chain.map((n:number,i:number)=><span key={i} style={{height:`${100*n/Math.max(...data.calibration.chain)}%`}}/>)}</div>
   <div className="hist b">{data.calibration.random.map((n:number,i:number)=><span key={i} style={{height:`${100*n/Math.max(...data.calibration.random)}%`}}/>)}</div>
  </>:<p className="muted small">Projects use the default threshold until there are enough visits to learn one. <button className="link" onClick={()=>void ask({type:'debug.calibrate'}).then(load)}>Learn it now</button></p>}
  <pre>{JSON.stringify(data.config,null,1)}</pre>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Debug/>);
