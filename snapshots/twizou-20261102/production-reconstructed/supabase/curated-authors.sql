-- Hand-selected author collection pool.
-- Safe to run more than once: all columns and indexes are additive.

alter table public.authors
  add column if not exists is_curated boolean not null default false,
  add column if not exists curated_status text,
  add column if not exists curated_expected_tier text,
  add column if not exists curated_added_at timestamptz,
  add column if not exists curated_backfill_status text,
  add column if not exists curated_backfill_completed_at timestamptz,
  add column if not exists curated_last_collected_at timestamptz,
  add column if not exists curated_last_post_id text,
  add column if not exists curated_total_fetched bigint not null default 0,
  add column if not exists curated_total_saved bigint not null default 0,
  add column if not exists curated_total_duplicates bigint not null default 0,
  add column if not exists curated_total_safety_excluded bigint not null default 0,
  add column if not exists curated_total_content_excluded bigint not null default 0,
  add column if not exists curated_total_accepted bigint not null default 0,
  add column if not exists curated_last_error text,
  add column if not exists curated_unavailable_failure_count integer not null default 0,
  add column if not exists curated_unavailable_since timestamptz;

alter table public.posts
  add column if not exists collection_source text not null default 'discovery',
  add column if not exists video_fingerprint text,
  add column if not exists visual_preference_score double precision;

create index if not exists authors_curated_schedule_idx
  on public.authors(is_curated, curated_status, curated_backfill_status, curated_last_collected_at);

create index if not exists posts_media_key_idx
  on public.posts(media_key)
  where media_key is not null;

create index if not exists posts_video_url_idx
  on public.posts(video_url)
  where video_url is not null;

create index if not exists posts_collection_source_idx
  on public.posts(collection_source, created_at desc);

comment on column public.authors.curated_status is
  'active, paused, or unavailable for the hand-selected author collector';
comment on column public.authors.curated_backfill_status is
  'pending, running, completed, or failed';
comment on column public.posts.video_fingerprint is
  'Reserved for perceptual duplicate detection; exact media and URL duplicates are already rejected';
comment on column public.posts.visual_preference_score is
  'Optional score from the local visual preference model';
