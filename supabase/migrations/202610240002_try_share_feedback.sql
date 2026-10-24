-- Three ways in for new people (Oct 24 2026):
--
-- 1. Trying Gumbo without an account (usegumbo.app/app/?try=1): an anonymous Supabase session becomes a guest account
--    with a one-time gift of a few credits (dream_limits.guest_credits, 25 = $0.25: one short edit), which expires after a
--    week. Guests together may spend dream_limits.guest_daily_usd a day (D0007), so a flood of throwaway sessions can't
--    run up the bill; each guest is also under the usual per-account daily limit. Signing in afterwards is a new account.
-- 2. Share links that show how an edit was made: the prompts that made it and what it was made from (the footage's
--    length, how many clips and a few small stills), next to the exported video. views counts who opened it.
-- 3. Feedback from under the prompt box, signed in or not: what failed, an optional email to hear back on, and what the
--    app was doing. Only the gateway (service role) reads or writes it; one network address (kept only as a digest) may
--    send a few an hour.
-- Change the guest limits without a deploy: update public.dream_limits set guest_credits = 50, guest_daily_usd = 5;

alter table public.dream_limits add column if not exists guest_credits numeric not null default 25 check (guest_credits >= 0);
alter table public.dream_limits add column if not exists guest_daily_usd numeric not null default 3 check (guest_daily_usd >= 0);

create or replace function public.dream_activate_guest(p_user uuid) returns boolean
language plpgsql security definer set search_path=public as $$
declare credits numeric;
begin
 if not exists(select 1 from auth.users where id=p_user and is_anonymous=true) then return false; end if;
 insert into dream_accounts(id,email,is_guest) values(p_user,'',true) on conflict(id) do nothing;
 select guest_credits into credits from dream_limits where id;
 perform dream_grant_credits(p_user,'gift',null,coalesce(credits,0),'guest:'||p_user,now(),now()+interval '7 days');
 return exists(select 1 from dream_accounts where id=p_user and status='active');
end $$;
revoke all on function public.dream_activate_guest(uuid) from public,anon,authenticated;
grant execute on function public.dream_activate_guest(uuid) to service_role;

-- As in 202610220002_spend_limits.sql, with the guests' shared daily limit added.
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
 if dream_credit_balance(p_user) <= 0 then
  if account.is_guest then raise exception using message = 'That was your free try. Sign in to keep editing; your project stays here.', errcode = 'D0004'; end if;
  raise exception using message = 'You have used all your credits for this month. They refill at the start of next month.', errcode = 'D0004'; end if;
 if not account.is_admin then
  select * into limits from dream_limits where id;
  if (select coalesce(sum(case when status = 'reserved' then greatest(cost_usd, reserved_usd) else cost_usd end), 0) from dream_usage where user_id = p_user and created_at >= today) + p_reserved > limits.account_daily_usd then
   raise exception using message = 'You have reached today''s limit. Try again tomorrow.', errcode = 'D0003'; end if;
  if account.is_guest and (select coalesce(sum(case when u.status = 'reserved' then greatest(u.cost_usd, u.reserved_usd) else u.cost_usd end), 0)
    from dream_usage u join dream_accounts a on a.id = u.user_id where a.is_guest and u.created_at >= today) + p_reserved > limits.guest_daily_usd then
   raise exception using message = 'Free tries are full for today. Sign in to edit now.', errcode = 'D0007'; end if;
  if (select coalesce(sum(case when status = 'reserved' then greatest(cost_usd, reserved_usd) else cost_usd end), 0) from dream_usage where created_at >= today) + p_reserved > limits.global_daily_usd then
   raise exception using message = 'Gumbo is at capacity for today. Please try again tomorrow.', errcode = 'D0006'; end if;
 end if;
 insert into dream_usage(user_id, request_id, turn_id, model, reserved_usd) values (p_user, p_request, p_turn, p_model, p_reserved) returning id into result;
 return result;
end $$;
revoke all on function public.dream_reserve_usage(uuid,text,text,text,numeric) from public, anon, authenticated;
grant execute on function public.dream_reserve_usage(uuid,text,text,text,numeric) to service_role;

alter table public.dream_shares add column if not exists prompts jsonb not null default '[]';
alter table public.dream_shares add column if not exists source jsonb;
alter table public.dream_shares add column if not exists duration_sec numeric;
alter table public.dream_shares add column if not exists views integer not null default 0;

create table if not exists public.dream_feedback (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references public.dream_accounts(id) on delete set null,
 email text,
 note text not null,
 context jsonb not null default '{}',
 app_version text,
 platform text,
 address text not null,
 created_at timestamptz not null default now()
);
create index if not exists dream_feedback_address_idx on public.dream_feedback(address, created_at);
create index if not exists dream_feedback_created_idx on public.dream_feedback(created_at desc);
alter table public.dream_feedback enable row level security;
revoke all on public.dream_feedback from anon, authenticated;
