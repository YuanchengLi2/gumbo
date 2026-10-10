create table if not exists public.dream_inference_results (
 user_id uuid not null references auth.users(id) on delete cascade,
 request_id text not null,
 body_hash text not null,
 status text not null check(status in ('running','completed','failed','uncertain','cancelled')),
 response jsonb,
 error text,
 lease_until timestamptz not null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '24 hours',
 primary key(user_id,request_id)
);
alter table public.dream_inference_results enable row level security;
revoke all on public.dream_inference_results from anon,authenticated;
grant all on public.dream_inference_results to service_role;
create index if not exists dream_inference_expiry on public.dream_inference_results(expires_at);

create or replace function public.dream_claim_inference(p_user uuid,p_request text,p_hash text,p_wall_ms integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare claimed integer; saved dream_inference_results;
begin
 delete from dream_inference_results where expires_at<now();
 insert into dream_inference_results(user_id,request_id,body_hash,status,lease_until)
 values(p_user,p_request,p_hash,'running',now()+make_interval(secs => least(370000,greatest(1000,p_wall_ms))/1000.0+10))
 on conflict do nothing;
 get diagnostics claimed=row_count;
 select * into saved from dream_inference_results where user_id=p_user and request_id=p_request;
 return jsonb_build_object('owner',claimed=1,'record',to_jsonb(saved));
end; $$;
revoke all on function public.dream_claim_inference(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.dream_claim_inference(uuid,text,text,integer) to service_role;
