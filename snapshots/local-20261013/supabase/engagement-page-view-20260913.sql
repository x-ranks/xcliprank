-- 既に engagement-events.sql を実行済みの本番DBへ、訪問イベントを追加します。
-- Supabase Dashboard > SQL Editor で、このファイル全体を1回だけ実行してください。

alter table public.engagement_events
  drop constraint if exists engagement_events_event_type_check;

alter table public.engagement_events
  add constraint engagement_events_event_type_check
  check (
    event_type in (
      'page_view',
      'video_open',
      'qualified_view',
      'ranking_change',
      'outbound_x'
    )
  );
