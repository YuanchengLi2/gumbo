create table public.dream_invites(email text primary key, created_at timestamptz not null default now(), claimed_by uuid references auth.users(id));
create table public.dream_accounts(id uuid primary key references auth.users(id) on delete cascade, email text not null, status text not null default 'active' check(status in ('active','suspended')), daily_budget_usd numeric not null default 10, created_at timestamptz not null default now());
create table public.dream_usage(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.dream_accounts(id) on delete cascade, request_id text not null, turn_id text not null, model text not null, reserved_usd numeric not null default 0, cost_usd numeric not null default 0, input_tokens integer not null default 0, output_tokens integer not null default 0, cache_read_tokens integer not null default 0, cache_write_tokens integer not null default 0, status text not null default 'reserved', created_at timestamptz not null default now(), unique(user_id,request_id));
create table public.dream_shares(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.dream_accounts(id) on delete cascade,token_hash text not null unique,object_key text not null,title text not null,status text not null default 'uploading' check(status in ('uploading','ready','revoked')),size_bytes bigint not null default 0,created_at timestamptz not null default now());
create table public.dream_releases(id uuid primary key default gen_random_uuid(),version text not null,platform text not null,architecture text not null,url text not null,sha256 text not null,published_at timestamptz not null default now(),unique(version,platform,architecture));
alter table public.dream_invites enable row level security;
alter table public.dream_accounts enable row level security;
alter table public.dream_usage enable row level security;
alter table public.dream_shares enable row level security;
alter table public.dream_releases enable row level security;
create policy account_read on public.dream_accounts for select to authenticated using(id=auth.uid());
create policy usage_read on public.dream_usage for select to authenticated using(user_id=auth.uid());
create policy shares_read on public.dream_shares for select to authenticated using(user_id=auth.uid());
create policy releases_read on public.dream_releases for select using(true);
revoke all on public.dream_invites from anon,authenticated;
grant select on public.dream_accounts,public.dream_usage,public.dream_shares to authenticated;
grant select on public.dream_releases to anon,authenticated;
create or replace function public.dream_activate_account(p_user uuid,p_email text) returns boolean language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from dream_invites where lower(email)=lower(p_email)) then return false; end if;
 insert into dream_accounts(id,email) values(p_user,p_email) on conflict(id) do nothing;
 update dream_invites set claimed_by=p_user where lower(email)=lower(p_email) and (claimed_by is null or claimed_by=p_user);
 return exists(select 1 from dream_accounts where id=p_user and status='active');
end; $$;
create or replace function public.dream_reserve_usage(p_user uuid,p_request text,p_turn text,p_model text,p_reserved numeric) returns uuid language plpgsql security definer set search_path=public as $$
declare account dream_accounts; total numeric; result uuid;
begin
 select * into account from dream_accounts where id=p_user for update;
 if account.id is null or account.status<>'active' then raise exception 'Account is not active'; end if;
 select id into result from dream_usage where user_id=p_user and request_id=p_request;
 if result is not null then raise exception 'Request already submitted'; end if;
 select coalesce(sum(case when status='reserved' then reserved_usd else cost_usd end),0) into total from dream_usage where user_id=p_user and created_at>=date_trunc('day',now());
 if total+p_reserved>account.daily_budget_usd then raise exception 'Daily AI allowance reached'; end if;
 insert into dream_usage(user_id,request_id,turn_id,model,reserved_usd) values(p_user,p_request,p_turn,p_model,p_reserved) returning id into result;
 return result;
end; $$;
revoke all on function public.dream_activate_account(uuid,text) from public,anon,authenticated;
revoke all on function public.dream_reserve_usage(uuid,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.dream_activate_account(uuid,text),public.dream_reserve_usage(uuid,text,text,text,numeric) to service_role;
insert into public.dream_invites(email) values('yuanchengli612@gmail.com') on conflict do nothing;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('dream-exports','dream-exports',false,2147483648,array['video/mp4']) on conflict(id) do nothing;
