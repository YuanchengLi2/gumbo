-- What a new user told Gumbo when the desktop app first opened (its onboarding): what to call them, what they make, how
-- much they have edited and how they found Gumbo. One row per account, written only by the gateway (profiles.ts, with the
-- service role); the account can read its own. onboarded_at is when they first answered: saving again keeps it.

create table if not exists public.dream_profiles (
 user_id uuid primary key references public.dream_accounts(id) on delete cascade,
 display_name text not null default '',
 makes text[] not null default '{}',
 experience text check (experience in ('new','some','pro')),
 heard text check (heard in ('youtube','tiktok','x','reddit','friend','search','other')),
 onboarded_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.dream_profiles enable row level security;
create policy profiles_read on public.dream_profiles for select to authenticated using (user_id = auth.uid());
grant select on public.dream_profiles to authenticated;
