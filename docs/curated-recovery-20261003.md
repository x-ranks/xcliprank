# Curated search recovery

Normal Cron requests remain at 50 posts per author. An unfinished search now
stores its fixed time window, exclusive oldest raw Post ID, and latest raw
Post ID in authors.curated_pending_search. The next run uses until_id to read
older, unprocessed results. Within one execution, additional pages use next_token.
Successful cursors advance only after post and metric snapshot writes succeed.
Selection uses curated_last_attempt_at so incomplete authors do not monopolize
the batch. Structured server logs distinguish completed, incomplete, and error.

## Deployment order

1. Apply supabase/curated-search-resume-20261003.sql to the same production
   Supabase used by ColorfulBox. The migration only adds columns and seeds the
   last-attempt time; it leaves successful cursors and stored videos unchanged.
2. Confirm the columns exist before sending requests to the new Preview.
3. Validate Preview rankings, Reels, and unauthorized collection (401/403).
   Do not run paid collection on Preview.
4. Build and deploy using the existing ColorfulBox standalone/Passenger
   packaging, environment, and restart procedure. Preserve the previous runtime
   for rollback. Do not deploy a normal Next build as a standalone runtime.
5. Check the production collection response without authorization; it must be
   rejected. Check public rankings and Reels.
6. Execute ONE authenticated recovery call for InhoPark18:
   GET /api/collect-curated-batch?recovery=1&author=InhoPark18
   Put the existing Cron secret in the Authorization header, never the URL/log.
   Check results.saved, duplicates, incomplete, reservedReads, and halted.
7. Read the persisted pending state and successful cursor. If incomplete remains,
   it resumes on the next normal run. A follow-up recovery call is an additional
   paid operation, not automatically authorized by the first call's budget.

## Budget and error behavior

Recovery requires an explicit comma-separated author list (maximum six), and
reserves at most 400 Post reads across the whole request, with at most 200 per
author. Normal Cron does not enable recovery. At the published $0.005/Post rate,
400 Post reads is $2 of Post-read charges, not a guarantee of total account cost.
No user expansion is requested. A failed request retains its reserved budget
to avoid exceeding the cap when billing is uncertain. 429 and 402 halt the batch.
Never run recovery concurrently with Cron or another recovery call.

A capped search remains visible as incomplete; it is not relabeled successful.
The compatibility failed field counts errors plus incomplete authors. The new
errors and incomplete fields distinguish them. Recovery budget exhaustion sets
halted=read_budget and reports unprocessed authors.

The API can only recover its Recent Search window. Pending bounds approaching
seven days may expire: the collector reports a manual-review error instead of
silently skipping unseen posts. Older history already outside that window
cannot be recovered with Recent Search.

## Validation

Run node scripts/test-curated-recovery.cjs, npx tsc --noEmit, and npm run build.
Offline tests cover capped/resumed pages without duplicate/missing Post IDs,
fixed time bounds, exclusive until_id without the incompatible end_time,
snapshot-write failure, a shared budget below the ten-Post API minimum,
429 halting without retry, required authorization and explicit recovery targets.
No real X API or production DB is used by the offline tests.
