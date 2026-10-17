-- Wrong passwords on the spending dashboard (usegumbo.app/dashboard/), by a digest of the address they came from, so the
-- gateway can refuse an address that keeps guessing. Only the gateway (service role) reads or writes it.
create table if not exists public.dream_dashboard_attempts (
 address text not null,
 created_at timestamptz not null default now()
);
create index if not exists dream_dashboard_attempts_recent on public.dream_dashboard_attempts(address,created_at);
alter table public.dream_dashboard_attempts enable row level security;
revoke all on public.dream_dashboard_attempts from anon,authenticated;
