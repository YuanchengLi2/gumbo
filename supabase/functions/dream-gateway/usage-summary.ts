/** Settings > Usage and billing: the credits requests took (one credit is one cent of their cost) today, over the last
 * 30 days, each day of those 30 (UTC) and by model. A request still running has taken nothing yet. */
export type UsageRow={model:string;cost_usd:number|string;reserved_usd:number|string;status:string;created_at:string};
export function usageSummary(rows:UsageRow[],now:Date){
 const today=new Date(now);today.setUTCHours(0,0,0,0);
 const credits=(r:UsageRow)=>r.status==='reserved'?0:(Number(r.cost_usd)||0)*100,round=(n:number)=>Math.round(n*10)/10;
 const byModel=new Map<string,{model:string;calls:number;credits:number}>(),byDay=new Map<string,number>();let monthCredits=0,todayCredits=0;
 for(let i=29;i>=0;i--)byDay.set(new Date(today.getTime()-i*86_400_000).toISOString().slice(0,10),0);
 for(const r of rows){
  const c=credits(r),day=new Date(r.created_at).toISOString().slice(0,10);monthCredits+=c;if(new Date(r.created_at)>=today)todayCredits+=c;
  if(byDay.has(day))byDay.set(day,byDay.get(day)!+c);
  const m=byModel.get(r.model)??{model:r.model,calls:0,credits:0};m.calls++;m.credits+=c;byModel.set(r.model,m);
 }
 return{todayCredits:round(todayCredits),monthCredits:round(monthCredits),requests:rows.length,
  days:[...byDay].map(([date,c])=>({date,credits:round(c)})),
  byModel:[...byModel.values()].map(m=>({...m,credits:round(m.credits)})).sort((a,b)=>b.credits-a.credits)};
}
