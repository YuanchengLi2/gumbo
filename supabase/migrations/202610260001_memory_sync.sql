-- Memory sync for Gumbo for Chrome (the gateway's memory-sync.ts): the synced copy of the memory each computer keeps,
-- end-to-end encrypted with a key made on the user's computer from a passphrase only they know. Nothing here can be read
-- by Gumbo: per record an opaque id (sid), a stamp (at: when it was written, in ms; device: a random computer id;
-- version) and the sealed body (payload, base64); per account the key's id, its salt, how it was made (kdf) and a check
-- value (verifier) that tells a computer whether a passphrase is the right one without opening anything.
-- seq is the order records were taken in: a computer pulls what came after the last seq it saw. Pushes take the
-- account's lock, so its records get their seq in the order they commit and a pull never skips one.
-- Room per account: dream_limits.memory_sync_bytes (256 MB to start), changeable without a deploy.
alter table public.dream_limits add column if not exists memory_sync_bytes bigint not null default 268435456 check (memory_sync_bytes >= 0);

create table if not exists public.dream_memory_sync_keys (
 user_id uuid primary key references public.dream_accounts(id) on delete cascade,
 key_id text not null,
 salt text not null,
 kdf jsonb not null,
 verifier text not null,
 bytes bigint not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create sequence if not exists public.dream_memory_sync_seq;
create table if not exists public.dream_memory_sync (
 user_id uuid not null references public.dream_accounts(id) on delete cascade,
 sid text not null,
 seq bigint not null,
 at bigint not null,
 device text not null,
 version integer not null,
 payload text not null,
 size integer not null,
 updated_at timestamptz not null default now(),
 primary key (user_id, sid)
);
create index if not exists dream_memory_sync_cursor on public.dream_memory_sync(user_id, seq) include (size);

-- Row-level security per account: a signed-in user can read only their own ciphertext; only the gateway writes.
alter table public.dream_memory_sync enable row level security;
alter table public.dream_memory_sync_keys enable row level security;
revoke all on public.dream_memory_sync, public.dream_memory_sync_keys from anon, authenticated;
grant select on public.dream_memory_sync, public.dream_memory_sync_keys to authenticated;
drop policy if exists "Own synced memory" on public.dream_memory_sync;
create policy "Own synced memory" on public.dream_memory_sync for select to authenticated using (user_id = auth.uid());
drop policy if exists "Own sync key" on public.dream_memory_sync_keys;
create policy "Own sync key" on public.dream_memory_sync_keys for select to authenticated using (user_id = auth.uid());

create or replace function public.dream_memory_sync_profile(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
 select jsonb_build_object('key_id', k.key_id, 'salt', k.salt, 'kdf', k.kdf, 'verifier', k.verifier, 'bytes', k.bytes,
  'limit_bytes', (select memory_sync_bytes from dream_limits where id))
 from dream_memory_sync_keys k where k.user_id = p_user
$$;

-- A new key profile; false when the account already has one (another computer set sync up first).
create or replace function public.dream_memory_sync_setup(p_user uuid, p_key_id text, p_salt text, p_kdf jsonb, p_verifier text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
 perform pg_advisory_xact_lock(hashtext('memory-sync/' || p_user::text));
 insert into dream_memory_sync_keys (user_id, key_id, salt, kdf, verifier) values (p_user, p_key_id, p_salt, p_kdf, p_verifier)
 on conflict (user_id) do nothing;
 return found;
end $$;

-- Deletes the synced copy and its key profile.
create or replace function public.dream_memory_sync_reset(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
 perform pg_advisory_xact_lock(hashtext('memory-sync/' || p_user::text));
 delete from dream_memory_sync where user_id = p_user;
 delete from dream_memory_sync_keys where user_id = p_user;
end $$;

-- Keeps each record unless the copy here is newer (a later at; at the same at the higher device, compared byte by byte,
-- then the higher version: the extension's sync-engine.ts newer()). The same version sent again changes nothing. Stops
-- at the first record that would take the account past its room (a record that shrinks always goes through). Answers
-- how many it went through (taken), how many it kept (applied), which were older, and whether it is full;
-- {"error":"key_changed"} when the key is not the account's.
create or replace function public.dream_memory_sync_push(p_user uuid, p_key_id text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
 v_key dream_memory_sync_keys%rowtype;
 v_limit bigint;
 v_bytes bigint;
 r record;
 v_old_at bigint; v_old_device text; v_old_version integer; v_old_size integer;
 v_size integer;
 v_applied integer := 0; v_taken integer := 0; v_older text[] := '{}'; v_full boolean := false;
begin
 perform pg_advisory_xact_lock(hashtext('memory-sync/' || p_user::text));
 select * into v_key from dream_memory_sync_keys where user_id = p_user for update;
 if not found or v_key.key_id <> p_key_id then return jsonb_build_object('error', 'key_changed'); end if;
 select memory_sync_bytes into v_limit from dream_limits where id;
 v_bytes := v_key.bytes;
 for r in select * from jsonb_to_recordset(p_rows) as x(sid text, at bigint, device text, version integer, payload text) loop
  v_old_at := null; v_old_device := null; v_old_version := null; v_old_size := null;
  select m.at, m.device, m.version, m.size into v_old_at, v_old_device, v_old_version, v_old_size from dream_memory_sync m where m.user_id = p_user and m.sid = r.sid;
  if v_old_at is not null and (v_old_at > r.at or (v_old_at = r.at and (v_old_device collate "C" > r.device collate "C"
   or (v_old_device = r.device and v_old_version >= r.version)))) then
   v_older := v_older || r.sid; v_taken := v_taken + 1; continue;
  end if;
  v_size := length(r.payload);
  if v_size > coalesce(v_old_size, 0) and v_bytes + v_size - coalesce(v_old_size, 0) > v_limit then v_full := true; exit; end if;
  insert into dream_memory_sync (user_id, sid, seq, at, device, version, payload, size)
  values (p_user, r.sid, nextval('dream_memory_sync_seq'), r.at, r.device, r.version, r.payload, v_size)
  on conflict (user_id, sid) do update set seq = excluded.seq, at = excluded.at, device = excluded.device, version = excluded.version,
   payload = excluded.payload, size = excluded.size, updated_at = now();
  v_bytes := v_bytes + v_size - coalesce(v_old_size, 0);
  v_applied := v_applied + 1; v_taken := v_taken + 1;
 end loop;
 update dream_memory_sync_keys set bytes = v_bytes, updated_at = now() where user_id = p_user;
 return jsonb_build_object('applied', v_applied, 'older', to_jsonb(v_older), 'taken', v_taken, 'full', v_full, 'bytes', v_bytes, 'limit', v_limit);
end $$;

-- The records taken after p_since, in order: at most p_limit, and no more than p_max_bytes of them (always at least one).
create or replace function public.dream_memory_sync_pull(p_user uuid, p_key_id text, p_since bigint, p_limit integer, p_max_bytes bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text; v_rows jsonb; v_last bigint;
begin
 perform pg_advisory_xact_lock(hashtext('memory-sync/' || p_user::text));
 select key_id into v_key from dream_memory_sync_keys where user_id = p_user;
 if v_key is null or v_key <> p_key_id then return jsonb_build_object('error', 'key_changed'); end if;
 with page as (
  select seq, size, sum(size) over (order by seq) as running
  from (select seq, size from dream_memory_sync where user_id = p_user and seq > p_since order by seq limit p_limit) s
 ), chosen as (select seq from page where running <= p_max_bytes or running = size)
 select coalesce(jsonb_agg(jsonb_build_object('sid', m.sid, 'seq', m.seq, 'at', m.at, 'device', m.device, 'version', m.version, 'payload', m.payload) order by m.seq), '[]'::jsonb), max(m.seq)
 into v_rows, v_last
 from dream_memory_sync m join chosen c on m.seq = c.seq where m.user_id = p_user;
 return jsonb_build_object('rows', v_rows, 'more', exists(select 1 from dream_memory_sync where user_id = p_user and seq > coalesce(v_last, p_since)));
end $$;

revoke execute on function public.dream_memory_sync_profile(uuid) from public, anon, authenticated;
revoke execute on function public.dream_memory_sync_setup(uuid, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.dream_memory_sync_reset(uuid) from public, anon, authenticated;
revoke execute on function public.dream_memory_sync_push(uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.dream_memory_sync_pull(uuid, text, bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.dream_memory_sync_profile(uuid) to service_role;
grant execute on function public.dream_memory_sync_setup(uuid, text, text, jsonb, text) to service_role;
grant execute on function public.dream_memory_sync_reset(uuid) to service_role;
grant execute on function public.dream_memory_sync_push(uuid, text, jsonb) to service_role;
grant execute on function public.dream_memory_sync_pull(uuid, text, bigint, integer, bigint) to service_role;
