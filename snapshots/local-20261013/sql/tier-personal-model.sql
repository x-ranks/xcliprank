-- Run once in the SAME Supabase project's SQL Editor. No existing posts are modified.
create table if not exists public.xclip_tier_state (
 key text primary key, payload jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.xclip_tier_features (
 post_id text primary key, source_url text not null, feature_spec text not null,
 features jsonb, error text, retry_after timestamptz, updated_at timestamptz not null default now()
);
create table if not exists public.xclip_tier_worker_lease (
 key text primary key, owner uuid not null, expires_at timestamptz not null
);
alter table public.xclip_tier_state enable row level security;
alter table public.xclip_tier_features enable row level security;
alter table public.xclip_tier_worker_lease enable row level security;
revoke all on public.xclip_tier_state, public.xclip_tier_features, public.xclip_tier_worker_lease from anon, authenticated;
grant all on public.xclip_tier_state, public.xclip_tier_features, public.xclip_tier_worker_lease to service_role;
insert into public.xclip_tier_state(key,payload) values ('revision','{"value":0}'),('config','{"enabled":false}') on conflict do nothing;
create or replace function public.xclip_tier_review_changed() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='DELETE' then
   if old.manual_tier is null then return old; end if;
 elsif tg_op='INSERT' then
   if new.manual_tier is null then return new; end if;
 elsif new.manual_tier is not distinct from old.manual_tier
   and new.manual_reviewed_at is not distinct from old.manual_reviewed_at
   and new.moderation_blocked is not distinct from old.moderation_blocked
   and new.review_required is not distinct from old.review_required
   and new.content_category is not distinct from old.content_category then return new;
 end if;
 insert into public.xclip_tier_state(key,payload) values ('revision','{"value":1}')
 on conflict(key) do update set payload=jsonb_build_object('value',coalesce((xclip_tier_state.payload->>'value')::bigint,0)+1),updated_at=now();
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
drop trigger if exists xclip_tier_review_changed on public.posts;
create trigger xclip_tier_review_changed after insert or update or delete on public.posts for each row execute function public.xclip_tier_review_changed();
create or replace function public.xclip_claim_tier_worker(p_owner uuid) returns boolean language plpgsql security definer set search_path=public as $$
declare claimed uuid;
begin
 insert into public.xclip_tier_worker_lease(key,owner,expires_at) values ('training',p_owner,now()+interval '5 minutes')
 on conflict(key) do update set owner=excluded.owner,expires_at=excluded.expires_at where xclip_tier_worker_lease.expires_at<now()
 returning owner into claimed;
 return claimed is not null;
end $$;
revoke all on function public.xclip_claim_tier_worker(uuid) from public, anon, authenticated;
grant execute on function public.xclip_claim_tier_worker(uuid) to service_role;
