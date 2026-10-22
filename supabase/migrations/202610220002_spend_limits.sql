-- Spending limits for the open beta. Credits alone left two holes: the billing rewrite (202610170003) dropped the daily
-- allowance from the reservation, and nothing capped what all accounts together spend in a day. Now each request is
-- refused when its account has spent its daily limit (D0003) or when Gumbo as a whole has spent the day's limit (D0006),
-- counting each request's final cost, or what it reserved while it runs (UTC days). The owner's accounts are exempt.
-- Change the limits without a deploy: update public.dream_limits set account_daily_usd = 2, global_daily_usd = 25;
create table if not exists public.dream_limits(
 id boolean primary key default true check (id),
 account_daily_usd numeric not null default 1 check (account_daily_usd >= 0),
 global_daily_usd numeric not null default 15 check (global_daily_usd >= 0)
);
insert into public.dream_limits(id) values(true) on conflict(id) do nothing;
alter table public.dream_limits enable row level security;
revoke all on public.dream_limits from anon, authenticated;
create index if not exists dream_usage_created_idx on public.dream_usage(created_at);

create or replace function public.dream_reserve_usage(p_user uuid, p_request text, p_turn text, p_model text, p_reserved numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare account dream_accounts; limits dream_limits; result uuid; today timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
 select * into account from dream_accounts where id = p_user for update;
 if account.id is null or account.status <> 'active' then raise exception using message = 'Account is not active', errcode = 'D0001'; end if;
 select id into result from dream_usage where user_id = p_user and request_id = p_request;
 if result is not null then raise exception using message = 'Request already submitted', errcode = 'D0002'; end if;
 if p_reserved is null or p_reserved < 0 then raise exception 'Invalid usage reservation'; end if;
 perform dream_ensure_free_grant(p_user);
 if dream_credit_balance(p_user) <= 0 then raise exception using message = 'You have used all your credits for this month. They refill at the start of next month.', errcode = 'D0004'; end if;
 if not account.is_admin then
  select * into limits from dream_limits where id;
  if (select coalesce(sum(case when status = 'reserved' then greatest(cost_usd, reserved_usd) else cost_usd end), 0) from dream_usage where user_id = p_user and created_at >= today) + p_reserved > limits.account_daily_usd then
   raise exception using message = 'You have reached today''s limit. Try again tomorrow.', errcode = 'D0003'; end if;
  if (select coalesce(sum(case when status = 'reserved' then greatest(cost_usd, reserved_usd) else cost_usd end), 0) from dream_usage where created_at >= today) + p_reserved > limits.global_daily_usd then
   raise exception using message = 'Gumbo is at capacity for today. Please try again tomorrow.', errcode = 'D0006'; end if;
 end if;
 insert into dream_usage(user_id, request_id, turn_id, model, reserved_usd) values (p_user, p_request, p_turn, p_model, p_reserved) returning id into result;
 return result;
end $$;
revoke all on function public.dream_reserve_usage(uuid,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.dream_reserve_usage(uuid,text,text,text,numeric) to service_role;
