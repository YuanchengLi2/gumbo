-- Send log: one edit's log that a user chose to send (from the chat, under a finished request), with what they wrote about
-- it. It holds the request's calls, steps, notes, scene errors and edit document, never footage. Only the gateway (service
-- role) reads or writes it; a reference like GL-7K2Q9F is what the user quotes.
create table if not exists public.dream_reports (
 id uuid primary key default gen_random_uuid(),
 reference text not null unique,
 user_id uuid not null references public.dream_accounts(id) on delete cascade,
 turn_id text not null,
 project text,
 note text,
 app_version text,
 platform text,
 cost_usd numeric,
 calls integer,
 size_bytes integer not null,
 log jsonb not null,
 created_at timestamptz not null default now()
);
create index if not exists dream_reports_created on public.dream_reports(created_at desc);
alter table public.dream_reports enable row level security;
revoke all on public.dream_reports from anon, authenticated;
