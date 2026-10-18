/** Settings > Profile, like a coding agent's profile: tokens used over the last year, by day (UTC), the busiest day, the
 * longest task (a request's first to last model call), and the longest and current streaks of days with any use. Tokens
 * count everything a call read and wrote, cached reads included. */
export type ActivityRow={turn_id:string;input_tokens:number;output_tokens:number;cache_read_tokens:number;cache_write_tokens:number;created_at:string};
export function tokenActivity(rows:ActivityRow[],now:Date){
 const day=(d:Date)=>d.toISOString().slice(0,10),today=new Date(now);today.setUTCHours(0,0,0,0);
 const days=new Map<string,number>();for(let i=364;i>=0;i--)days.set(day(new Date(today.getTime()-i*86_400_000)),0);
 const turns=new Map<string,{first:number;last:number}>();let lifetime=0;
 for(const r of rows){
  const tokens=(r.input_tokens||0)+(r.output_tokens||0)+(r.cache_read_tokens||0)+(r.cache_write_tokens||0),at=new Date(r.created_at);lifetime+=tokens;
  const key=day(at);if(days.has(key))days.set(key,days.get(key)!+tokens);
  const t=turns.get(r.turn_id);if(t){t.first=Math.min(t.first,at.getTime());t.last=Math.max(t.last,at.getTime());}else turns.set(r.turn_id,{first:at.getTime(),last:at.getTime()});
 }
 const list=[...days].map(([date,tokens])=>({date,tokens}));
 let longest=0,run=0;for(const d of list){run=d.tokens>0?run+1:0;longest=Math.max(longest,run);}
 // Today without use yet does not break the streak: it counts back from yesterday.
 let current=0;for(let i=list.length-1;i>=0;i--){if(list[i].tokens>0)current++;else if(i===list.length-1)continue;else break;}
 return{lifetimeTokens:lifetime,peakTokens:Math.max(0,...list.map(d=>d.tokens)),longestTaskMs:Math.max(0,...[...turns.values()].map(t=>t.last-t.first)),
  longestStreak:longest,currentStreak:current,days:list};
}
