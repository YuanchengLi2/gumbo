alter table public.dream_usage add column if not exists provider_request_id text;
alter table public.dream_usage add column if not exists provider_status integer;
alter table public.dream_usage add column if not exists error_code text;

create or replace function public.dream_reserve_usage(p_user uuid,p_request text,p_turn text,p_model text,p_reserved numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare account dream_accounts; total numeric; result uuid;
begin
 select * into account from dream_accounts where id=p_user for update;
 if account.id is null or account.status<>'active' then raise exception using message='Account is not active',errcode='D0001'; end if;
 select id into result from dream_usage where user_id=p_user and request_id=p_request;
 if result is not null then raise exception using message='Request already submitted',errcode='D0002'; end if;
 if p_reserved is null or p_reserved<0 then raise exception 'Invalid usage reservation'; end if;
 select coalesce(sum(case when status in ('reserved','uncertain') then reserved_usd else cost_usd end),0) into total
 from dream_usage where user_id=p_user and created_at>=date_trunc('day',now());
 if total+p_reserved>account.daily_budget_usd then raise exception using message='Daily AI allowance reached',errcode='D0003'; end if;
 insert into dream_usage(user_id,request_id,turn_id,model,reserved_usd) values(p_user,p_request,p_turn,p_model,p_reserved) returning id into result;
 return result;
end; $$;
revoke all on function public.dream_reserve_usage(uuid,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.dream_reserve_usage(uuid,text,text,text,numeric) to service_role;
