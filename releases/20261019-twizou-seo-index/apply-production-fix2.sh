#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
export PATH="$(dirname "$NODE"):$PATH"
export NEXT_TELEMETRY_DISABLED=1
PAYLOAD=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
HTACCESS="$ACCOUNT/public_html/.htaccess"
MODE=${1:---check}
[[ $# -le 1 && ( "$MODE" == --check || "$MODE" == --apply ) ]] || { echo 'USAGE: bash apply-production.sh [--check|--apply]'; exit 2; }
[[ -x "$NODE" && -f "$HTACCESS" && -f "$PAYLOAD/manifest.json" && -f "$PAYLOAD/v3-source-manifest.json" ]] || { echo 'EXPECTED_LAYOUT_MISSING'; exit 1; }
LIVE=$(HTACCESS="$HTACCESS" "$NODE" <<'JS'
const fs=require('fs');const s=fs.lstatSync(process.env.HTACCESS);if(!s.isFile()||s.uid!==process.getuid()||(s.mode&0o777)!==0o644)throw Error('HTACCESS_INVALID');
const roots=[...fs.readFileSync(process.env.HTACCESS,'utf8').matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
if(roots.length!==1||!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/runtime$/.test(roots[0][1]))throw Error('UNEXPECTED_APP_ROOT');console.log(roots[0][1]);
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
const payload=process.env.PAYLOAD,source=process.env.SOURCE;
const m=JSON.parse(fs.readFileSync(path.join(payload,'manifest.json'),'utf8'));
if(m.release!=='twizou-seo-index-v1-20261019'||!Array.isArray(m.files)||m.files.length<30)throw Error('MANIFEST_INVALID');
const names=new Set();for(const r of m.files){if(typeof r.path!=='string'||! /^(?:app|lib|scripts|public)\/[A-Za-z0-9_./\[\]-]+$/.test(r.path)||r.path.includes('..')||names.has(r.path)||(!/^[a-f0-9]{64}$/.test(r.candidateSha256))||(r.baselineSha256!==null&&!/^[a-f0-9]{64}$/.test(r.baselineSha256)))throw Error('MANIFEST_FILE_INVALID');names.add(r.path);}
for(const row of m.files){
 const target=path.join(source,row.path);if(row.baselineSha256===null ? fs.existsSync(target) : (!fs.existsSync(target)||hash(target)!==row.baselineSha256))throw Error('SOURCE_CHANGED_'+row.path);
 if(hash(path.join(payload,row.path))!==row.candidateSha256)throw Error('PAYLOAD_CORRUPT_'+row.path);
}
const v3=JSON.parse(fs.readFileSync(path.join(payload,'v3-source-manifest.json'),'utf8'));
if(!Array.isArray(v3)||v3.length!==3)throw Error('V3_MANIFEST_INVALID');
for(const row of v3){if(!['lib/availability-policy.ts','lib/availability-scan.ts','scripts/scan-author-status.cjs'].includes(row.file)||hash(path.join(source,row.file))!==row.candidateSha256)throw Error('V3_AVAILABILITY_SOURCE_CHANGED_'+row.file);}
console.log('CURRENT_SOURCE_V3_AND_TWIZOU_PAYLOAD_HASHES_MATCH');
JS
[[ -f "$ACCOUNT/xclip-author-monitor-jitter.sh" && -f "$ACCOUNT/xclip-author-monitor.sh" ]] || { echo 'MONITOR_WRAPPER_MISSING'; exit 1; }
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime
if [[ "$MODE" == --check ]]; then echo "PRECHECK_OK; LIVE_BUILD_ID=$LIVE_BUILD; no production changes"; exit 0; fi
LOCK="$ACCOUNT/.xclip-production-deploy.lock"
mkdir "$LOCK" 2>/dev/null || { echo 'DEPLOYMENT_BUSY'; exit 1; }
STAGE=''; BACKUP=''; CHECK_PID=''; ACTIVATED=0
cleanup(){
 if [[ -n "$CHECK_PID" ]]; then kill "$CHECK_PID" 2>/dev/null || true; fi
 rmdir "$LOCK" 2>/dev/null || true
}
stop_cwd(){ local root="$1" pid; for pid in $(ps -u rbxfxmfd -o pid=,comm= | awk '$2 ~ /^(next-server|node)/ {print $1}'); do [[ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" != "$root" ]] || kill -TERM "$pid" 2>/dev/null || true; done; }
rollback(){
 trap - ERR INT TERM
 if [[ "$ACTIVATED" == 1 && -d "$BACKUP" ]]; then
  if [[ -d "$LIVE" ]]; then stop_cwd "$LIVE"; mv "$LIVE" "$STAGE/failed-runtime"; fi
  mv "$BACKUP" "$LIVE"
  mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
  echo 'PREVIOUS_RUNTIME_RESTORED'
 fi
 echo 'TWIZOU_SEO_INDEX_V1_FIX2_FAILED; see staging log, do not rerun blindly'
 exit 1
}
trap cleanup EXIT
trap rollback ERR INT TERM
STAGE=$(mktemp -d "$ACCOUNT/xclip-twizou-seo-index-v1-fix2.XXXXXX")
mkdir "$STAGE/source" "$STAGE/runtime" "$STAGE/build-home"
echo "STAGING_DIRECTORY=$STAGE"
tar -C "$SOURCE" --exclude='./.next' --exclude='./.git' --exclude='./.env*' --exclude='./.local-admin' --exclude='./artifacts' --exclude='./data' --exclude='./out' --exclude='./.cache' -cf - . | tar -C "$STAGE/source" -xf -
cd "$STAGE/source"
"$NODE" scripts/test-public-mobile-return.cjs > "$STAGE/baseline-mobile-return.log" 2>&1 || { echo 'BASELINE_MOBILE_RETURN_FAILED; live unchanged; inspect private staging log'; exit 1; }
PAYLOAD="$PAYLOAD" STAGE_SOURCE="$STAGE/source" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const m=JSON.parse(fs.readFileSync(path.join(process.env.PAYLOAD,'manifest.json'),'utf8'));
for(const row of m.files){
 const target=path.join(process.env.STAGE_SOURCE,row.path);const actual=fs.existsSync(target)?crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex'):null;
 if(row.baselineSha256===null ? fs.existsSync(path.join(process.env.STAGE_SOURCE,row.path)) : actual!==row.baselineSha256)throw Error('STAGED_SOURCE_CHANGED_'+row.path);
}
console.log('STAGED_TARGET_BASELINES_MATCH');
JS
PAYLOAD="$PAYLOAD" STAGE_SOURCE="$STAGE/source" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const manifest=JSON.parse(fs.readFileSync(path.join(process.env.PAYLOAD,'manifest.json'),'utf8'));
for(const row of manifest.files){
 const from=path.join(process.env.PAYLOAD,row.path),to=path.join(process.env.STAGE_SOURCE,row.path);
 fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
 const actual=crypto.createHash('sha256').update(fs.readFileSync(to)).digest('hex');
 if(actual!==row.candidateSha256)throw Error('STAGED_PAYLOAD_MISMATCH_'+row.path);
}
console.log('STAGED_PAYLOAD_FILES_COPIED='+manifest.files.length);
JS
cp "$LIVE/.env.production" "$STAGE/source/.env.production"; chmod 600 "$STAGE/source/.env.production"
# Existing Cron calls xclip-author-monitor-jitter.sh, which resolves the active
# DEPLOY_SOURCE at each run. Do not edit Cron or the legacy worker wrapper.
[[ -f "$ACCOUNT/xclip-author-monitor-jitter.sh" && -f "$ACCOUNT/xclip-author-monitor.sh" ]] || { echo 'MONITOR_WRAPPER_MISSING'; exit 1; }
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime
"$NODE" - "$ACCOUNT/xclip-author-monitor.sh" <<'JS'
const fs=require('fs');const p=process.argv[2],s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid())throw Error('LEGACY_MONITOR_UNSAFE');
const t=fs.readFileSync(p,'utf8');if(!t.includes('DEPLOY_SOURCE')||!t.includes('scan-author-status.cjs'))throw Error('LEGACY_MONITOR_SOURCE_LINK_UNKNOWN');
console.log('EXISTING_MONITOR_SOURCE_LINK_CONFIRMED; Cron unchanged');
JS
cd "$STAGE/source"
"$NODE" scripts/check-canonical.cjs test > "$STAGE/all-tests.log" 2>&1 || { echo 'CANONICAL_TESTS_FAILED; live unchanged; inspect private staging log'; exit 1; }
"$NODE" scripts/check-canonical.cjs types > "$STAGE/types.log" 2>&1 || { echo 'TYPES_FAILED; live unchanged; inspect private staging log'; exit 1; }
HOME="$STAGE/build-home" USERPROFILE="$STAGE/build-home" NODE_OPTIONS="--require $STAGE/source/scripts/offline-guard.cjs" npm run build > "$STAGE/build.log" 2>&1 || { echo 'BUILD_FAILED; live unchanged; inspect private staging log'; exit 1; }
cp -a .next/standalone/. "$STAGE/runtime/"
mkdir -p "$STAGE/runtime/.next" "$STAGE/runtime/public"
cp -a .next/static "$STAGE/runtime/.next/static"
[[ ! -d "$LIVE/public" ]] || cp -a "$LIVE/public/." "$STAGE/runtime/public/"
[[ ! -d public ]] || cp -a public/. "$STAGE/runtime/public/"
cp "$LIVE/.env.production" "$STAGE/runtime/.env.production"; chmod 600 "$STAGE/runtime/.env.production"
NEW_BUILD=$(cat .next/BUILD_ID)
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/DEPLOY_COMMIT"
printf '%s\n' "$STAGE/source" > "$STAGE/runtime/DEPLOY_SOURCE"
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/public/twizou-seo-index-v1-fix2-version-20261019.txt"
STAGE_SOURCE="$STAGE/source" STAGE_RUNTIME="$STAGE/runtime" "$NODE" <<'JS'
const fs=require('fs'),path=require('path');
const source=process.env.STAGE_SOURCE,runtime=process.env.STAGE_RUNTIME;
if(!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/source$/.test(source)||
 fs.readFileSync(path.join(runtime,'DEPLOY_SOURCE'),'utf8').trim()!==source||
 fs.readFileSync(path.join(source,'.next/BUILD_ID'),'utf8').trim()!==fs.readFileSync(path.join(runtime,'.next/BUILD_ID'),'utf8').trim())throw Error('STAGED_MONITOR_SOURCE_MISMATCH');
console.log('STAGED_MONITOR_SOURCE_CHECK_OK');
JS
[[ "$(cat "$LIVE/.next/BUILD_ID")" == "$LIVE_BUILD" && "$(cat "$LIVE/DEPLOY_SOURCE")" == "$SOURCE" ]] || { echo 'LIVE_CHANGED_DURING_BUILD'; exit 1; }
exec 7> "$ACCOUNT/.xclip-author-monitor.lock"
flock -n 7 || { echo 'AVAILABILITY_WORKER_BUSY'; exit 1; }
exec 8> "$ACCOUNT/.xclip-free-curated-collector.lock"
flock -n 8 || { echo 'COLLECTOR_BUSY'; exit 1; }
BACKUP_BASE=$(mktemp -d "$ACCOUNT/xclip-before-twizou-seo-index-v1-fix2.XXXXXX")
BACKUP="$BACKUP_BASE/runtime"
[[ "$(stat -c %d "$LIVE")" == "$(stat -c %d "$STAGE/runtime")" ]] || { echo 'FILESYSTEM_MISMATCH'; exit 1; }
[[ "$(cat "$LIVE/.next/BUILD_ID")" == "$LIVE_BUILD" ]] || { echo 'LIVE_BUILD_CHANGED'; exit 1; }
mv "$LIVE" "$BACKUP"
ACTIVATED=1
mv "$STAGE/runtime" "$LIVE"
mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime
stop_cwd "$BACKUP"
VERIFIED=0
for attempt in $(seq 1 20); do
 code=$(curl -sS --connect-timeout 5 --max-time 15 -o "$STAGE/version.txt" -w '%{http_code}' "https://xcliprank.com/twizou-seo-index-v1-fix2-version-20261019.txt?check=$(date +%s)-$attempt") || code=000
 if [[ "$code" == 200 ]] && cmp -s "$LIVE/DEPLOY_COMMIT" "$STAGE/version.txt"; then VERIFIED=1; break; fi
 sleep 2
done
[[ "$VERIFIED" == 1 ]] || { echo 'PUBLIC_VERIFY_FAILED'; rollback; }
SITEMAP_CODE=$(curl -sS --connect-timeout 5 --max-time 40 -o "$STAGE/sitemap.xml" -w '%{http_code}' 'https://xcliprank.com/sitemap.xml') || SITEMAP_CODE=000
[[ "$SITEMAP_CODE" == 200 ]] || { echo 'SITEMAP_HTTP_FAILED'; rollback; }
FIRST_POST=$(SITEMAP="$STAGE/sitemap.xml" "$NODE" <<'JS'
const fs=require('fs');const xml=fs.readFileSync(process.env.SITEMAP,'utf8');const posts=[...xml.matchAll(new RegExp('https://xcliprank[.]com/p/([0-9]{2,25})','g'))];const accounts=[...xml.matchAll(new RegExp('https://xcliprank[.]com/accounts/','g'))];if(posts.length<5||accounts.length<1)throw Error('SITEMAP_TOO_SMALL posts='+posts.length+' accounts='+accounts.length);console.error('SITEMAP_CHECK_OK posts='+posts.length+' accounts='+accounts.length);console.log(posts[0][1]);
JS
)
POST_CODE=$(curl -sS --connect-timeout 5 --max-time 30 -o "$STAGE/post.html" -w '%{http_code}' "https://xcliprank.com/p/$FIRST_POST") || POST_CODE=000
[[ "$POST_CODE" == 200 ]] || { echo 'POST_HTTP_FAILED'; rollback; }
POST="$STAGE/post.html" "$NODE" <<'JS'
const fs=require('fs');const s=fs.readFileSync(process.env.POST,'utf8');if(!s.includes('twizou')||/name="robots" content="noindex/i.test(s))throw Error('POST_METADATA_VERIFY_FAILED');console.log('POST_INDEX_METADATA_CHECK_OK');
JS
flock -u 8; flock -u 7
trap - ERR INT TERM
echo "PREVIOUS_RUNTIME_BACKUP=$BACKUP_BASE"
echo "NEW_BUILD_ID=$NEW_BUILD"
echo 'TWIZOU_SEO_INDEX_V1_FIX2_DEPLOYMENT_COMPLETE'
echo 'CRON_AND_MONITOR_WRAPPERS=UNCHANGED; Existing 3-hour monitor resolves new source'
