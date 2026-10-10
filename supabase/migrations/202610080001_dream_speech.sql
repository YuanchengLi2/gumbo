-- Cached transcripts are private to the account. Raw uploaded audio is not stored.
create table public.dream_speech_cache (
 user_id uuid not null references public.dream_accounts(id) on delete cascade,
 audio_hash text not null,
 usage_id uuid references public.dream_usage(id),
 duration_seconds numeric not null,
 status text not null,
 result jsonb,
 updated_at timestamptz not null default now(),
 primary key(user_id,audio_hash)
);
alter table public.dream_speech_cache enable row level security;
revoke all on public.dream_speech_cache from anon,authenticated;
alter table public.dream_usage add column if not exists audio_seconds numeric not null default 0;

create or replace function public.dream_reserve_speech(p_user uuid,p_hash text,p_seconds numeric,p_cost numeric)
returns jsonb language plpgsql security definer set search_path=public as $$
declare cached dream_speech_cache; receipt uuid;
begin
 -- Serialize against the same account lock used by the shared spend budget.
 perform 1 from dream_accounts where id=p_user and status='active' for update;
 if not found then raise exception using message='Account is not active',errcode='D0001'; end if;
 select * into cached from dream_speech_cache where user_id=p_user and audio_hash=p_hash;
 if cached.status='completed' then return jsonb_build_object('result',cached.result); end if;
 if cached.status='running' and cached.updated_at>now()-interval '2 minutes' then return jsonb_build_object('busy',true); end if;
 -- Expired requests retain their reserved cost because the provider may have run.
 if cached.status='running' then update dream_usage set status='uncertain' where id=cached.usage_id; end if;
 receipt=dream_reserve_usage(p_user,'speech:'||gen_random_uuid()::text,p_hash,'whisper-large-v3-turbo',p_cost);
 update dream_usage set audio_seconds=p_seconds where id=receipt;
 insert into dream_speech_cache(user_id,audio_hash,usage_id,duration_seconds,status)
 values(p_user,p_hash,receipt,p_seconds,'running')
 on conflict(user_id,audio_hash) do update set usage_id=excluded.usage_id,status='running',updated_at=now();
 return jsonb_build_object('usage_id',receipt);
end; $$;

create or replace function public.dream_finish_speech(p_user uuid,p_hash text,p_usage uuid,p_status text,p_result jsonb,p_provider_status integer)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_status not in ('completed','failed','uncertain') then raise exception 'Invalid speech status'; end if;
 update dream_usage set status=p_status,cost_usd=case when p_status='completed' then reserved_usd else 0 end,provider_status=p_provider_status
 where id=p_usage and user_id=p_user;
 update dream_speech_cache set status=p_status,result=p_result,updated_at=now()
 where user_id=p_user and audio_hash=p_hash and usage_id=p_usage;
end; $$;
revoke all on function public.dream_reserve_speech(uuid,text,numeric,numeric),public.dream_finish_speech(uuid,text,uuid,text,jsonb,integer) from public,anon,authenticated;
grant execute on function public.dream_reserve_speech(uuid,text,numeric,numeric),public.dream_finish_speech(uuid,text,uuid,text,jsonb,integer) to service_role;
