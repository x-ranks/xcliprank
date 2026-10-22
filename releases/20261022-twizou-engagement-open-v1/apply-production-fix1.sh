#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
export PATH="$(dirname "$NODE"):$PATH"
export NEXT_TELEMETRY_DISABLED=1
PAYLOAD=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
MODE=${1:---check}
[[ $# -le 1 && ( "$MODE" == --check || "$MODE" == --apply ) ]] || { echo 'USAGE: bash apply-production.sh [--check|--apply]'; exit 2; }
HTACCESS="$ACCOUNT/public_html/.htaccess"
PAGE='app/p/[id]/page.tsx'
COMPONENT='app/components/PublicPostEngagement.tsx'
TESTFILE='scripts/test-public-pages.cjs'
BEFORE_PAGE='56bf8d6bcfee74cc9001d08abb690df1e23456f90b1076bc0df16c4b3cfbc2ff'
AFTER_PAGE='6959ae0549f518e70939b2a15006d578398722904d289fd5af2407bb245ef373'
AFTER_COMPONENT='f91606b2340fcd975bf3b0c05ba18d849da992462c67ef114b011493afdb6b54'
BEFORE_TEST='1952c35ef40527dd1cb27023b068df5e4c5f3ec6f5a22061b54efb49d166527a'
AFTER_TEST='9b141424409343e63210940e63cc88ea649e27771864fd39b5a8b7bc58ac8a14'
EXPECTED_BUILD='Fx2tcddxuDKSsQFoBPRt6'
[[ -x "$NODE" && -f "$HTACCESS" && -f "$PAYLOAD/$PAGE" && -f "$PAYLOAD/$COMPONENT" && -f "$PAYLOAD/$TESTFILE" && -f "$PAYLOAD/test-engagement-open.cjs" ]] || { echo 'EXPECTED_LAYOUT_MISSING'; exit 1; }
[[ "$(sha256sum "$PAYLOAD/$PAGE" | awk '{print $1}')" == "$AFTER_PAGE" && "$(sha256sum "$PAYLOAD/$COMPONENT" | awk '{print $1}')" == "$AFTER_COMPONENT" && "$(sha256sum "$PAYLOAD/$TESTFILE" | awk '{print $1}')" == "$AFTER_TEST" ]] || { echo 'PAYLOAD_HASH_MISMATCH'; exit 1; }
LIVE=$(HTACCESS="$HTACCESS" "$NODE" <<'JS'
const fs=require('fs');const p=process.env.HTACCESS,s=fs.lstatSync(p);if(!s.isFile()||s.uid!==process.getuid())throw Error('HTACCESS_INVALID');const roots=[...fs.readFileSync(p,'utf8').matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];if(roots.length!==1||!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/runtime$/.test(roots[0][1]))throw Error('UNEXPECTED_APP_ROOT');console.log(roots[0][1]);
JS
)
[[ -f "$LIVE/server.js" && -f "$LIVE/.env.production" && -f "$LIVE/.next/BUILD_ID" && -f "$LIVE/DEPLOY_SOURCE" ]] || { echo 'LIVE_LAYOUT_MISSING'; exit 1; }
SOURCE=$(cat "$LIVE/DEPLOY_SOURCE")
[[ "$SOURCE" == "$ACCOUNT"/* && -d "$SOURCE/node_modules/typescript" && -f "$SOURCE/package.json" && -f "$SOURCE/.next/BUILD_ID" ]] || { echo 'LIVE_SOURCE_MISSING'; exit 1; }
LIVE_BUILD=$(cat "$LIVE/.next/BUILD_ID")
[[ "$LIVE_BUILD" == "$EXPECTED_BUILD" && "$LIVE_BUILD" == "$(cat "$SOURCE/.next/BUILD_ID")" ]] || { echo 'LIVE_BUILD_CHANGED; no changes'; exit 1; }
[[ "$(sha256sum "$SOURCE/$PAGE" | awk '{print $1}')" == "$BEFORE_PAGE" && "$(sha256sum "$SOURCE/$TESTFILE" | awk '{print $1}')" == "$BEFORE_TEST" && ! -e "$SOURCE/$COMPONENT" ]] || { echo 'SOURCE_BASELINE_CHANGED; no changes'; exit 1; }
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime
XCLIP_PROJECT_ROOT="$SOURCE" "$NODE" "$PAYLOAD/test-engagement-open.cjs"
echo 'CURRENT_SOURCE_AND_OPEN_TRACKING_PAYLOAD_HASHES_MATCH'
if [[ "$MODE" == --check ]]; then echo "PRECHECK_OK; LIVE_BUILD_ID=$LIVE_BUILD; no production changes"; exit 0; fi
LOCK="$ACCOUNT/.xclip-production-deploy.lock"
mkdir "$LOCK" 2>/dev/null || { echo 'DEPLOYMENT_BUSY'; exit 1; }
STAGE=''; BACKUP=''; ACTIVATED=0
stop_cwd(){ local root="$1" pid; for pid in $(ps -u rbxfxmfd -o pid=,comm= | awk '$2 ~ /^(next-server|node)/ {print $1}'); do [[ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" != "$root" ]] || kill -TERM "$pid" 2>/dev/null || true; done; }
cleanup(){ rmdir "$LOCK" 2>/dev/null || true; }
rollback(){
 trap - ERR INT TERM
 if [[ "$ACTIVATED" == 1 && -d "$BACKUP" ]]; then
  if [[ -d "$LIVE" ]]; then stop_cwd "$LIVE"; mv "$LIVE" "$STAGE/failed-runtime"; fi
  mv "$BACKUP" "$LIVE"
  mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
  echo 'PREVIOUS_RUNTIME_RESTORED'
 fi
 echo 'TWIZOU_ENGAGEMENT_OPEN_V1_FAILED; inspect private staging log, do not rerun blindly'
 exit 1
}
trap cleanup EXIT
trap rollback ERR INT TERM
STAGE=$(mktemp -d "$ACCOUNT/xclip-twizou-engagement-open-v1.XXXXXX")
mkdir "$STAGE/source" "$STAGE/runtime" "$STAGE/build-home"
echo "STAGING_DIRECTORY=$STAGE"
tar -C "$SOURCE" --exclude='./.next' --exclude='./.git' --exclude='./.env*' --exclude='./.local-admin' --exclude='./artifacts' --exclude='./data' --exclude='./out' --exclude='./.cache' -cf - . | tar -C "$STAGE/source" -xf -
[[ "$(sha256sum "$STAGE/source/$PAGE" | awk '{print $1}')" == "$BEFORE_PAGE" && "$(sha256sum "$STAGE/source/$TESTFILE" | awk '{print $1}')" == "$BEFORE_TEST" && ! -e "$STAGE/source/$COMPONENT" ]] || { echo 'STAGED_BASELINE_CHANGED'; rollback; }
cp "$PAYLOAD/$PAGE" "$STAGE/source/$PAGE"
cp "$PAYLOAD/$COMPONENT" "$STAGE/source/$COMPONENT"
cp "$PAYLOAD/$TESTFILE" "$STAGE/source/$TESTFILE"
[[ "$(sha256sum "$STAGE/source/$PAGE" | awk '{print $1}')" == "$AFTER_PAGE" && "$(sha256sum "$STAGE/source/$COMPONENT" | awk '{print $1}')" == "$AFTER_COMPONENT" && "$(sha256sum "$STAGE/source/$TESTFILE" | awk '{print $1}')" == "$AFTER_TEST" ]] || { echo 'STAGED_PAYLOAD_HASH_MISMATCH'; rollback; }
cp "$LIVE/.env.production" "$STAGE/source/.env.production"; chmod 600 "$STAGE/source/.env.production"
cd "$STAGE/source"
XCLIP_PROJECT_ROOT="$STAGE/source" "$NODE" "$PAYLOAD/test-engagement-open.cjs" > "$STAGE/open-tracking-test.log" 2>&1 || { echo 'OPEN_TRACKING_TEST_FAILED'; rollback; }
"$NODE" scripts/check-canonical.cjs test > "$STAGE/all-tests.log" 2>&1 || { echo 'CANONICAL_TESTS_FAILED'; rollback; }
"$NODE" scripts/check-canonical.cjs types > "$STAGE/types.log" 2>&1 || { echo 'TYPES_FAILED'; rollback; }
HOME="$STAGE/build-home" USERPROFILE="$STAGE/build-home" NODE_OPTIONS="--require $STAGE/source/scripts/offline-guard.cjs" npm run build > "$STAGE/build.log" 2>&1 || { echo 'BUILD_FAILED'; rollback; }
cp -a .next/standalone/. "$STAGE/runtime/"
mkdir -p "$STAGE/runtime/.next" "$STAGE/runtime/public"
cp -a .next/static "$STAGE/runtime/.next/static"
[[ ! -d "$LIVE/public" ]] || cp -a "$LIVE/public/." "$STAGE/runtime/public/"
[[ ! -d public ]] || cp -a public/. "$STAGE/runtime/public/"
cp "$LIVE/.env.production" "$STAGE/runtime/.env.production"; chmod 600 "$STAGE/runtime/.env.production"
NEW_BUILD=$(cat .next/BUILD_ID)
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/DEPLOY_COMMIT"
printf '%s\n' "$STAGE/source" > "$STAGE/runtime/DEPLOY_SOURCE"
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/public/twizou-engagement-open-v1-version.txt"
[[ "$(cat "$STAGE/runtime/.next/BUILD_ID")" == "$NEW_BUILD" ]] || { echo 'STAGED_BUILD_MISMATCH'; rollback; }
echo 'STAGED_BUILD_AND_TESTS_OK'
[[ "$(cat "$LIVE/.next/BUILD_ID")" == "$LIVE_BUILD" && "$(cat "$LIVE/DEPLOY_SOURCE")" == "$SOURCE" ]] || { echo 'LIVE_CHANGED_DURING_BUILD'; rollback; }
exec 7> "$ACCOUNT/.xclip-author-monitor.lock"
flock -n 7 || { echo 'AVAILABILITY_WORKER_BUSY'; rollback; }
exec 8> "$ACCOUNT/.xclip-free-curated-collector.lock"
flock -n 8 || { echo 'COLLECTOR_BUSY'; rollback; }
BACKUP_BASE=$(mktemp -d "$ACCOUNT/xclip-before-twizou-engagement-open-v1.XXXXXX")
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
 code=$(curl -sS --connect-timeout 5 --max-time 15 -o "$STAGE/version.txt" -w '%{http_code}' "https://twizou.net/twizou-engagement-open-v1-version.txt?check=$(date +%s)-$attempt") || code=000
 if [[ "$code" == 200 ]] && cmp -s "$LIVE/DEPLOY_COMMIT" "$STAGE/version.txt"; then VERIFIED=1; break; fi
 sleep 2
done
[[ "$VERIFIED" == 1 ]] || { echo 'PUBLIC_VERSION_VERIFY_FAILED'; rollback; }
SITEMAP_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/sitemap.xml" -w '%{http_code}' 'https://twizou.net/sitemap.xml') || SITEMAP_CODE=000
[[ "$SITEMAP_CODE" == 200 ]] || { echo 'SITEMAP_HTTP_FAILED'; rollback; }
FIRST_POST=$(SITEMAP="$STAGE/sitemap.xml" "$NODE" <<'JS'
const fs=require('fs');const xml=fs.readFileSync(process.env.SITEMAP,'utf8');const posts=[...xml.matchAll(/https:\/\/twizou[.]net\/p\/([0-9]{2,25})/g)];if(posts.length<5)throw Error('SITEMAP_TOO_SMALL');console.error('SITEMAP_CHECK_OK posts='+posts.length);console.log(posts[0][1]);
JS
)
POST_CODE=$(curl -sS --connect-timeout 5 --max-time 30 -o "$STAGE/post.html" -w '%{http_code}' "https://twizou.net/p/$FIRST_POST?from=%2F") || POST_CODE=000
[[ "$POST_CODE" == 200 ]] || { echo 'POST_HTTP_FAILED'; rollback; }
POST="$STAGE/post.html" "$NODE" <<'JS'
const fs=require('fs');const s=fs.readFileSync(process.env.POST,'utf8');if(!s.includes('public-post-player')||!s.includes('動画を保存'))throw Error('POST_PAGE_FAILED');console.log('POST_PAGE_CHECK_OK');
JS
OLD_CODE=$(curl -sS --connect-timeout 5 --max-time 20 -o /dev/null -w '%{http_code}' 'https://xcliprank.com/p/99') || OLD_CODE=000
[[ "$OLD_CODE" == 301 ]] || { echo "OLD_DOMAIN_REDIRECT_FAILED code=$OLD_CODE"; rollback; }
API_CODE=$(curl -sS --connect-timeout 5 --max-time 20 -X POST -H 'Content-Type: application/json' -H 'Origin: https://twizou.net' --data '{}' -o "$STAGE/invalid-event.json" -w '%{http_code}' 'https://twizou.net/api/engagement') || API_CODE=000
[[ "$API_CODE" == 400 ]] || { echo "ENGAGEMENT_API_SMOKE_FAILED code=$API_CODE"; rollback; }
echo 'ENGAGEMENT_API_SMOKE_OK; invalid event rejected; no analytics write'
flock -u 8; flock -u 7
trap - ERR INT TERM
echo "PREVIOUS_RUNTIME_BACKUP=$BACKUP_BASE"
echo "NEW_BUILD_ID=$NEW_BUILD"
echo 'TWIZOU_ENGAGEMENT_OPEN_V1_FIX1_DEPLOYMENT_COMPLETE'

