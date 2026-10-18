import React,{useEffect,useMemo,useState} from 'react';
import type {TokenActivity} from '@dream/contracts';

/** Settings > Profile's top, like a coding agent's profile: lifetime and peak tokens, the longest task, the streaks, and a
 * year of token activity as a grid of days (or weeks, or the running total). From the gateway's records of every call. */
const compact=(n:number)=>n>=1e9?`${(n/1e9).toFixed(n>=1e10?0:1)}B`:n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${(n/1e3).toFixed(1)}K`:String(Math.round(n));
const duration=(ms:number)=>{const m=Math.round(ms/60000);return m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;};
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
type View='daily'|'weekly'|'cumulative';

export function ProfileActivity(){
 const [activity,setActivity]=useState<TokenActivity|{unavailable:true}|null|undefined>(undefined),[view,setView]=useState<View>('daily');
 useEffect(()=>{window.dream.command<TokenActivity|{unavailable:true}|null>({type:'account',action:'activity'}).then(setActivity,()=>setActivity({unavailable:true}));},[]);
 const a=activity&&!('unavailable' in activity)?activity:null;
 // Columns of weeks, Sunday on top, like a contributions grid; the first column starts on the Sunday before the first day.
 const weeks=useMemo(()=>{if(!a)return[];const lead=new Date(a.days[0].date+'T00:00:00Z').getUTCDay(),cells:({date:string;tokens:number}|null)[]=[...Array(lead).fill(null),...a.days];const out:typeof cells[]=[];for(let i=0;i<cells.length;i+=7)out.push(cells.slice(i,i+7));return out;},[a]);
 if(activity===null)return null;
 if(!a)return <div className="activity-stats loading">{['Lifetime tokens','Peak tokens','Longest task','Longest streak','Current streak'].map(l=><div key={l}><strong>{activity===undefined?'…':'–'}</strong><span>{l}</span></div>)}</div>;
 const peakDay=Math.max(1,...a.days.map(d=>d.tokens)),level=(t:number)=>t<=0?0:Math.min(4,Math.ceil(t/peakDay*4));
 const weekly=weeks.map(w=>w.reduce((n,d)=>n+(d?.tokens??0),0)),peakWeek=Math.max(1,...weekly);
 let total=0;const running=a.days.map(d=>total+=d.tokens),last=Math.max(1,total);
 // Month names under the column where each month starts.
 const labels=weeks.map((w,i)=>{const first=w.find(d=>d&&d.date.endsWith('-01'))??(i===0?w.find(Boolean):undefined);return first?months[Number(first.date.slice(5,7))-1]:'';});
 return <>
  <div className="activity-stats">
   <div><strong>{compact(a.lifetimeTokens)}</strong><span>Lifetime tokens</span></div>
   <div><strong>{compact(a.peakTokens)}</strong><span>Peak tokens</span></div>
   <div><strong>{duration(a.longestTaskMs)}</strong><span>Longest task</span></div>
   <div><strong>{a.longestStreak} {a.longestStreak===1?'day':'days'}</strong><span>Longest streak</span></div>
   <div><strong>{a.currentStreak} {a.currentStreak===1?'day':'days'}</strong><span>Current streak</span></div>
  </div>
  <section className="activity">
   <header><h3>Token activity</h3><div className="activity-views" role="tablist">{(['daily','weekly','cumulative'] as View[]).map(v=><button key={v} type="button" role="tab" aria-selected={view===v} onClick={()=>setView(v)}>{v[0].toUpperCase()+v.slice(1)}</button>)}</div></header>
   {view==='daily'&&<div className="activity-grid" role="img" aria-label="Tokens each day over the last year">{weeks.map((w,i)=><div key={i} className="activity-week">{w.map((d,j)=>d?<i key={j} className={'l'+level(d.tokens)} title={`${new Date(d.date+'T12:00:00Z').toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}: ${compact(d.tokens)} tokens`}/>:<i key={j} className="none"/>)}</div>)}</div>}
   {view==='weekly'&&<div className="activity-bars" role="img" aria-label="Tokens each week over the last year">{weekly.map((t,i)=><i key={i} style={{height:`${Math.max(t>0?4:1,Math.round(t/peakWeek*100))}%`}} title={`${compact(t)} tokens`}/>)}</div>}
   {view==='cumulative'&&<svg className="activity-line" viewBox={`0 0 ${a.days.length} 100`} preserveAspectRatio="none" role="img" aria-label="Tokens added up over the last year"><path d={`M0 100 ${running.map((t,i)=>`L${i} ${100-t/last*96}`).join(' ')} L${a.days.length-1} 100 Z`}/></svg>}
   <div className="activity-months">{labels.map((l,i)=><span key={i}>{l}</span>)}</div>
  </section>
 </>;
}
