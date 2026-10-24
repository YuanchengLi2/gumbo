-- The community page on usegumbo.app (sign-in-site/community): what's new in Gumbo, and a board where people post ideas,
-- bugs and questions, reply to each other and upvote. Anyone can read it. A signed-in account posts, replies and votes as
-- itself; only the owner (dream_accounts.is_admin) posts updates, sets a post's status and removes what anyone wrote.
-- The page talks to these tables directly (PostgREST with the visitor's own session), so the rules live here.

create table if not exists public.dream_community_posts(
 id uuid primary key default gen_random_uuid(),
 author uuid references auth.users(id) on delete set null default auth.uid(),
 author_name text not null default '',
 kind text not null check (kind in ('update','idea','bug','question')),
 title text not null check (length(btrim(title)) between 3 and 140),
 body text not null default '' check (length(body) <= 8000),
 status text not null default 'open' check (status in ('open','planned','in_progress','shipped','closed')),
 -- A changelog entry's own name (CHANGELOG.md's heading, scripts/publish-changelog.ts), so publishing it again updates it.
 slug text unique,
 votes integer not null default 0,
 replies integer not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists dream_community_posts_created_idx on public.dream_community_posts(created_at desc);

create table if not exists public.dream_community_replies(
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null references public.dream_community_posts(id) on delete cascade,
 author uuid references auth.users(id) on delete set null default auth.uid(),
 author_name text not null default '',
 body text not null check (length(btrim(body)) between 1 and 4000),
 created_at timestamptz not null default now()
);
create index if not exists dream_community_replies_post_idx on public.dream_community_replies(post_id,created_at);

create table if not exists public.dream_community_votes(
 post_id uuid not null references public.dream_community_posts(id) on delete cascade,
 voter uuid not null references auth.users(id) on delete cascade default auth.uid(),
 created_at timestamptz not null default now(),
 primary key(post_id,voter)
);

create or replace function public.dream_community_admin() returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((select is_admin from dream_accounts where id=auth.uid()),false)
$$;

-- The owner on the page, or Gumbo's own scripts on the database (scripts/publish-changelog.ts), which have no visitor's
-- role: both may write anything.
create or replace function public.dream_community_trusted() returns boolean language sql stable security definer set search_path=public as $$
 select dream_community_admin() or coalesce(nullif(current_setting('role',true),''),'none') in ('none','postgres','service_role')
$$;

-- What a post or reply is signed with: set here, never by the writer. The owner signs as Gumbo; anyone else by the name
-- their Google account gives, or "Gumbo user" (an email address is never shown).
create or replace function public.dream_community_name(p_user uuid) returns text language sql stable security definer set search_path=public as $$
 select case when coalesce((select is_admin from dream_accounts where id=p_user),false) then 'Gumbo'
  else coalesce(nullif(btrim(left((select coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name') from auth.users where id=p_user),60)),''),'Gumbo user') end
$$;

-- Writing: who and what may be written. Someone other than the owner writes as themselves, an open idea, bug or
-- question, at most 10 posts and 60 replies an hour; counts and names are the database's.
create or replace function public.dream_community_post_write() returns trigger language plpgsql security definer set search_path=public as $$
declare v_admin boolean := dream_community_trusted();
begin
 -- A vote or reply recounted: only the counts change.
 if tg_op='UPDATE' and current_setting('dream.counting',true)='on' then return new; end if;
 if tg_op='INSERT' then
  if not v_admin then
   if auth.uid() is null then raise exception 'Sign in to post.'; end if;
   if new.kind='update' then raise exception 'Only Gumbo posts updates.'; end if;
   if (select count(*) from dream_community_posts where author=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'That is a lot of posts for one hour. Try again later.'; end if;
   new.author:=auth.uid();new.status:='open';new.slug:=null;
  end if;
  new.author_name:=case when new.kind='update' then 'Gumbo' else dream_community_name(new.author) end;new.votes:=0;new.replies:=0;new.created_at:=coalesce(new.created_at,now());
  if not v_admin then new.created_at:=now(); end if;
 else
  -- The author may edit their words; only the owner changes the status or the kind. Counts are the triggers' own.
  if not v_admin then
   if old.author is distinct from auth.uid() then raise exception 'Only the author can change a post.'; end if;
   new.status:=old.status;new.kind:=old.kind;new.slug:=old.slug;
  end if;
  new.author:=old.author;new.author_name:=old.author_name;new.created_at:=old.created_at;new.votes:=old.votes;new.replies:=old.replies;
 end if;
 return new;
end $$;
drop trigger if exists dream_community_post_write on public.dream_community_posts;
create trigger dream_community_post_write before insert or update on public.dream_community_posts for each row execute function public.dream_community_post_write();

create or replace function public.dream_community_reply_write() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null and not dream_community_trusted() then raise exception 'Sign in to reply.'; end if;
 if not dream_community_trusted() then
  if (select count(*) from dream_community_replies where author=auth.uid() and created_at>now()-interval '1 hour')>=60 then raise exception 'That is a lot of replies for one hour. Try again later.'; end if;
  new.author:=auth.uid();
 end if;
 new.author_name:=dream_community_name(new.author);new.created_at:=now();
 return new;
end $$;
drop trigger if exists dream_community_reply_write on public.dream_community_replies;
create trigger dream_community_reply_write before insert on public.dream_community_replies for each row execute function public.dream_community_reply_write();

-- The counts on a post follow its votes and replies.
create or replace function public.dream_community_count() returns trigger language plpgsql security definer set search_path=public as $$
declare v_post uuid := coalesce(new.post_id,old.post_id);
begin
 perform set_config('dream.counting','on',true);
 if tg_table_name='dream_community_votes' then update dream_community_posts set votes=(select count(*) from dream_community_votes where post_id=v_post) where id=v_post;
 else update dream_community_posts set replies=(select count(*) from dream_community_replies where post_id=v_post) where id=v_post; end if;
 perform set_config('dream.counting','off',true);
 return null;
end $$;
drop trigger if exists dream_community_vote_count on public.dream_community_votes;
create trigger dream_community_vote_count after insert or delete on public.dream_community_votes for each row execute function public.dream_community_count();
drop trigger if exists dream_community_reply_count on public.dream_community_replies;
create trigger dream_community_reply_count after insert or delete on public.dream_community_replies for each row execute function public.dream_community_count();

alter table public.dream_community_posts enable row level security;
alter table public.dream_community_replies enable row level security;
alter table public.dream_community_votes enable row level security;

drop policy if exists community_posts_read on public.dream_community_posts;
create policy community_posts_read on public.dream_community_posts for select to anon,authenticated using(true);
drop policy if exists community_posts_write on public.dream_community_posts;
create policy community_posts_write on public.dream_community_posts for insert to authenticated with check(auth.uid() is not null);
drop policy if exists community_posts_edit on public.dream_community_posts;
create policy community_posts_edit on public.dream_community_posts for update to authenticated using(author=auth.uid() or dream_community_admin());
drop policy if exists community_posts_remove on public.dream_community_posts;
create policy community_posts_remove on public.dream_community_posts for delete to authenticated using(author=auth.uid() or dream_community_admin());

drop policy if exists community_replies_read on public.dream_community_replies;
create policy community_replies_read on public.dream_community_replies for select to anon,authenticated using(true);
drop policy if exists community_replies_write on public.dream_community_replies;
create policy community_replies_write on public.dream_community_replies for insert to authenticated with check(auth.uid() is not null);
drop policy if exists community_replies_remove on public.dream_community_replies;
create policy community_replies_remove on public.dream_community_replies for delete to authenticated using(author=auth.uid() or dream_community_admin());

-- Votes are counted on the posts; each account sees only its own.
drop policy if exists community_votes_own on public.dream_community_votes;
create policy community_votes_own on public.dream_community_votes for select to authenticated using(voter=auth.uid());
drop policy if exists community_votes_cast on public.dream_community_votes;
create policy community_votes_cast on public.dream_community_votes for insert to authenticated with check(voter=auth.uid());
drop policy if exists community_votes_take_back on public.dream_community_votes;
create policy community_votes_take_back on public.dream_community_votes for delete to authenticated using(voter=auth.uid());

revoke all on public.dream_community_posts,public.dream_community_replies,public.dream_community_votes from anon,authenticated;
grant select on public.dream_community_posts,public.dream_community_replies to anon,authenticated;
grant insert(kind,title,body,status,slug,created_at),update(title,body,status,kind),delete on public.dream_community_posts to authenticated;
grant insert(post_id,body),delete on public.dream_community_replies to authenticated;
grant select,insert(post_id),delete on public.dream_community_votes to authenticated;
revoke all on function public.dream_community_admin(),public.dream_community_trusted(),public.dream_community_name(uuid) from public,anon;
grant execute on function public.dream_community_admin() to authenticated;
