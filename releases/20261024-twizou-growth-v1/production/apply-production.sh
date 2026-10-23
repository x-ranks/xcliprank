#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
export PATH="$(dirname "$NODE"):$PATH" NEXT_TELEMETRY_DISABLED=1
PAYLOAD=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
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
if(m.release!=='twizou-growth-v1-20261024-production'||!Array.isArray(m.files)||m.files.length!==4)throw Error('MANIFEST_INVALID');
const names=new Set();
for(const row of m.files){
  if(typeof row.path!=='string'||!/^(?:lib\/public-video-core\.ts|app\/p\/\[id\]\/page\.tsx|app\/components\/PublicVideoCards\.tsx|scripts\/test-public-pages\.cjs)$/.test(row.path)||row.path.includes('..')||names.has(row.path)||!/^([a-f0-9]{64})$/.test(row.baselineSha256)||!/^([a-f0-9]{64})$/.test(row.candidateSha256))throw Error('MANIFEST_FILE_INVALID');
  names.add(row.path);
  if(hash(path.join(process.env.SOURCE,row.path))!==row.baselineSha256)throw Error('SOURCE_BASELINE_CHANGED_'+row.path);
  if(hash(path.join(process.env.PAYLOAD,row.path))!==row.candidateSha256)throw Error('PAYLOAD_CORRUPT_'+row.path);
}
console.log('SOURCE_AND_PAYLOAD_HASHES_MATCH');
JS
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime
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
  echo 'TWIZOU_GROWTH_V1_FAILED; inspect private staging logs; do not rerun blindly'
  exit 1
}
trap cleanup EXIT
trap rollback ERR INT TERM
STAGE=$(mktemp -d "$ACCOUNT/xclip-twizou-growth-v1.XXXXXX")
mkdir "$STAGE/source" "$STAGE/runtime" "$STAGE/build-home"
echo "STAGING_DIRECTORY=$STAGE"
tar -C "$SOURCE" --exclude='./.next' --exclude='./.git' --exclude='./.env*' --exclude='./.local-admin' --exclude='./artifacts' --exclude='./data' --exclude='./out' --exclude='./.cache' -cf - . | tar -C "$STAGE/source" -xf -
PAYLOAD="$PAYLOAD" STAGE_SOURCE="$STAGE/source" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const m=JSON.parse(fs.readFileSync(path.join(process.env.PAYLOAD,'manifest.json'),'utf8'));
for(const row of m.files){
  const from=path.join(process.env.PAYLOAD,row.path),to=path.join(process.env.STAGE_SOURCE,row.path);
  if(hash(to)!==row.baselineSha256)throw Error('STAGED_BASELINE_CHANGED_'+row.path);
  fs.copyFileSync(from,to);
  if(hash(to)!==row.candidateSha256)throw Error('STAGED_COPY_FAILED_'+row.path);
}
console.log('STAGED_PAYLOAD_FILES_COPIED='+m.files.length);
JS
cp "$LIVE/.env.production" "$STAGE/source/.env.production"; chmod 600 "$STAGE/source/.env.production"
cd "$STAGE/source"
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
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/public/twizou-growth-v1-version.txt"
[[ "$(cat "$STAGE/runtime/.next/BUILD_ID")" == "$NEW_BUILD" ]] || { echo 'STAGED_BUILD_MISMATCH'; rollback; }
echo 'STAGED_BUILD_AND_TESTS_OK'
[[ "$(cat "$LIVE/.next/BUILD_ID")" == "$LIVE_BUILD" && "$(cat "$LIVE/DEPLOY_SOURCE")" == "$SOURCE" ]] || { echo 'LIVE_CHANGED_DURING_BUILD'; rollback; }
exec 7> "$ACCOUNT/.xclip-author-monitor.lock"
flock -n 7 || { echo 'AVAILABILITY_WORKER_BUSY'; rollback; }
exec 8> "$ACCOUNT/.xclip-free-curated-collector.lock"
flock -n 8 || { echo 'COLLECTOR_BUSY'; rollback; }
BACKUP_BASE=$(mktemp -d "$ACCOUNT/xclip-before-twizou-growth-v1.XXXXXX")
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
  code=$(curl -sS --connect-timeout 5 --max-time 15 -o "$STAGE/version.txt" -w '%{http_code}' "https://twizou.net/twizou-growth-v1-version.txt?check=$(date +%s)-$attempt") || code=000
  if [[ "$code" == 200 ]] && cmp -s "$LIVE/DEPLOY_COMMIT" "$STAGE/version.txt"; then VERIFIED=1; break; fi
  sleep 2
done
[[ "$VERIFIED" == 1 ]] || { echo 'PUBLIC_VERSION_VERIFY_FAILED'; rollback; }
POST_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/post.html" -w '%{http_code}' 'https://twizou.net/p/2106800501283234041') || POST_CODE=000
[[ "$POST_CODE" == 200 ]] || { echo "POST_PAGE_FAILED code=$POST_CODE"; rollback; }
ROOT_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/root.html" -w '%{http_code}' 'https://twizou.net/') || ROOT_CODE=000
[[ "$ROOT_CODE" == 200 ]] || { echo "ROOT_PAGE_FAILED code=$ROOT_CODE"; rollback; }
SITEMAP_CODE=$(curl -sS --connect-timeout 5 --max-time 60 -o "$STAGE/sitemap.xml" -w '%{http_code}' 'https://twizou.net/sitemap.xml') || SITEMAP_CODE=000
[[ "$SITEMAP_CODE" == 200 ]] || { echo "SITEMAP_FAILED code=$SITEMAP_CODE"; rollback; }
STAGE="$STAGE" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),dir=process.env.STAGE;
const post=fs.readFileSync(path.join(dir,'post.html'),'utf8'),xml=fs.readFileSync(path.join(dir,'sitemap.xml'),'utf8');
const head=post.split('</head>')[0];
if(!head.includes('<title>')||!head.includes('name="description"')||!head.includes('https://twizou.net/p/2106800501283234041'))throw Error('POST_METADATA_CHECK_FAILED');
if(!xml.includes('https://twizou.net/p/'))throw Error('SITEMAP_CHECK_FAILED');
console.log('POST_METADATA_AND_SITEMAP_CHECK_OK');
JS
flock -u 8; flock -u 7
trap - ERR INT TERM
echo "PREVIOUS_RUNTIME_BACKUP=$BACKUP_BASE"
echo "NEW_BUILD_ID=$NEW_BUILD"
echo 'TWIZOU_GROWTH_V1_DEPLOYMENT_COMPLETE'
echo 'CRON_AND_MONITOR_WRAPPERS=UNCHANGED'
