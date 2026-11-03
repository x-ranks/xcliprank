-- Additive migration. Run once in the Supabase SQL editor before deployment.
-- Stores post identities and attribution only, never video files or URLs.
begin;
create table if not exists public.curated_video_references (
  post_id text not null check (post_id ~ '^[0-9]{2,20}$'),
  source_author_id text not null check (source_author_id ~ '^[0-9]{2,20}$'),
  selected_author_id text not null check (selected_author_id ~ '^[0-9]{2,20}$'),
  selected_post_id text not null check (selected_post_id ~ '^[0-9]{2,20}$'),
  reference_kind text not null check (reference_kind in ('quote','repost')),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  observed_at timestamptz not null default now(),
  primary key (post_id, selected_author_id, selected_post_id)
);
create index if not exists curated_video_references_selected_idx on public.curated_video_references(selected_author_id,post_id);
create index if not exists curated_video_references_author_idx on public.curated_video_references(source_author_id,post_id);
alter table public.curated_video_references enable row level security;
revoke all on table public.curated_video_references from anon, authenticated;
grant select, insert, update on table public.curated_video_references to service_role;
comment on table public.curated_video_references is 'Verified quote/repost discovery; original author preserved; does not enroll source authors in patrol.';
notify pgrst, 'reload schema';
commit;
