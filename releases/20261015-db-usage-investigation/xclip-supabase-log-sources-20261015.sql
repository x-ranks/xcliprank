-- Supabase Explorer: Run SQL -> query source Logs -> time range Last 24 hours.
-- ClickHouse SQL. Run in Logs, not Database. Returns aggregate counts only.
SELECT
  source,
  count() AS event_count
FROM logs
WHERE timestamp >= now() - INTERVAL 24 HOUR
GROUP BY source
ORDER BY event_count DESC
LIMIT 20;
