alter table public.dream_accounts add column if not exists is_guest boolean not null default false;
create or replace function public.dream_activate_guest(p_user uuid) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from auth.users where id=p_user and is_anonymous=true) then return false; end if;
 insert into dream_accounts(id,email,is_guest) values(p_user,'',true) on conflict(id) do nothing;
 return exists(select 1 from dream_accounts where id=p_user and status='active');
end; $$;
revoke all on function public.dream_activate_guest(uuid) from public,anon,authenticated;
grant execute on function public.dream_activate_guest(uuid) to service_role;
