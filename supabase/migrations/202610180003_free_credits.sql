-- Free accounts get 50 credits a month (was 100). A free period already granted keeps its credits until it ends; the
-- next monthly grant is 50. billing.ts in the gateway says the same.
create or replace function public.dream_free_credits() returns numeric language sql immutable as $$ select 50::numeric $$;
