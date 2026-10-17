-- Billing: plans paid through Stripe, and credits. One credit is one cent of what Gumbo's AI costs Gumbo. Each account
-- holds credit grants: its plan's credits for the current period (Free 100 a month; Pro 900, Max 4,500 and Max 20x 18,000
-- for each paid month, granted when Stripe says the invoice is paid) and top-ups (500 per $10, which do not expire).
-- Every request's real cost is taken from the grants as it is recorded: the plan's first, then top-ups. A request starts
-- only while credits are left; one that costs more than what was left leaves an overdraft, paid from the next grant.
-- This replaces the daily allowance, which no longer limits anything (the column stays for the spending dashboard).

alter table public.dream_accounts
 add column if not exists plan text not null default 'free' check (plan in ('free','pro','max','max20')),
 add column if not exists stripe_customer_id text unique,
 add column if not exists stripe_subscription_id text,
 add column if not exists subscription_status text,
 add column if not exists period_end timestamptz,
 add column if not exists cancel_at_period_end boolean not null default false,
 add column if not exists credit_overdraft numeric not null default 0 check (credit_overdraft >= 0);

-- The credits each request took (its cost in cents). Requests before billing keep 0: their cost was never charged.
alter table public.dream_usage add column if not exists credits numeric not null default 0;

create table if not exists public.dream_credit_grants (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.dream_accounts(id) on delete cascade,
 kind text not null check (kind in ('plan','topup','gift')),
 plan text check (plan in ('free','pro','max','max20')),
 credits numeric not null check (credits >= 0),
 remaining numeric not null check (remaining >= 0),
 -- What granted it, so a grant is never made twice: a Stripe invoice or checkout session, or the free month.
 source text not null unique,
 starts_at timestamptz not null default now(),
 expires_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists dream_credit_grants_user on public.dream_credit_grants(user_id, expires_at);
alter table public.dream_credit_grants enable row level security;
create policy credit_grants_read on public.dream_credit_grants for select to authenticated using (user_id = auth.uid());
grant select on public.dream_credit_grants to authenticated;

-- The free plan's monthly credits (billing.ts in the gateway says the same).
create or replace function public.dream_free_credits() returns numeric language sql immutable as $$ select 100::numeric $$;

-- Grants credits once per source. An overdraft is paid from them first. A new plan grant ends the plan grant before it
-- (a renewal, or a change of plan), so an account only ever spends one plan period's credits.
create or replace function public.dream_grant_credits(p_user uuid, p_kind text, p_plan text, p_credits numeric, p_source text, p_starts timestamptz, p_expires timestamptz)
returns boolean language plpgsql security definer set search_path=public as $$
declare owed numeric; grant_id uuid;
begin
 perform 1 from dream_accounts where id = p_user for update;
 if not found then raise exception 'No such account'; end if;
 if exists (select 1 from dream_credit_grants where source = p_source) then return false; end if;
 select least(credit_overdraft, p_credits) into owed from dream_accounts where id = p_user;
 update dream_accounts set credit_overdraft = credit_overdraft - owed where id = p_user;
 insert into dream_credit_grants(user_id, kind, plan, credits, remaining, source, starts_at, expires_at)
 values (p_user, p_kind, p_plan, p_credits, p_credits - owed, p_source, coalesce(p_starts, now()), p_expires) returning id into grant_id;
 if p_kind = 'plan' then
  update dream_credit_grants set expires_at = now()
  where user_id = p_user and kind = 'plan' and id <> grant_id and (expires_at is null or expires_at > now());
 end if;
 return true;
end $$;

-- A free account gets its month's credits the first time it needs them in that month (UTC), while no plan period runs.
create or replace function public.dream_ensure_free_grant(p_user uuid) returns void
language plpgsql security definer set search_path=public as $$
declare month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
begin
 if exists (select 1 from dream_accounts where id = p_user and plan = 'free' and not is_guest)
  and not exists (select 1 from dream_credit_grants where user_id = p_user and kind = 'plan' and (expires_at is null or expires_at > now())) then
  perform dream_grant_credits(p_user, 'plan', 'free', dream_free_credits(), 'free:' || p_user || ':' || to_char(month, 'YYYY-MM'), month, month + interval '1 month');
 end if;
end $$;

-- Credits left: what the running grants hold, less any overdraft.
create or replace function public.dream_credit_balance(p_user uuid) returns numeric
language sql stable security definer set search_path=public as $$
 select coalesce((select sum(remaining) from dream_credit_grants where user_id = p_user and (expires_at is null or expires_at > now())), 0)
  - coalesce((select credit_overdraft from dream_accounts where id = p_user), 0)
$$;

-- Takes credits (or gives them back, for a negative amount): the plan's grant first, then the top-ups that expire soonest;
-- what is left over becomes an overdraft. Credits given back clear an overdraft first, then return to the newest grant.
create or replace function public.dream_debit_credits(p_user uuid, p_amount numeric) returns void
language plpgsql security definer set search_path=public as $$
declare left_over numeric := p_amount; g record; take numeric; owed numeric;
begin
 perform 1 from dream_accounts where id = p_user for update;
 if p_amount > 0 then
  for g in select id, remaining from dream_credit_grants
   where user_id = p_user and remaining > 0 and (expires_at is null or expires_at > now())
   order by (kind = 'plan') desc, expires_at nulls last, created_at
  loop
   exit when left_over <= 0;
   take := least(g.remaining, left_over);
   update dream_credit_grants set remaining = remaining - take where id = g.id;
   left_over := left_over - take;
  end loop;
  if left_over > 0 then update dream_accounts set credit_overdraft = credit_overdraft + left_over where id = p_user; end if;
 elsif p_amount < 0 then
  left_over := -p_amount;
  select least(credit_overdraft, left_over) into owed from dream_accounts where id = p_user;
  update dream_accounts set credit_overdraft = credit_overdraft - owed where id = p_user;
  left_over := left_over - owed;
  if left_over > 0 then
   update dream_credit_grants set remaining = remaining + left_over
   where id = (select id from dream_credit_grants where user_id = p_user and (expires_at is null or expires_at > now()) order by created_at desc limit 1);
  end if;
 end if;
end $$;

-- Every way a request's cost is recorded (Claude, the other providers, speech) sets dream_usage.cost_usd, so its credits
-- follow that column: whenever it changes, the difference is taken or given back.
create or replace function public.dream_usage_credits() returns trigger
language plpgsql security definer set search_path=public as $$
declare target numeric := round(coalesce(new.cost_usd, 0) * 100, 4); before numeric := case when tg_op = 'UPDATE' then coalesce(old.credits, 0) else 0 end;
begin
 if target <> before then perform dream_debit_credits(new.user_id, target - before); end if;
 new.credits := target;
 return new;
end $$;
drop trigger if exists dream_usage_credits on public.dream_usage;
create trigger dream_usage_credits before insert or update of cost_usd on public.dream_usage
 for each row execute function public.dream_usage_credits();

-- A request starts while the account has credits left. Its reservation is only an estimate (it assumes the longest
-- answer), so it is not held against the balance: the agent's parallel workers would refuse each other.
create or replace function public.dream_reserve_usage(p_user uuid, p_request text, p_turn text, p_model text, p_reserved numeric)
returns uuid language plpgsql security definer set search_path=public as $$
declare account dream_accounts; result uuid;
begin
 select * into account from dream_accounts where id = p_user for update;
 if account.id is null or account.status <> 'active' then raise exception using message = 'Account is not active', errcode = 'D0001'; end if;
 select id into result from dream_usage where user_id = p_user and request_id = p_request;
 if result is not null then raise exception using message = 'Request already submitted', errcode = 'D0002'; end if;
 if p_reserved is null or p_reserved < 0 then raise exception 'Invalid usage reservation'; end if;
 perform dream_ensure_free_grant(p_user);
 if dream_credit_balance(p_user) <= 0 then raise exception using message = 'You have used all your credits. Upgrade your plan or buy credits in Settings, Usage and billing.', errcode = 'D0004'; end if;
 insert into dream_usage(user_id, request_id, turn_id, model, reserved_usd) values (p_user, p_request, p_turn, p_model, p_reserved) returning id into result;
 return result;
end $$;

revoke all on function public.dream_grant_credits(uuid,text,text,numeric,text,timestamptz,timestamptz), public.dream_ensure_free_grant(uuid),
 public.dream_credit_balance(uuid), public.dream_debit_credits(uuid,numeric), public.dream_usage_credits(),
 public.dream_reserve_usage(uuid,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.dream_grant_credits(uuid,text,text,numeric,text,timestamptz,timestamptz), public.dream_ensure_free_grant(uuid),
 public.dream_credit_balance(uuid), public.dream_debit_credits(uuid,numeric), public.dream_reserve_usage(uuid,text,text,text,numeric) to service_role;
