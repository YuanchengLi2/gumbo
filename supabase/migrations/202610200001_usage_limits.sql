-- Monthly allowances per plan (supabase/functions/dream-gateway/billing.ts PLANS limits): what each account has used this
-- month, by kind. The first kind is creator_search, the composer's @ search of YouTube channels (each search spends 1% of
-- the gateway's daily YouTube quota).
create table if not exists public.dream_usage_counters(
 account_id uuid not null references public.dream_accounts(id) on delete cascade,
 period text not null,
 kind text not null,
 count integer not null default 0 check(count>=0),
 primary key(account_id,period,kind)
);
alter table public.dream_usage_counters enable row level security;
revoke all on public.dream_usage_counters from anon,authenticated;

-- Uses one of this month's (UTC) allowance of p_kind: the count after using it, or -1 when p_limit are already used.
create or replace function public.dream_use_allowance(p_account uuid,p_kind text,p_limit integer) returns integer
language plpgsql security definer set search_path=public as $$
declare v_period text:=to_char(now() at time zone 'utc','YYYY-MM');v_count integer;
begin
 insert into dream_usage_counters(account_id,period,kind,count) values(p_account,v_period,p_kind,0) on conflict do nothing;
 update dream_usage_counters set count=count+1 where account_id=p_account and period=v_period and kind=p_kind and count<p_limit returning count into v_count;
 return coalesce(v_count,-1);
end $$;
revoke all on function public.dream_use_allowance(uuid,text,integer) from public,anon,authenticated;
