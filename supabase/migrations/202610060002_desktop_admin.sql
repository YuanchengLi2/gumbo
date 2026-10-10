alter table public.dream_accounts add column if not exists is_admin boolean not null default false;
create or replace function public.dream_activate_account(p_user uuid,p_email text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from dream_invites where lower(email)=lower(p_email)) then return false; end if;
 insert into dream_accounts(id,email,is_admin) values(p_user,lower(p_email),lower(p_email)='yuanchengli612@gmail.com') on conflict(id) do nothing;
 update dream_invites set claimed_by=p_user where lower(email)=lower(p_email) and (claimed_by is null or claimed_by=p_user);
 return exists(select 1 from dream_accounts where id=p_user and status='active');
end $$;
revoke all on function public.dream_activate_account(uuid,text) from public,anon,authenticated;
grant execute on function public.dream_activate_account(uuid,text) to service_role;
