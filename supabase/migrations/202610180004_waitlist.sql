-- The paid beta's waitlist. People join on usegumbo.app (email, and the first edit they would ask for); the owner emails
-- the ones they pick and invites them on the dashboard. Only the gateway reads or writes it (waitlist.ts and
-- spend-dashboard.ts, with the service role). address is a digest of the joining network address, for the join limit.
create table if not exists public.dream_waitlist(
 email text primary key check (email = lower(email) and length(email) between 3 and 254),
 first_ask text not null default '' check (length(first_ask) <= 500),
 source text not null default '' check (length(source) <= 60),
 address text,
 created_at timestamptz not null default now(),
 invited_at timestamptz
);
create index if not exists dream_waitlist_address_idx on public.dream_waitlist(address, created_at);
alter table public.dream_waitlist enable row level security;
revoke all on public.dream_waitlist from anon, authenticated;

-- Beta access: the AI, transcription, media search, sharing and checkout are for invited accounts. Every account made
-- before the waitlist keeps using Gumbo.
alter table public.dream_accounts add column if not exists beta_access boolean not null default false;
update public.dream_accounts set beta_access = true;

-- Anyone can still sign in (the app shows them they are on the waitlist); an account gets beta access when its email is
-- invited (dream_invites) or is the owner's, at sign-in or on the first request after an invite. An account that already
-- has access is not written again.
create or replace function public.dream_activate_account(p_user uuid, p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
 v_email text := lower(trim(coalesce(p_email, '')));
 v_admin boolean;
 v_invited boolean;
begin
 if v_email = '' then return false; end if;
 v_admin := v_email = 'yuanchengli612@gmail.com';
 v_invited := v_admin or exists(select 1 from dream_invites where lower(email) = v_email);
 insert into dream_accounts(id, email, is_admin, beta_access) values(p_user, v_email, v_admin, v_invited)
  on conflict(id) do update set beta_access = true where not dream_accounts.beta_access and excluded.beta_access;
 update dream_invites set claimed_by = p_user where lower(email) = v_email and (claimed_by is null or claimed_by = p_user);
 return exists(select 1 from dream_accounts where id = p_user and status = 'active');
end $$;
revoke all on function public.dream_activate_account(uuid, text) from public, anon, authenticated;
grant execute on function public.dream_activate_account(uuid, text) to service_role;
