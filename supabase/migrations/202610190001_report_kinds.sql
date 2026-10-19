-- What an uploaded edit log is for (reports.ts): a report the user sent (Send log, or one sent automatically because an
-- edit went wrong), a rating (thumbs up or down, with the edit's log), or training data (every finished edit, for the
-- owner and for users who chose to help improve Gumbo's AI; never footage). Each kind has its own daily limit.
alter table public.dream_reports add column if not exists kind text not null default 'report' check (kind in ('report', 'feedback', 'training'));
alter table public.dream_reports add column if not exists rating text check (rating in ('up', 'down'));
create index if not exists dream_reports_user_kind_idx on public.dream_reports(user_id, kind, created_at);
