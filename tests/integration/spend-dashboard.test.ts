import {it,expect} from 'vitest';
import {handleSpendDashboard,supabaseSpendPorts,MAX_FAILURES,type SpendPorts,type SpendCall} from '../../supabase/functions/dream-gateway/spend-dashboard';

const call=(n:number,over:Partial<SpendCall>={}):SpendCall=>({user_id:'user-b',turn_id:'turn-'+n,model:'claude-opus-5-5',status:'completed',cost_usd:'0.05',reserved_usd:'1',input_tokens:10,output_tokens:20,cache_read_tokens:30,cache_write_tokens:40,audio_seconds:'0',error_code:null,provider_status:null,created_at:new Date(Date.UTC(2026,9,16,4,n)).toISOString(),...over});
function ports(password?:string){
 const attempts:{address:string;at:number}[]=[];
 const p:SpendPorts&{attempts:typeof attempts}={password,attempts,
  calls:async()=>[call(1),call(2,{user_id:'user-a',model:'whisper-large-v3-turbo',audio_seconds:'61'}),call(3,{status:'reserved',cost_usd:'0'})],
  accounts:async()=>[{id:'user-b',status:'active',is_guest:false,daily_budget_usd:'10',created_at:'2026-10-09T00:00:00Z'},{id:'user-a',status:'active',is_guest:true,daily_budget_usd:'10',created_at:'2026-10-07T00:00:00Z'}],
  failures:async(address,since)=>attempts.filter(a=>a.address===address&&a.at>=since.getTime()).length,
  fail:async address=>{attempts.push({address,at:Date.now()});}};
 return p;
}

it('stays closed until its password is set on the gateway',async()=>{
 expect(await handleSpendDashboard({password:'anything'},'1.2.3.4',ports())).toEqual({status:503,body:{error:'The dashboard is not set up yet.'}});
});

it('refuses a wrong or missing password and counts it against the address, never storing the address itself',async()=>{
 const p=ports('correct horse');
 expect((await handleSpendDashboard({password:'wrong'},'1.2.3.4',p)).status).toBe(401);
 expect((await handleSpendDashboard({},'1.2.3.4',p)).status).toBe(401);
 expect((await handleSpendDashboard(null,'1.2.3.4',p)).status).toBe(401);
 expect(p.attempts).toHaveLength(3);
 expect(p.attempts.every(a=>/^[0-9a-f]{64}$/.test(a.address)&&!a.address.includes('1.2.3.4'))).toBe(true);
});

it('locks out an address that keeps guessing, even once it finds the password, while other addresses still get in',async()=>{
 const p=ports('correct horse');
 for(let n=0;n<MAX_FAILURES;n++)await handleSpendDashboard({password:'guess'+n},'5.6.7.8',p);
 expect(await handleSpendDashboard({password:'correct horse'},'5.6.7.8',p)).toEqual({status:429,body:{error:'Too many wrong passwords. Try again in 15 minutes.'}});
 expect((await handleSpendDashboard({password:'correct horse'},'9.9.9.9',p)).status).toBe(200);
});

it('gives the right password every call with accounts named by label, never an id or email',async()=>{
 const result=await handleSpendDashboard({password:'correct horse'},'1.2.3.4',ports('correct horse')),body=result.body as any;
 expect(result.status).toBe(200);
 expect(body.accounts.map((a:any)=>[a.key,a.name,a.guest])).toEqual([['a1','Guest 1',true],['a2','Account 2',false]]);
 expect(body.calls.map((c:any)=>[c.account,c.provider,c.cost,c.status])).toEqual([['a2','Anthropic',.05,'completed'],['a1','Groq',.05,'completed'],['a2','Anthropic',0,'reserved']]);
 expect(body.calls[1].audio).toBe(61);
 const text=JSON.stringify(body);expect(text).not.toContain('user-a');expect(text).not.toContain('user-b');expect(text).not.toContain('@');
});

it('reads every call from the database, past the 1,000 rows one select returns',async()=>{
 const rows=Array.from({length:2500},(_,n)=>call(n));let selects=0;
 const db={from:()=>({select:()=>({order:()=>({range:async(from:number,to:number)=>{selects++;return {data:rows.slice(from,to+1),error:null};}})})})};
 expect(await supabaseSpendPorts(db).calls()).toHaveLength(2500);expect(selects).toBe(3);
});
