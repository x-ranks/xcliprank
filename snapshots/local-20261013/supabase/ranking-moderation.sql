alter table public.posts
  add column if not exists moderation_blocked boolean not null default false,
  add column if not exists moderation_reason text,
  add column if not exists moderation_source text,
  add column if not exists moderated_at timestamptz;

create index if not exists posts_moderation_blocked_idx
  on public.posts(moderation_blocked, created_at desc);

comment on column public.posts.moderation_blocked is
  'True when a human moderator has blocked this post from every ranking.';

comment on column public.posts.moderation_reason is
  'Human moderation reason: minor, voyeurism, nonconsensual, site_unsuitable, policy_violation, or other.';

comment on column public.posts.moderation_source is
  'Where the moderation decision was made, for example teacher_review or ranking_admin.';
