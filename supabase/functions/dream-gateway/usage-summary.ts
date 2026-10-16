/** Spend from usage rows for Settings > Usage, counted as the daily allowance counts it: a request still reserved at its
 * reservation, one finished at its cost. */
export type UsageRow={model:string;cost_usd:number|string;reserved_usd:number|string;status:string;created_at:string};
export function usageSummary(rows:UsageRow[],today:Date,dailyBudgetUsd:number){
 const spent=(r:UsageRow)=>Number(r.status==='reserved'?r.reserved_usd:r.cost_usd)||0,round=(n:number)=>Math.round(n*10000)/10000;
 const byModel=new Map<string,{model:string;calls:number;costUsd:number}>();let monthUsd=0,todayUsd=0;
 for(const r of rows){const cost=spent(r);monthUsd+=cost;if(new Date(r.created_at)>=today)todayUsd+=cost;const m=byModel.get(r.model)??{model:r.model,calls:0,costUsd:0};m.calls++;m.costUsd+=cost;byModel.set(r.model,m);}
 return{todayUsd:round(todayUsd),monthUsd:round(monthUsd),dailyBudgetUsd,requests:rows.length,byModel:[...byModel.values()].map(m=>({...m,costUsd:round(m.costUsd)})).sort((a,b)=>b.costUsd-a.costUsd)};
}
