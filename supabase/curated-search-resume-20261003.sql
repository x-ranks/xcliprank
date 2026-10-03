-- Additive migration. Apply before deploying the matching collector.
alter table public.authors
  add column if not exists curated_last_attempt_at timestamptz,
  add column if not exists curated_pending_search jsonb;

-- Seed fairness using existing successful checks, without changing cursors.
update public.authors
set curated_last_attempt_at = curated_last_collected_at
where curated_last_attempt_at is null and curated_last_collected_at is not null;
