alter table public.dream_invites drop constraint dream_invites_claimed_by_fkey;
alter table public.dream_invites add constraint dream_invites_claimed_by_fkey foreign key (claimed_by) references auth.users(id) on delete set null;
