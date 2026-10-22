-- The beta is open: signing up on usegumbo.app hands over the download at once, so every account gets beta access as it
-- is made (the free monthly credits still cap what each one can spend). Waiting for an invite lost most sign-ups before
-- they opened the app. To close it again, set v_open to false: invites (dream_invites) and the owner still get in.
alter table public.dream_accounts alter column beta_access set default true;
update public.dream_accounts set beta_access = true where not beta_access;

create or replace function public.dream_activate_account(p_user uuid, p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
 v_email text := lower(trim(coalesce(p_email, '')));
 v_open constant boolean := true;
 v_admin boolean;
 v_access boolean;
begin
 if v_email = '' then return false; end if;
 v_admin := v_email = 'yuanchengli612@gmail.com';
 v_access := v_open or v_admin or exists(select 1 from dream_invites where lower(email) = v_email);
 insert into dream_accounts(id, email, is_admin, beta_access) values(p_user, v_email, v_admin, v_access)
  on conflict(id) do update set beta_access = true where not dream_accounts.beta_access and excluded.beta_access;
 update dream_invites set claimed_by = p_user where lower(email) = v_email and (claimed_by is null or claimed_by = p_user);
 return exists(select 1 from dream_accounts where id = p_user and status = 'active');
end $$;
revoke all on function public.dream_activate_account(uuid, text) from public, anon, authenticated;
grant execute on function public.dream_activate_account(uuid, text) to service_role;
