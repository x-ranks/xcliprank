-- Supabase Explorer: Run SQL -> query source Logs -> time range Last 24 hours.
-- Does not return tokens, full URLs, query strings, IPs, post/author IDs or log text.
SELECT target, method, status, selection, count() AS requests
FROM (
  SELECT
    multiIf(
      match(log_attributes['request.path'], '^/rest/v1/(posts|authors|engagement_events|metric_snapshots|xclip_tier_state|xclip_tier_features)(/|$)'),
        extract(log_attributes['request.path'], '^/rest/v1/([a-z_]+)'),
      startsWith(log_attributes['request.path'], '/rest/v1/rpc/'), 'rpc_other',
      startsWith(log_attributes['request.path'], '/rest/'), 'rest_other',
      startsWith(log_attributes['request.path'], '/auth/'), 'auth',
      startsWith(log_attributes['request.path'], '/storage/'), 'storage',
      startsWith(log_attributes['request.path'], '/realtime/'), 'realtime',
      'other'
    ) AS target,
    if(log_attributes['request.method'] IN ('GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS'),
       log_attributes['request.method'], 'other') AS method,
    toInt32OrZero(log_attributes['response.status_code']) AS status,
    if(match(log_attributes['request.url'], '(?i)[?&]select=(\\*|%2a)(&|$)'),
       'all_columns', 'other_or_not_recorded') AS selection
  FROM logs
  WHERE source = 'edge_logs'
    AND timestamp >= now() - INTERVAL 24 HOUR
)
GROUP BY target, method, status, selection
ORDER BY requests DESC
LIMIT 60;
