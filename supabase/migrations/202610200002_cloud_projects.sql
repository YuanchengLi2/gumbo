-- Gumbo's cloud (supabase/functions/dream-gateway/cloud.ts): projects saved from one computer to open on another. The
-- files themselves live in Cloudflare R2; this is which files each saved project has and how much space it takes, which
-- counts against the plan's cloudGB.
create table if not exists public.dream_cloud_projects(
 account_id uuid not null references public.dream_accounts(id) on delete cascade,
 project_id text not null,
 name text not null,
 size_bytes bigint not null default 0 check(size_bytes>=0),
 files integer not null default 0,
 device text,
 updated_at timestamptz not null default now(),
 primary key(account_id,project_id)
);
create table if not exists public.dream_cloud_files(
 account_id uuid not null,
 project_id text not null,
 path text not null,
 size bigint not null check(size>=0),
 sha256 text not null,
 primary key(account_id,project_id,path),
 foreign key(account_id,project_id) references public.dream_cloud_projects(account_id,project_id) on delete cascade
);
alter table public.dream_cloud_projects enable row level security;
alter table public.dream_cloud_files enable row level security;
revoke all on public.dream_cloud_projects,public.dream_cloud_files from anon,authenticated;

-- A save: the project's file list and totals replaced in one transaction; null removes the project.
create or replace function public.dream_cloud_save(p_account uuid,p_project text,p_entry jsonb) returns void
language plpgsql security definer set search_path=public as $$
begin
 if p_entry is null then delete from dream_cloud_projects where account_id=p_account and project_id=p_project; return; end if;
 insert into dream_cloud_projects(account_id,project_id,name,size_bytes,files,device,updated_at)
 select p_account,p_project,p_entry->>'name',coalesce(sum((f->>'size')::bigint),0),count(f),p_entry->>'device',now() from jsonb_array_elements(p_entry->'files') f
 on conflict(account_id,project_id) do update set name=excluded.name,size_bytes=excluded.size_bytes,files=excluded.files,device=excluded.device,updated_at=now();
 delete from dream_cloud_files where account_id=p_account and project_id=p_project;
 insert into dream_cloud_files(account_id,project_id,path,size,sha256)
 select p_account,p_project,f->>'path',(f->>'size')::bigint,f->>'sha256' from jsonb_array_elements(p_entry->'files') f;
end $$;
revoke all on function public.dream_cloud_save(uuid,text,jsonb) from public,anon,authenticated;
