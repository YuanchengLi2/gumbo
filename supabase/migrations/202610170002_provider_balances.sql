-- The balance of each API account Gumbo pays, as read off that provider's billing page and entered on the spending
-- dashboard (usegumbo.app/dashboard/). The dashboard subtracts what the gateway billed on that provider since set_at.
-- Only the gateway (service role) reads or writes it.
create table if not exists public.dream_provider_balances (
 provider text primary key check (provider in ('Anthropic','OpenAI','Google','DeepSeek','Groq')),
 balance_usd numeric(12,2) not null check (balance_usd >= 0),
 set_at timestamptz not null default now()
);
alter table public.dream_provider_balances enable row level security;
revoke all on public.dream_provider_balances from anon,authenticated;
