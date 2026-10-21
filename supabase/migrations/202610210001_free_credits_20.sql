-- Free accounts get 20 credits a month (was 50): about five edits, while the beta's free credits are paid out of pocket.
-- A free period already granted keeps its credits until it ends; the next monthly grant is 20. billing.ts in the gateway
-- says the same.
create or replace function public.dream_free_credits() returns numeric language sql immutable as $$ select 20::numeric $$;
