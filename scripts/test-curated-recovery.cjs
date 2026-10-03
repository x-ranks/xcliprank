// Offline integration tests: real collector/search/route, fake X and DB.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
let state, queue, requests;
function reset(authors = []) {
  state = { authors, posts: [], snapshots: [], failSnapshots: false, lookups: [] };
  queue = []; requests = [];
}
function author(username = "example") {
  return { username, x_author_id: username, curated_backfill_status: "completed",
    curated_last_collected_at: null, curated_last_post_id: null,
    curated_pending_search: null, is_curated: true, curated_status: "active" };
}
function page(high, count, more) {
  const data = Array.from({ length: count }, (_, i) => ({
    id: String(high - i), text: "test", author_id: "example",
    created_at: new Date().toISOString(), attachments: { media_keys: ["m" + (high - i)] }
  }));
  return { data, includes: { media: data.map(p => ({
    media_key: p.attachments.media_keys[0], type: "video", variants: []
  })) }, meta: more ? { next_token: "next" } : {} };
}
function db() {
  return { from(table) {
    let op = "select", values, filters = [], column;
    const b = {
      select(c) { column = c; return b; },
      eq(k, v) { filters.push(row => row[k] === v); return b; },
      in(k, v) {
        if (table === "posts") {
          state.lookups.push({ column: k, values: v });
          if (v.length > 20 || v.reduce((n, x) => n + encodeURIComponent(x).length + 12, 0) > 4000)
            throw new TypeError("fetch failed: oversized duplicate lookup");
        }
        filters.push(row => v.includes(row[k])); return b;
      },
      order() { return b; }, limit() { return b; },
      update(v) { op = "update"; values = v; return b; },
      upsert(v) { op = "upsert"; values = v; return b; },
      insert(v) { op = "insert"; values = v; return b; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          const rows = table === "authors" ? state.authors : table === "posts" ? state.posts : [];
          const selected = rows.filter(row => filters.every(f => f(row)));
          if (table === "metric_snapshots" && state.failSnapshots)
            return { error: new Error("snapshot write failed") };
          if (op === "update") selected.forEach(row => Object.assign(row,
            Object.fromEntries(Object.entries(values).filter(([,v]) => v !== undefined))));
          if (op === "upsert") state.posts.push(...values);
          if (op === "insert" && table === "metric_snapshots") state.snapshots.push(...values);
          return { data: selected.map(row => column && !column.includes(",")
            ? { [column]: row[column] } : { ...row }), error: null };
        }).then(resolve, reject);
      }
    };
    return b;
  }};
}
const mocks = {
  "lib/supabase-admin": { supabaseAdmin: db },
  "lib/adult-score": { calculateAdultScore: () => 0, calculateCreatorScore: () => 0,
    requiresSafetyReview: () => false },
  "lib/content-filter": { classifyContent: () => ({ category: "PASS", score: 1, reason: "test" }) },
  "lib/tier-learning": { loadTierLearningModel: async () => null,
    predictLearnedTier: () => null, blendRuleAndLearnedTier: rule => rule },
  "lib/ranking": { rankingScore: () => 0 },
  "lib/cron-auth": { isCronAuthorized: req => req.authorized === true },
};
const cache = new Map();
function load(id) {
  if (mocks[id]) return mocks[id];
  if (cache.has(id)) return cache.get(id).exports;
  const m = { exports: {} }; cache.set(id, m);
  const source = fs.readFileSync(path.join(root, id + ".ts"), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }}).outputText;
  const localRequire = name => {
    if (name === "next/server") return { NextResponse: {
      json: (data, opts) => ({ data, status: opts?.status ?? 200 })
    }};
    if (name.startsWith(".")) return load(path.posix.normalize(path.posix.join(path.posix.dirname(id), name)));
    return require(name);
  };
  new Function("require", "module", "exports", "process", "console", "fetch", code)(
    localRequire, m, m.exports, { env: { X_BEARER_TOKEN: "offline-test-only" } },
    { log() {}, error() {} },
    async url => {
      const request = new URL(url);
      const hasId = request.searchParams.has("since_id") || request.searchParams.has("until_id");
      const hasTime = request.searchParams.has("start_time") || request.searchParams.has("end_time");
      assert.ok(!(hasId && hasTime), "X rejects mixed ID and time bounds");
      requests.push(request); const item = queue.shift();
      assert.ok(item, "unexpected paid request");
      if (item.status) return { ok: false, status: item.status, text: async () => "test error" };
      return { ok: true, status: 200, json: async () => item };
    }
  );
  return m.exports;
}
async function run() {
  const { collectCuratedAuthor } = load("lib/curated-collector");
  const { searchRecentVideoPostBatch } = load("lib/x");
  const { GET } = load("app/api/collect-curated-batch/route");
  const a = author(); reset([a]);
  queue.push(page(1000, 50, true));
  const first = await collectCuratedAuthor({ ...a }, "incremental");
  assert.equal(first.saved, 50); assert.equal(first.incomplete, true);
  assert.equal(a.curated_last_post_id, null);
  assert.equal(a.curated_pending_search.untilId, "951");
  const fixedEnd = a.curated_pending_search.endTime;
  const fixedStart = a.curated_pending_search.startTime;
  queue.push(page(950, 50, true));
  await collectCuratedAuthor({ ...a }, "incremental");
  assert.equal(requests[1].searchParams.get("until_id"), "951");
  assert.equal(requests[1].searchParams.has("end_time"), false);
  assert.equal(requests[1].searchParams.has("start_time"), false);
  const expectedLower = ((BigInt(Date.parse(fixedStart)) - 1288834974657n) << 22n) - 1n;
  assert.equal(requests[1].searchParams.get("since_id"), expectedLower.toString());
  assert.equal(requests[0].searchParams.has("end_time"), true);
  assert.equal(a.curated_pending_search.untilId, "901");
  assert.equal(a.curated_pending_search.endTime, fixedEnd);
  queue.push(page(900, 20, false));
  await collectCuratedAuthor({ ...a }, "incremental");
  assert.equal(requests[2].searchParams.get("since_id"), expectedLower.toString());
  assert.equal(requests[2].searchParams.get("until_id"), "901");
  assert.equal(a.curated_pending_search, null);
  assert.equal(a.curated_last_post_id, "1000");
  assert.equal(a.curated_last_collected_at, fixedEnd);
  assert.equal(new Set(state.posts.map(p => p.x_post_id)).size, 120);
  console.log("PASS: 120 posts over three runs; no duplicate/missing IDs; fixed bounds; high-water cursor");

  const longAuthor = author(); reset([longAuthor]);
  const longPages = [page(1000, 50, true), page(950, 100, true), page(850, 50, true)];
  for (const response of longPages) for (const media of response.includes.media)
    media.variants = [{ content_type: "video/mp4", bit_rate: 1000,
      url: "https://video.twimg.com/" + "a".repeat(250) + media.media_key + ".mp4" }];
  const duplicateUrl = longPages[2].includes.media[49].variants[0].url;
  state.posts.push({ x_post_id: "old", video_url: duplicateUrl, video_content_hash: null });
  queue.push(...longPages);
  const longResult = await collectCuratedAuthor({ ...longAuthor }, "incremental", { incrementalPostReadLimit: 200 });
  assert.equal(longResult.saved, 199);
  assert.equal(longResult.duplicates, 1);
  assert.equal(longAuthor.curated_pending_search.untilId, "801");
  assert.ok(state.lookups.filter(x => x.column === "video_url").length > 10);
  console.log("PASS: 200 long video URLs use bounded DB lookups; cross-chunk duplicate skipped; cursor saved");

  const failing = author(); reset([failing]); state.failSnapshots = true;
  queue.push(page(500, 50, true));
  await assert.rejects(collectCuratedAuthor({ ...failing }, "incremental"), /snapshot/);
  assert.equal(failing.curated_pending_search, null);
  assert.equal(failing.curated_last_post_id, null);
  console.log("PASS: snapshot failure preserves pending and successful cursors");

  reset(); queue.push(page(500, 50, true), page(450, 10, true));
  const budget = { remaining: 60 };
  const capped = await searchRecentVideoPostBatch("from:example has:videos", 200,
    { readBudget: budget, firstPageLimit: 50 }, "curated_incremental");
  assert.equal(capped.rawPostCount, 60); assert.equal(capped.hasMore, true);
  assert.equal(budget.remaining, 0);
  assert.deepEqual(requests.map(r => r.searchParams.get("max_results")), ["50", "10"]);
  console.log("PASS: shared request budget cannot overshoot API minimum");

  reset([author("one"), author("two")]); queue.push({ status: 429 });
  const rate = await GET({ authorized: true, nextUrl: new URL("https://test/api?recovery=1&author=one,two") });
  assert.equal(requests.length, 1); assert.equal(rate.data.halted, "rate_limit");
  assert.equal(rate.data.unprocessed, 1); assert.equal(rate.status, 502);
  const unauthorized = await GET({ authorized: false });
  assert.equal(unauthorized.status, 401);
  console.log("PASS: 429 halts batch without retries; authorization remains required");

  reset([author("one"), author("two"), author("three")]);
  queue.push(page(1000, 50, true), page(950, 100, true), page(850, 50, true),
    page(700, 50, true), page(650, 100, true), page(550, 50, true));
  const recovery = await GET({ authorized: true, nextUrl: new URL("https://test/api?recovery=1&author=one,two,three") });
  assert.equal(recovery.data.reservedReads, 400);
  assert.equal(recovery.data.processed, 2);
  assert.equal(recovery.data.incomplete, 2);
  assert.equal(recovery.data.errors, 0);
  assert.equal(recovery.data.halted, "read_budget");
  console.log("PASS: recovery stops at 400 reads; unfinished work persists; error/incomplete counts differ");
  reset(); queue.push(page(500, 10, false));
  const recentId = (((BigInt(Date.now() - 1000) - 1288834974657n) << 22n) + 10n).toString();
  const upperTime = new Date(Date.now() - 500).toISOString();
  await searchRecentVideoPostBatch("from:example has:videos", 10,
    { sinceId: recentId, endTime: upperTime }, "curated_incremental");
  assert.equal(requests[0].searchParams.get("since_id"), recentId);
  assert.equal(requests[0].searchParams.get("until_id"),
    ((BigInt(Date.parse(upperTime)) - 1288834974657n) << 22n).toString());
  console.log("PASS: resume uses only ID bounds; pinned lower bound and exclusive millisecond edges preserved");
  const noTarget = await GET({ authorized: true, nextUrl: new URL("https://test/api?recovery=1") });
  assert.equal(noTarget.status, 400);
  console.log("PASS: recovery requires explicit targets; cannot re-collect all 24 authors");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
