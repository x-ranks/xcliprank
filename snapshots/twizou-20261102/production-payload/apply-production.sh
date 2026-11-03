#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
export PATH="$(dirname "$NODE"):$PATH" NEXT_TELEMETRY_DISABLED=1
PAYLOAD=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
MONITOR_PAUSE_HELD=0
MODE=${1:---check}
[[ $# -le 1 && ( "$MODE" == --check || "$MODE" == --apply ) ]] || { echo 'USAGE: bash apply-production.sh [--check|--apply]'; exit 2; }
HTACCESS="$ACCOUNT/public_html/.htaccess"
[[ -x "$NODE" && -f "$HTACCESS" && -f "$PAYLOAD/manifest.json" ]] || { echo 'EXPECTED_LAYOUT_MISSING'; exit 1; }
LIVE=$(HTACCESS="$HTACCESS" "$NODE" <<'JS'
const fs=require('fs'),p=process.env.HTACCESS,s=fs.lstatSync(p);
if(!s.isFile()||s.uid!==process.getuid())throw Error('HTACCESS_INVALID');
const roots=[...fs.readFileSync(p,'utf8').matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
if(roots.length!==1||!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/runtime$/.test(roots[0][1]))throw Error('UNEXPECTED_APP_ROOT');
console.log(roots[0][1]);
JS
)
[[ -f "$LIVE/server.js" && -f "$LIVE/.env.production" && -f "$LIVE/.next/BUILD_ID" && -f "$LIVE/DEPLOY_SOURCE" ]] || { echo 'LIVE_LAYOUT_MISSING'; exit 1; }
SOURCE=$(cat "$LIVE/DEPLOY_SOURCE")
[[ "$SOURCE" == "$ACCOUNT"/* && -d "$SOURCE/node_modules/typescript" && -f "$SOURCE/package.json" && -f "$SOURCE/.next/BUILD_ID" ]] || { echo 'LIVE_SOURCE_MISSING'; exit 1; }
LIVE_BUILD=$(cat "$LIVE/.next/BUILD_ID")
[[ "$LIVE_BUILD" == "$(cat "$SOURCE/.next/BUILD_ID")" ]] || { echo 'BUILD_SOURCE_MISMATCH'; exit 1; }
PAYLOAD="$PAYLOAD" SOURCE="$SOURCE" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const m=JSON.parse(fs.readFileSync(path.join(process.env.PAYLOAD,'manifest.json'),'utf8'));
if(m.release!=='twizou-manual-registration-v1-20261102-production-fix1'||m.expectedLiveBuildId!=='npkcjX43kUHfSMfl7eVjy'||!Array.isArray(m.files)||m.files.length!==28)throw Error('MANIFEST_INVALID');
const names=new Set();
const allowed=new Set(["app/api/manual-ranking/route.ts","app/api/public-video/route.ts","app/api/rankings/route.ts","app/manual-ranking/ManualRankingClient.tsx","lib/free-curated-publish.ts","lib/manual-ranking.ts","lib/public-video-production.ts","lib/manual-request-body.ts","lib/manual-thumbnail.ts","lib/manual-thumbnail-store.ts","lib/manual-x-candidate.ts","lib/manual-x-permissions.ts","scripts/check-canonical.cjs","scripts/test-curated-references.cjs","scripts/test-free-curated-production.cjs","scripts/test-manual-ranking-bridge.cjs","scripts/test-newest500.cjs","scripts/test-performance.cjs","scripts/test-ranking-liquidity-route.cjs","scripts/test-site-priority.cjs","scripts/test-speed-playback-v2.cjs","scripts/test-manual-request-body.cjs","scripts/test-manual-thumbnail.cjs","scripts/test-manual-thumbnail-store.cjs","scripts/test-manual-thumbnail-endpoint.cjs","scripts/test-manual-x-candidate.cjs","scripts/test-manual-x-permission.cjs","scripts/test-manual-x-registration.cjs"]);
for(const row of m.files){
  if(typeof row.path!=='string'||!allowed.has(row.path)||names.has(row.path)||!(row.baselineSha256===null||/^[a-f0-9]{64}$/.test(row.baselineSha256))||!/^([a-f0-9]{64})$/.test(row.candidateSha256))throw Error('MANIFEST_FILE_INVALID');
  names.add(row.path);
  const target=path.join(process.env.SOURCE,row.path);
  if(row.baselineSha256===null){if(fs.existsSync(target))throw Error('SOURCE_NEW_FILE_EXISTS_'+row.path);}
  else if(hash(target)!==row.baselineSha256)throw Error('SOURCE_BASELINE_CHANGED_'+row.path);
  if(hash(path.join(process.env.PAYLOAD,row.path))!==row.candidateSha256)throw Error('PAYLOAD_CORRUPT_'+row.path);
}
if(names.size!==allowed.size)throw Error('MANIFEST_FILE_MISSING');
if(hash(path.join(process.env.PAYLOAD,'check-curated-reference-schema.cjs'))!==m.tools?.schemaCheckSha256||hash(path.join(process.env.PAYLOAD,'curated-video-references.sql'))!==m.tools?.sqlSha256)throw Error('PAYLOAD_TOOL_CORRUPT');
if(hash(path.join(process.env.PAYLOAD,'rollback-production.sh'))!==m.tools?.rollbackSha256)throw Error('ROLLBACK_TOOL_CORRUPT');
if(hash(path.join(process.env.PAYLOAD,'install-ranking-prewarm.sh'))!==m.tools?.prewarmInstallerSha256)throw Error('PREWARM_INSTALLER_CORRUPT');
const expectedControl=new Set(["scripts/check-public-response-controls.cjs","scripts/public-response-cache.cjs"]),control=m.tools?.controlFiles;
if(!Array.isArray(control)||control.length!==2||new Set(control.map(row=>row.path)).size!==2)throw Error('CONTROL_TOOLS_INVALID');
for(const row of control){
  if(!expectedControl.has(row.path)||!/^[a-f0-9]{64}$/.test(row.sha256))throw Error('CONTROL_TOOL_INVALID');
  if(hash(path.join(process.env.PAYLOAD,row.path))!==(row.payloadSha256||row.sha256))throw Error('CONTROL_TOOL_PAYLOAD_CORRUPT');
  if(hash(path.join(process.env.SOURCE,row.path))!==(row.sourceSha256||row.sha256))throw Error('CONTROL_TOOL_SOURCE_CHANGED');
}
if(hash(path.join(process.env.PAYLOAD,'install-monitor-hourly.sh'))!==m.tools.monitorInstallerSha256)throw Error('MONITOR_INSTALLER_HASH_MISMATCH');
if(hash(path.join(process.env.PAYLOAD,'measure-discovery.cjs'))!==m.tools.discoveryMeasureSha256)throw Error('DISCOVERY_MEASURE_CORRUPT');
console.log('SOURCE_AND_PAYLOAD_HASHES_MATCH');
JS
[[ "$LIVE_BUILD" == "npkcjX43kUHfSMfl7eVjy" ]] || { echo "UNEXPECTED_LIVE_BUILD_ID=$LIVE_BUILD"; exit 1; }
"$NODE" "$PAYLOAD/check-curated-reference-schema.cjs" "$SOURCE"
"$NODE" "$PAYLOAD/scripts/check-public-response-controls.cjs" "$SOURCE"
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime
if [[ "$MODE" == --check ]]; then echo "PRECHECK_OK; LIVE_BUILD_ID=$LIVE_BUILD; no production changes"; exit 0; fi
LOCK="$ACCOUNT/.xclip-production-deploy.lock"
mkdir "$LOCK" 2>/dev/null || { echo 'DEPLOYMENT_BUSY'; exit 1; }
STAGE=''; BACKUP=''; ACTIVATED=0
stop_cwd(){ local root="$1" pid; for pid in $(ps -u rbxfxmfd -o pid=,comm= | awk '$2 ~ /^(next-server|node)/ {print $1}'); do [[ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" != "$root" ]] || kill -TERM "$pid" 2>/dev/null || true; done; }
cleanup(){
  rmdir "$LOCK" 2>/dev/null || true
  if [[ "$MONITOR_PAUSE_HELD" == 1 ]]; then
    flock -u 7 2>/dev/null || true
    exec 7>&-
    echo 'MONITOR_PAUSE_RELEASED; next scheduled patrol is permitted'
  fi
}
rollback(){
  trap - ERR INT TERM HUP
  if [[ "$ACTIVATED" == 1 && -d "$BACKUP" ]]; then
    if [[ -d "$LIVE" ]]; then stop_cwd "$LIVE"; mv "$LIVE" "$STAGE/failed-runtime"; fi
    mv "$BACKUP" "$LIVE"
    mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
    echo 'PREVIOUS_RUNTIME_RESTORED'
  fi
  echo 'TWIZOU_MANUAL_REGISTRATION_V1_FIX1_FAILED; inspect private staging logs; do not rerun blindly'
  exit 1
}
trap cleanup EXIT
trap rollback ERR INT TERM HUP
# Wait for the running patrol to finish; never terminate its process.
exec 7> "$ACCOUNT/.xclip-author-monitor.lock"
if ! flock -n 7; then
  echo 'WAITING_FOR_CURRENT_PATROL; no force stop; max=60m; progress every30s'
  acquired=0
  for attempt in $(seq 1 120); do
    if flock -w 30 7; then acquired=1; break; fi
    echo "WAITING_FOR_CURRENT_PATROL elapsed=$((attempt * 30))s max=3600s"
  done
  [[ "$acquired" == 1 ]] || { echo 'AVAILABILITY_WORKER_BUSY; wait limit reached; production unchanged'; rollback; }
fi
MONITOR_PAUSE_HELD=1
echo 'MONITOR_PAUSED_FOR_DEPLOYMENT; lock held through build and checks; no Cron changes'
STAGE=$(mktemp -d "$ACCOUNT/xclip-twizou-manual-registration-v1-fix1.XXXXXX")
mkdir "$STAGE/source" "$STAGE/runtime" "$STAGE/build-home"
echo "STAGING_DIRECTORY=$STAGE"
tar -C "$SOURCE" --exclude='./.next' --exclude='./.git' --exclude='./.env*' --exclude='./.local-admin' --exclude='./artifacts' --exclude='./data' --exclude='./out' --exclude='./.cache' -cf - . | tar -C "$STAGE/source" -xf -
PAYLOAD="$PAYLOAD" STAGE_SOURCE="$STAGE/source" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const m=JSON.parse(fs.readFileSync(path.join(process.env.PAYLOAD,'manifest.json'),'utf8'));
for(const row of m.files){
  const from=path.join(process.env.PAYLOAD,row.path),to=path.join(process.env.STAGE_SOURCE,row.path);
  if(row.baselineSha256===null){if(fs.existsSync(to))throw Error('STAGED_NEW_FILE_EXISTS_'+row.path);}
  else if(hash(to)!==row.baselineSha256)throw Error('STAGED_BASELINE_CHANGED_'+row.path);
  fs.mkdirSync(path.dirname(to),{recursive:true});
  fs.copyFileSync(from,to);
  if(hash(to)!==row.candidateSha256)throw Error('STAGED_COPY_FAILED_'+row.path);
}
console.log('STAGED_PAYLOAD_FILES_COPIED='+m.files.length);
JS
cp "$LIVE/.env.production" "$STAGE/source/.env.production"; chmod 600 "$STAGE/source/.env.production"
cd "$STAGE/source"
"$NODE" scripts/check-canonical.cjs test > "$STAGE/all-tests.log" 2>&1 || { echo 'CANONICAL_TESTS_FAILED'; rollback; }
"$NODE" scripts/test-label-a4.cjs > "$STAGE/label-a4-test.log" 2>&1 || { echo 'LABEL_A4_TEST_FAILED'; rollback; }
"$NODE" scripts/check-canonical.cjs types > "$STAGE/types.log" 2>&1 || { echo 'TYPES_FAILED'; rollback; }
HOME="$STAGE/build-home" USERPROFILE="$STAGE/build-home" NODE_OPTIONS="--require $STAGE/source/scripts/offline-guard.cjs" npm run build > "$STAGE/build.log" 2>&1 || { echo 'BUILD_FAILED'; rollback; }
cp -a .next/standalone/. "$STAGE/runtime/"
"$NODE" scripts/install-public-response-cache.cjs "$STAGE/runtime"
mkdir -p "$STAGE/runtime/.next" "$STAGE/runtime/public"
cp -a .next/static "$STAGE/runtime/.next/static"
[[ ! -d "$LIVE/public" ]] || cp -a "$LIVE/public/." "$STAGE/runtime/public/"
[[ ! -d public ]] || cp -a public/. "$STAGE/runtime/public/"
cp "$LIVE/.env.production" "$STAGE/runtime/.env.production"; chmod 600 "$STAGE/runtime/.env.production"
NEW_BUILD=$(cat .next/BUILD_ID)
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/DEPLOY_COMMIT"
printf '%s\n' "$STAGE/source" > "$STAGE/runtime/DEPLOY_SOURCE"
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/public/twizou-speed-v5-version.txt"
[[ "$(cat "$STAGE/runtime/.next/BUILD_ID")" == "$NEW_BUILD" ]] || { echo 'STAGED_BUILD_MISMATCH'; rollback; }
echo 'STAGED_BUILD_AND_TESTS_OK'
[[ "$(cat "$LIVE/.next/BUILD_ID")" == "$LIVE_BUILD" && "$(cat "$LIVE/DEPLOY_SOURCE")" == "$SOURCE" ]] || { echo 'LIVE_CHANGED_DURING_BUILD'; rollback; }
exec 8> "$ACCOUNT/.xclip-free-curated-collector.lock"
if ! flock -n 8; then echo 'WAITING_FOR_COLLECTOR max=60s'; flock -w 60 8 || { echo 'COLLECTOR_BUSY'; rollback; }; fi
exec 6> "$ACCOUNT/.xclip-rising-refresh.lock"
if ! flock -n 6; then echo 'WAITING_FOR_RISING_REFRESH max=60s'; flock -w 60 6 || { echo 'RISING_REFRESH_BUSY'; rollback; }; fi
BACKUP_BASE=$(mktemp -d "$ACCOUNT/xclip-before-twizou-manual-registration-v1-fix1.XXXXXX")
BACKUP="$BACKUP_BASE/runtime"
[[ "$(stat -c %d "$LIVE")" == "$(stat -c %d "$STAGE/runtime")" ]] || { echo 'FILESYSTEM_MISMATCH'; rollback; }
mv "$LIVE" "$BACKUP"
ACTIVATED=1
mv "$STAGE/runtime" "$LIVE"
mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime || rollback
stop_cwd "$BACKUP"
VERIFIED=0
for attempt in $(seq 1 20); do
  code=$(curl -sS --connect-timeout 5 --max-time 15 -o "$STAGE/version.txt" -w '%{http_code}' "https://twizou.net/twizou-speed-v5-version.txt?check=$(date +%s)-$attempt") || code=000
  if [[ "$code" == 200 ]] && cmp -s "$LIVE/DEPLOY_COMMIT" "$STAGE/version.txt"; then VERIFIED=1; break; fi
  sleep 2
done
[[ "$VERIFIED" == 1 ]] || { echo 'PUBLIC_VERSION_VERIFY_FAILED'; rollback; }
POST_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -D "$STAGE/post-headers.txt" -o "$STAGE/post.html" -w '%{http_code}' 'https://twizou.net/p/2106800501283234041') || POST_CODE=000
[[ "$POST_CODE" == 200 ]] || { echo "POST_PAGE_FAILED code=$POST_CODE"; rollback; }
RISING_CODE=$(curl -sS --connect-timeout 5 --max-time 120 -o "$STAGE/rising.html" -w '%{http_code}' 'https://twizou.net/rising') || RISING_CODE=000
[[ "$RISING_CODE" == 200 ]] || { echo "RISING_PAGE_FAILED code=$RISING_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require("fs"),p=require("path"),s=fs.readFileSync(p.join(process.env.STAGE,"rising.html"),"utf8");if(!s.includes('class="video-card"'))throw Error("RISING_CARDS_EMPTY");console.log("RISING_CARDS_VISIBLE_AFTER_RESTORE");
JS
ROOT_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/root.html" -w '%{http_code}' 'https://twizou.net/') || ROOT_CODE=000
[[ "$ROOT_CODE" == 200 ]] || { echo "ROOT_PAGE_FAILED code=$ROOT_CODE"; rollback; }
SITEMAP_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -o "$STAGE/sitemap.xml" -w '%{http_code}' 'https://twizou.net/sitemap.xml') || SITEMAP_CODE=000
[[ "$SITEMAP_CODE" == 200 ]] || { echo "SITEMAP_FAILED code=$SITEMAP_CODE"; rollback; }
for verb in GET HEAD; do
  request_flags=(); [[ "$verb" != HEAD ]] || request_flags=(-I)
  code=$(curl -sS --connect-timeout 5 --max-time 30 "${request_flags[@]}" -o /dev/null -w '%{http_code}' 'https://twizou.net/api/video?url=https%3A%2F%2Fvideo.twimg.com%2Fno-relay-smoke.mp4') || code=000
  [[ "$code" == 410 ]] || { echo "VIDEO_RELAY_STOP_CHECK_FAILED method=$verb code=$code"; rollback; }
done
code=$(curl -sS --connect-timeout 5 --max-time 30 -o /dev/null -w '%{http_code}' 'https://twizou.net/api/video?metadata=1&url=http%3A%2F%2F127.0.0.1%2Fnot-requested') || code=000
[[ "$code" == 400 ]] || { echo "METADATA_GUARD_CHECK_FAILED code=$code"; rollback; }
REMOVAL_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/removal.html" -w '%{http_code}' 'https://twizou.net/removal-request') || REMOVAL_CODE=000
[[ "$REMOVAL_CODE" == 200 ]] || { echo "REMOVAL_PAGE_FAILED code=$REMOVAL_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),root=process.env.STAGE;
const notice=fs.readFileSync(path.join(root,'removal.html'),'utf8');
if(!notice.includes('削除要請には24時間以内に対応いたします。')||!notice.includes('当サイトでは動画の収集と再アップロードは一切行っておりません。'))throw Error('REMOVAL_TEXT_FAILED');
for(const file of ['root.html','rising.html']){const html=fs.readFileSync(path.join(root,file),'utf8');for(const text of ['18歳未満の方は利用できません。','twizouでは動画の収集・アップロードは一切行っておりません。','児童ポルノ・リベンジポルノ・著作権侵害等のコンテンツは違法である為','からお知らせくださいますようご協力をお願いします。'])if(!html.includes(text))throw Error('PUBLIC_FOOTER_TEXT_FAILED');}
console.log('REMOVAL_AND_FOOTER_TEXT_CHECK_OK');
JS
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),html=fs.readFileSync(p.join(process.env.STAGE,'post.html'),'utf8');
if(!html.includes('この動画を報告する')||!html.includes('/removal-request?post=2106800501283234041'))throw Error('VIDEO_REPORT_LINK_FAILED');
console.log('VIDEO_REPORT_POST_FORM_AND_SITEMAP_CHECK_OK');
JS
ROBOTS_CODE=$(curl -sS --connect-timeout 5 --max-time 30 -o "$STAGE/robots.txt" -w '%{http_code}' 'https://twizou.net/robots.txt') || ROBOTS_CODE=000
[[ "$ROBOTS_CODE" == 200 ]] || { echo "ROBOTS_FAILED code=$ROBOTS_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),text=fs.readFileSync(p.join(process.env.STAGE,'robots.txt'),'utf8');
for(const line of ['Allow: /api/video-playback-url$','Allow: /api/video-playback-url?','Disallow: /api/','Sitemap: https://twizou.net/sitemap.xml'])if(!text.includes(line))throw Error('PUBLIC_ROBOTS_RULE_MISSING');
console.log('PUBLIC_ROBOTS_PLAYBACK_EXCEPTION_CHECK_OK');
JS
code=$(curl -sS --connect-timeout 5 --max-time 30 -o /dev/null -w '%{http_code}' 'https://twizou.net/api/video-playback-url?postId=invalid') || code=000
[[ "$code" == 400 ]] || { echo "PLAYBACK_INPUT_GUARD_FAILED code=$code"; rollback; }
echo 'CRAWL_PLAYBACK_PAGES_AND_SITEMAP_CHECK_OK'
code=$(curl -sS --connect-timeout 5 --max-time 30 -H 'Content-Type: application/json' --data '{"eventType":"__invalid__"}' -o /dev/null -w '%{http_code}' 'https://twizou.net/api/engagement') || code=000
[[ "$code" == 400 ]] || { echo "ENGAGEMENT_INPUT_GUARD_FAILED code=$code"; rollback; }
code=$(curl -sS --connect-timeout 5 --max-time 30 -o /dev/null -w '%{http_code}' 'https://twizou.net/api/engagement-stats') || code=000
[[ "$code" == 401 ]] || { echo "ENGAGEMENT_STATS_AUTH_FAILED code=$code"; rollback; }
echo 'ENGAGEMENT_COVERAGE_PAGES_AND_API_GUARDS_CHECK_OK; no analytics writes'
BROWSE_CODE=$(curl -sS --connect-timeout 5 --max-time 90 -o "$STAGE/browse.html" -w '%{http_code}' 'https://twizou.net/browse') || BROWSE_CODE=000
[[ "$BROWSE_CODE" == 200 ]] || { echo "BROWSE_PAGE_FAILED code=$BROWSE_CODE"; rollback; }
TAGS_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -o "$STAGE/tags.html" -w '%{http_code}' 'https://twizou.net/tags') || TAGS_CODE=000
[[ "$TAGS_CODE" == 200 ]] || { echo "TAGS_PAGE_FAILED code=$TAGS_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),root=process.env.STAGE;
const rising=fs.readFileSync(p.join(root,'rising.html'),'utf8'),title=(rising.match(/<title>([^<]*)<\/title>/)||[])[1];
if(title!=='急上昇のTwitter動画ランキング・保存｜twizou')throw Error('RISING_TITLE_FAILED');
const post=fs.readFileSync(p.join(root,'post.html'),'utf8');
if(!post.includes('BreadcrumbList')||!post.includes('max-image-preview:large'))throw Error('POST_PRIORITY_METADATA_FAILED');
const browse=fs.readFileSync(p.join(root,'browse.html'),'utf8');
if(!browse.includes('動画一覧')||!browse.includes('サムネイル・投稿本文・投稿者から探せる一覧'))throw Error('BROWSE_PRIORITY_PAGE_FAILED');
const tags=fs.readFileSync(p.join(root,'tags.html'),'utf8');if(!tags.includes('掲載中の動画があるタグから探せます。'))throw Error('TAG_HUB_PRIORITY_PAGE_FAILED');
console.log('SITE_PRIORITY_TITLE_BROWSE_TAGS_BREADCRUMB_CHECK_OK');
JS
echo "LABEL_A4_PUBLIC_PAGES_AND_PROTECTION_CHECK_OK"

STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),html=fs.readFileSync(p.join(process.env.STAGE,'post.html'),'utf8');
const objects=[...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap(m=>{const v=JSON.parse(m[1]);return Array.isArray(v)?v:[v];});
const video=objects.find(v=>v['@type']==='VideoObject');
if(!video||video['@id']!=='https://twizou.net/p/2106800501283234041#video'||video.mainEntityOfPage!=='https://twizou.net/p/2106800501283234041'||!video.contentUrl.startsWith('https://video.twimg.com/')||'embedUrl'in video||'interactionStatistic'in video)throw Error('VIDEO_SCHEMA_FAILED');
if(video.duration&&!/^PT[0-9.]+S$/.test(video.duration))throw Error('VIDEO_DURATION_SCHEMA_FAILED');
const source=fs.readFileSync(p.join(process.env.STAGE,'source/scripts/scan-author-status.cjs'),'utf8'),scan=fs.readFileSync(p.join(process.env.STAGE,'source/lib/availability-scan.ts'),'utf8');
if(!source.includes('monitorPriority:groups.get(id)')||!scan.includes('priority_daily_checked')||!scan.includes('await check(post, "priority")'))throw Error('MONITOR_BREAKDOWN_SOURCE_FAILED');
console.log('VIDEO_SCHEMA_AND_MONITOR_BREAKDOWN_CHECK_OK; no media requests or patrol triggered');
JS
code=$(curl -sS --connect-timeout 5 --max-time 30 -H 'Content-Type: application/json' --data '{"action":"technical-page","cursor":null,"upper":null}' -o /dev/null -w '%{http_code}' 'https://twizou.net/api/public-label-admin') || code=000
[[ "$code" == 401 ]] || { echo "TECHNICAL_ADMIN_AUTH_FAILED code=$code"; rollback; }


STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),root=p.join(process.env.STAGE,'source');
const scan=fs.readFileSync(p.join(root,'lib/fx-curated-scan.ts'),'utf8'),publish=fs.readFileSync(p.join(root,'lib/free-curated-publish.ts'),'utf8'),backend=fs.readFileSync(p.join(root,'lib/public-video-production.ts'),'utf8');
if(!scan.includes('undefined,100,true,true)')||!scan.includes('publishFreeReferencedPosts')||!publish.includes('reference||options.manualPost?{is_curated:false}')||!backend.includes('referencePermitsPost'))throw Error('CURATED_REFERENCE_INTEGRATION_FAILED');
console.log('CURATED_REFERENCE_ATTRIBUTION_AND_PUBLIC_PATHS_CHECK_OK; no patrol or media requests');
JS
"$NODE" "$PAYLOAD/check-curated-reference-schema.cjs" "$STAGE/source"


STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),root=p.join(process.env.STAGE,'source'),read=f=>fs.readFileSync(p.join(root,f),'utf8');
const page=read('app/p/[id]/page.tsx'),server=read('lib/public-video-server.ts'),reels=read('app/reels/ReelsFeed.tsx'),rising=read('app/rising/page.tsx');
for(const needle of ['readPublicDetailCore','<PostTags detail={d}','<PostRelated id={v.id}','<Suspense'])if(!page.includes(needle))throw Error('DETAIL_STREAMING_SOURCE_FAILED');
if(!server.includes('readOnlyRender: true')||!reels.includes('reelLoadPolicy')||!rising.includes('deferRefresh: after')||fs.existsSync(p.join(root,'app/loading.tsx')))throw Error('PERFORMANCE_INTEGRATION_FAILED');
const html=fs.readFileSync(p.join(process.env.STAGE,'post.html'),'utf8');if(!html.includes('public-post-player')||!html.includes('VideoObject')||!html.includes('この動画を報告する'))throw Error('PERFORMANCE_PUBLIC_DETAIL_FAILED');
console.log('PERFORMANCE_STREAMING_MEDIA_AND_VISIBILITY_CHECK_OK; no media requests');
JS


for kind in account tag; do
  HUB_PATH=$(STAGE="$STAGE" HUB_KIND="$kind" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),s=fs.readFileSync(p.join(process.env.STAGE,'sitemap.xml'),'utf8'),segment=process.env.HUB_KIND==='account'?'accounts':'tags';
const match=s.match(new RegExp('<loc>https://twizou[.]net/('+segment+'/[^<"?]+)</loc>'));if(match)console.log('/'+match[1]);
JS
)
  if [[ -n "$HUB_PATH" ]]; then
    code=$(curl -sS --connect-timeout 5 --max-time 120 -o "$STAGE/$kind.html" -w '%{http_code}' "https://twizou.net$HUB_PATH") || code=000
    [[ "$code" == 200 ]] || { echo "FACTUAL_HUB_FAILED kind=$kind code=$code"; rollback; }
  fi
done
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),root=process.env.STAGE,read=f=>fs.readFileSync(p.join(root,f),'utf8');
const html=read('post.html'),body=html.replace(/<script[\s\S]*?<\/script>/g,'');
if(!body.includes('public-post-player')||!html.includes('VideoObject')||html.includes('この動画のタグは'))throw Error('FACTUAL_DETAIL_FAILED');
if(!read('root.html').includes('Twitter動画ランキング・保存｜新着・24時間・週間｜twizou'))throw Error('FACTUAL_ROOT_TITLE_FAILED');
for(const kind of ['account','tag']){const file=p.join(root,kind+'.html');if(fs.existsSync(file)&&!fs.readFileSync(file,'utf8').includes('のTwitter動画一覧・保存'))throw Error('FACTUAL_HUB_TITLE_FAILED');}
const source=fs.readFileSync(p.join(root,'source/lib/share-video.ts'),'utf8');if(!source.includes('集計・日本時間')||source.includes('twizouで見つけた動画'))throw Error('FACTUAL_SHARE_FAILED');
console.log('FACTUAL_SEO_DETAIL_TITLES_HUBS_AND_SHARE_CHECK_OK; no media requests');
JS


for range in daily weekly; do
  code=$(curl -sS --connect-timeout 5 --max-time 90 -o "$STAGE/$range-share.html" -w '%{http_code}' "https://twizou.net/ranking/$range") || code=000
  [[ "$code" == 200 ]] || { echo "SHARE_CONTEXT_PAGE_FAILED range=$range code=$code"; rollback; }
done
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path');
for(const file of ['root.html','rising.html','daily-share.html','weekly-share.html','browse.html','account.html','tag.html']){
 const path=p.join(process.env.STAGE,file);if(!fs.existsSync(path))continue;
 const body=fs.readFileSync(path,'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
 if(body.includes('Xで共有'))throw Error('LIST_SHARE_BUTTON_REMAINS_'+file);
}
const post=fs.readFileSync(p.join(process.env.STAGE,'post.html'),'utf8').replace(/<script[\s\S]*?<\/script>/g,'');
if((post.match(/>Xで共有<\/a>/g)||[]).length!==1)throw Error('DETAIL_SHARE_ACTION_MISSING');
console.log('SPEED_PLAYBACK_LIST_BUTTONS_AND_DETAIL_ACTIONS_CHECK_OK; no media requests');
JS


STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),root=process.env.STAGE,read=f=>fs.readFileSync(p.join(root,f),'utf8');
const post=read('post.html').replace(/<script[\s\S]*?<\/script>/g,''),video=(post.match(/<video\b[^>]*>/)||[])[0];
if(!video||!video.includes('src="https://video.twimg.com/')||/crossorigin=/i.test(video))throw Error('GSC_NATIVE_VIDEO_SOURCE_FAILED');
if(post.indexOf('public-post-player')>post.indexOf('public-post-actions'))throw Error('GSC_MAIN_VIDEO_POSITION_FAILED');
for(const file of ['root.html','rising.html','daily-share.html','weekly-share.html','browse.html','account.html','tag.html']){
 if(!fs.existsSync(p.join(root,file)))continue;
 const html=read(file).replace(/<script[\s\S]*?<\/script>/g,''),links=[...html.matchAll(/href="(\/p\/[1-9][0-9]{1,24}[^"]*)"/g)].map(m=>m[1]);
 if(links.some(x=>x.includes('?')))throw Error('GSC_VARIANT_DETAIL_LINK_FAILED_'+file);
}
console.log('GSC_CLEAN_LINKS_AND_NATIVE_VIDEO_SOURCE_CHECK_OK; no media requests');
JS


STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),root=process.env.STAGE,html=fs.readFileSync(p.join(root,'post.html'),'utf8'),headers=fs.readFileSync(p.join(root,'post-headers.txt'),'utf8');
if(!/referrer-policy: *same-origin/i.test(headers)||!html.includes('<meta name="referrer" content="same-origin"'))throw Error('PUBLIC_MEDIA_REFERRER_POLICY_FAILED');
console.log('PUBLIC_MEDIA_REFERRER_POLICY_CHECK_OK; no media requests');
JS


SPEED_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -D "$STAGE/speed-api-headers.txt" -o "$STAGE/speed-api.json" -w '%{http_code}' 'https://twizou.net/api/rankings?range=trending&page=1') || SPEED_CODE=000
[[ "$SPEED_CODE" == 200 ]] || { echo "SPEED_API_FAILED code=$SPEED_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),dir=process.env.STAGE,body=JSON.parse(fs.readFileSync(p.join(dir,'speed-api.json'))),headers=fs.readFileSync(p.join(dir,'speed-api-headers.txt'),'utf8'),root=fs.readFileSync(p.join(dir,'root.html'),'utf8');
if(body.ok!==true||!Array.isArray(body.data)||body.data.length>50||body.pagination?.page!==1||!Number.isInteger(body.totalCount))throw Error('SPEED_PAGED_CONTRACT_FAILED');
if(!/server-timing:[^\r\n]*history;dur=/i.test(headers)||!/ranking;dur=/.test(headers)||!/cache-control: *no-store/i.test(headers))throw Error('SPEED_TIMING_OR_PRIVATE_CACHE_FAILED');
if(!root.includes('xcliprank_age_confirmed_v1')||!root.includes('data-age-confirmed')||!root.includes('18歳以上ですか？'))throw Error('AGE_BOOTSTRAP_OR_GATE_FAILED');
console.log('SPEED_V5_FRESH_PERMISSIONS_PAGING_AND_AGE_BOOTSTRAP_CHECK_OK; no media requests');
JS


CACHE_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -D "$STAGE/cache-headers.txt" -o "$STAGE/cache-body.json" -w '%{http_code}' 'https://twizou.net/api/rankings?range=trending&page=1') || CACHE_CODE=000
[[ "$CACHE_CODE" == 200 ]] || { echo "CACHE_API_FAILED code=$CACHE_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),d=process.env.STAGE,h=fs.readFileSync(p.join(d,'cache-headers.txt'),'utf8'),body=JSON.parse(fs.readFileSync(p.join(d,'cache-body.json')));
const state=(h.match(/x-twizou-ranking-cache: *([A-Z]+)/i)||[])[1];if(!['HIT','MISS','SHARED'].includes(state)||body.ok!==true||!Array.isArray(body.data)||body.data.length>50)throw Error('RANKING_DATA_CACHE_CONTRACT_FAILED');
console.log('SPEED_V5_PUBLIC_DATA_CACHE_CHECK_OK state='+state+'; cache is per worker; no media requests');
JS


HTML_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -D "$STAGE/html-cache-headers.txt" -o "$STAGE/html-cache-body.html" -w '%{http_code}' 'https://twizou.net/') || HTML_CODE=000
[[ "$HTML_CODE" == 200 ]] || { echo "HTML_CACHE_PAGE_FAILED code=$HTML_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),d=process.env.STAGE,h=fs.readFileSync(p.join(d,'html-cache-headers.txt'),'utf8');
if(!/x-twizou-html-cache: *(?:HIT|MISS)/i.test(h)||!/cache-control: *private, max-age=300, must-revalidate/i.test(h))throw Error('PUBLIC_HTML_CACHE_HEADERS_FAILED');
console.log('SPEED_V5_HTML_REVALIDATION_CACHE_CHECK_OK; private validation; no media requests');
JS

CORE_CODE=$(curl -sS --connect-timeout 5 --max-time 20 -o "$STAGE/detail-core.json" -w '%{http_code}' 'https://twizou.net/api/public-video?type=detail-core&value=2106800501283234041') || CORE_CODE=000
[[ "$CORE_CODE" == 200 ]] || { echo "DETAIL_CORE_FAILED code=$CORE_CODE"; rollback; }
STAGE="$STAGE" SOURCE="$STAGE/source" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),value=JSON.parse(fs.readFileSync(p.join(process.env.STAGE,'detail-core.json'),'utf8')),manifest=fs.readFileSync(p.join(process.env.SOURCE,'.next/server/app/page_client-reference-manifest.js'),'utf8');
if(value.ok!==true||value.data?.video?.id!=='2106800501283234041'||value.data.video.eligible!==true)throw Error('FRESH_DETAIL_CORE_FAILED');
if(!manifest.includes('PublicDetailViewer.tsx'))throw Error('DETAIL_VIEWER_BUILD_MISSING');
console.log('DETAIL_FAST_VIEWER_BUILD_AND_FRESH_CORE_CHECK_OK; no media requests');
JS
DISCOVERY_CODE=$(curl -sS --connect-timeout 5 --max-time 120 -o "$STAGE/discovery.json" -w '%{http_code}' 'https://twizou.net/api/discovery?mode=random&seed=42') || DISCOVERY_CODE=000
[[ "$DISCOVERY_CODE" == 200 ]] || { echo "DISCOVERY_API_FAILED code=$DISCOVERY_CODE"; rollback; }
TIER_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -o "$STAGE/discovery-tier.json" -w '%{http_code}' 'https://twizou.net/api/discovery?mode=tier&tier=S') || TIER_CODE=000
[[ "$TIER_CODE" == 200 ]] || { echo "DISCOVERY_TIER_FAILED code=$TIER_CODE"; rollback; }
TIER_PLUS_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -o "$STAGE/discovery-tier-plus.json" -w '%{http_code}' 'https://twizou.net/api/discovery?mode=tier&tier=A%2B') || TIER_PLUS_CODE=000
[[ "$TIER_PLUS_CODE" == 200 ]] || { echo "DISCOVERY_TIER_PLUS_FAILED code=$TIER_PLUS_CODE"; rollback; }
MONTHS_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -o "$STAGE/discovery-months.json" -w '%{http_code}' 'https://twizou.net/api/discovery?mode=months') || MONTHS_CODE=000
[[ "$MONTHS_CODE" == 200 ]] || { echo "DISCOVERY_MONTHS_FAILED code=$MONTHS_CODE"; rollback; }
for page in discover favorites; do
  code=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/$page.html" -w '%{http_code}' "https://twizou.net/$page") || code=000
  [[ "$code" == 200 ]] || { echo "DISCOVERY_PAGE_FAILED page=$page code=$code"; rollback; }
done
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),d=process.env.STAGE;
for(const file of ['discovery.json','discovery-tier.json','discovery-tier-plus.json','discovery-months.json']){const x=JSON.parse(fs.readFileSync(p.join(d,file),'utf8'));if(x.ok!==true||!Array.isArray(x.data?.videos)||!Array.isArray(x.data?.months)||x.data.videos.length>50||x.data.videos.some(v=>'videoUrl'in v||'sourceHash'in v))throw Error('DISCOVERY_CONTRACT_FAILED');}
for(const [file,word] of [['discover.html','動画を探す'],['favorites.html','お気に入り・保存履歴']])if(!fs.readFileSync(p.join(d,file),'utf8').includes(word))throw Error('DISCOVERY_PAGE_CONTENT_FAILED');
console.log('DISCOVERY_PAGES_AND_BOUNDED_API_CHECK_OK; no media requests');
JS
GUIDE_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/save-guide.html" -w '%{http_code}' 'https://twizou.net/download') || GUIDE_CODE=000
[[ "$GUIDE_CODE" == 200 ]] || { echo "SAVE_GUIDE_PAGE_FAILED code=$GUIDE_CODE"; rollback; }
STAGE="$STAGE" "$NODE" -e 'const f=require("fs"),p=require("path"),s=f.readFileSync(p.join(process.env.STAGE,"save-guide.html"),"utf8");for(const id of ["save-guide","save-iphone","save-android","save-trouble"])if(!s.includes("id=\""+id+"\""))throw Error("SAVE_GUIDE_CONTENT_MISSING");console.log("SAVE_GUIDE_PUBLIC_CONTENT_CHECK_OK; no media requests")'
for path in ranking/daily ranking/weekly tags; do
  META_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/meta-${path//\//-}.html" -w '%{http_code}' "https://twizou.net/$path") || META_CODE=000
  [[ "$META_CODE" == 200 ]] || { echo "SEO_META_PAGE_FAILED $path code=$META_CODE"; rollback; }
  FILE="$STAGE/meta-${path//\//-}.html" "$NODE" -e 'const s=require("fs").readFileSync(process.env.FILE,"utf8");for(const name of ["og:image","twitter:image"])if(!new RegExp("<meta[^>]+(?:property|name)=\""+name+"\"[^>]+content=\"[^\"]*twizou-share[.]png").test(s))throw Error("SEO_IMAGE_MISSING_"+name)' || { echo "SEO_META_IMAGE_FAILED $path"; rollback; }
done
echo "SEO_METADATA_SHARE_IMAGE_CHECK_OK; no media requests"
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),s=fs.readFileSync(p.join(process.env.STAGE,'sitemap.xml'),'utf8');let count=0;for(const m of s.matchAll(/<url>([\s\S]*?)<\/url>/g)){if(/<loc>https:\/\/twizou[.]net\/(?:p|accounts)\//.test(m[1])){count++;if(/<lastmod>/.test(m[1]))throw Error('UNRELIABLE_SITEMAP_LASTMOD');}}if(!count)throw Error('SITEMAP_PUBLIC_ENTRIES_MISSING');console.log('SITEMAP_ACCURACY_CHECK_OK; no media requests');
JS
MANUAL_IMAGE_CODE=$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null -w '%{http_code}' 'https://twizou.net/api/public-video?type=manual-thumbnail&value=invalid') || MANUAL_IMAGE_CODE=000
[[ "$MANUAL_IMAGE_CODE" == 404 ]] || { echo "MANUAL_IMAGE_GUARD_FAILED code=$MANUAL_IMAGE_CODE"; rollback; }
MANUAL_AUTH_CODE=$(curl -sS --connect-timeout 5 --max-time 20 -X POST -H 'Content-Type: application/json' -d '{}' -o /dev/null -w '%{http_code}' 'https://twizou.net/api/engagement?type=placement') || MANUAL_AUTH_CODE=000
[[ "$MANUAL_AUTH_CODE" == 401 ]] || { echo "MANUAL_AUTH_GUARD_FAILED code=$MANUAL_AUTH_CODE"; rollback; }
echo 'MANUAL_REGISTRATION_SECURITY_GUARDS_CHECK_OK; no data writes or media requests'
echo "PREVIOUS_RUNTIME_BACKUP=$BACKUP_BASE"
echo "NEW_BUILD_ID=$NEW_BUILD"
echo 'TWIZOU_MANUAL_REGISTRATION_V1_FIX1_DEPLOYMENT_COMPLETE'
echo 'CRONTAB_AND_MONITOR_WRAPPERS=UNCHANGED; rising refresh runner unchanged'
