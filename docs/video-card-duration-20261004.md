# Video cards and duration (2026-10-04)

Public ranking cards and Reels no longer show Tier or ranking-score badges.
Internal Tier classification, filters and ranking calculations remain in place.
Ranking cards display m:ss (or h:mm:ss) at the bottom right when duration is known.
Reels display total duration from their existing HTML video metadata event.

Existing post rows do not retain X media duration. Ranking cards use the existing
/api/video endpoint with metadata=1 to read the MP4 movie header from video.twimg.com.
No X API request, new paid field, database migration or whole-video backfill is needed.
Only viewport cards request duration, with at most two concurrent client requests.
The server deduplicates requests and caches up to 512 URLs, probes at most four
videos concurrently, follows no redirects, reads at most 256 KiB in at most eight
range requests, and times out after eight seconds. Unavailable duration is hidden.
The existing streaming mode of /api/video is preserved.

Offline checks use synthetic v0/v1 movie headers, large media data with metadata
at the end, malformed data, disallowed URLs, and canceled non-range upstreams.
When FFmpeg is installed, real three-second MP4 fixtures at the beginning/end are
also verified. No paid collection is part of staging or deployment verification.

User requested this display change before the separately approved expired-window
policy change. Do not apply the expired-window policy in this UI deployment.
