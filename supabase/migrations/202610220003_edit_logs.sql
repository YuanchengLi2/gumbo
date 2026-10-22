-- Edit logs: every request's log, sent by the app on its own when a run of it ends (the desktop's edit-logs.ts, the
-- gateway's edit-logs.ts), so beta usage can be studied and costly or broken edits found without anyone pressing Send
-- log. One row per request: a request that is resumed sends its longer log again and that replaces the row. The log holds
-- the request, the model calls, each tool's input and result, timings, cost and how it ended; never footage, and keys and
-- tokens are blanked before it leaves the app. The columns beside it are for querying. Only the gateway (service role)
-- reads or writes it.
create table if not exists public.dream_edit_logs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.dream_accounts(id) on delete cascade,
 turn_id text not null,
 run_key text not null,
 run_started_at timestamptz,
 runs integer not null default 1,
 app_version text,
 platform text,
 project text,
 request text,
 status text,
 cost_usd numeric,
 credits numeric,
 calls integer,
 tool_calls integer,
 tool_errors integer,
 duration_ms bigint,
 models text[],
 training boolean not null default false,
 size_bytes integer not null,
 log jsonb not null,
 started_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique (user_id, turn_id)
);
create index if not exists dream_edit_logs_created on public.dream_edit_logs(created_at desc);
create index if not exists dream_edit_logs_user_updated on public.dream_edit_logs(user_id, updated_at);
create index if not exists dream_edit_logs_status on public.dream_edit_logs(status, created_at desc);
create index if not exists dream_edit_logs_version on public.dream_edit_logs(app_version, created_at desc);
alter table public.dream_edit_logs enable row level security;
revoke all on public.dream_edit_logs from anon, authenticated;

-- Keeps one run's log: 'stored' (a new request), 'updated' (a later run of it), 'duplicate' (this run is already kept),
-- 'older' (a later run is already kept) or 'limit' (the account sent its most logs in the last day).
create or replace function public.dream_record_edit_log(p_row jsonb, p_daily_limit integer)
returns text language plpgsql security definer set search_path = public as $$
declare
 v_user uuid := (p_row->>'user_id')::uuid;
 v_turn text := p_row->>'turn_id';
 v_started timestamptz := nullif(p_row->>'run_started_at', '')::timestamptz;
 v_existing public.dream_edit_logs%rowtype;
begin
 perform pg_advisory_xact_lock(hashtext(v_user::text || '/' || v_turn));
 select * into v_existing from public.dream_edit_logs where user_id = v_user and turn_id = v_turn;
 if found and v_existing.run_key = p_row->>'run_key' then return 'duplicate'; end if;
 if found and v_existing.run_started_at is not null and (v_started is null or v_started < v_existing.run_started_at) then return 'older'; end if;
 if (select count(*) from public.dream_edit_logs where user_id = v_user and updated_at > now() - interval '1 day') >= p_daily_limit then return 'limit'; end if;
 insert into public.dream_edit_logs (user_id, turn_id, run_key, run_started_at, app_version, platform, project, request, status, cost_usd, credits, calls, tool_calls, tool_errors, duration_ms, models, training, size_bytes, log, started_at)
 values (v_user, v_turn, p_row->>'run_key', v_started, p_row->>'app_version', p_row->>'platform', p_row->>'project', p_row->>'request', p_row->>'status',
  (p_row->>'cost_usd')::numeric, (p_row->>'credits')::numeric, (p_row->>'calls')::integer, (p_row->>'tool_calls')::integer, (p_row->>'tool_errors')::integer,
  (p_row->>'duration_ms')::bigint, array(select jsonb_array_elements_text(coalesce(p_row->'models', '[]'::jsonb))), coalesce((p_row->>'training')::boolean, false),
  (p_row->>'size_bytes')::integer, p_row->'log', nullif(p_row->>'started_at', '')::timestamptz)
 on conflict (user_id, turn_id) do update set run_key = excluded.run_key, run_started_at = excluded.run_started_at, runs = public.dream_edit_logs.runs + 1,
  app_version = excluded.app_version, platform = excluded.platform, project = excluded.project, request = excluded.request, status = excluded.status,
  cost_usd = excluded.cost_usd, credits = excluded.credits, calls = excluded.calls, tool_calls = excluded.tool_calls, tool_errors = excluded.tool_errors,
  duration_ms = excluded.duration_ms, models = excluded.models, training = excluded.training, size_bytes = excluded.size_bytes, log = excluded.log,
  started_at = excluded.started_at, updated_at = now();
 return case when v_existing.id is null then 'stored' else 'updated' end;
end $$;
revoke execute on function public.dream_record_edit_log(jsonb, integer) from public, anon, authenticated;
grant execute on function public.dream_record_edit_log(jsonb, integer) to service_role;
