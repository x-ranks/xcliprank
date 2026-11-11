#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
export PATH="$(dirname "$NODE"):$PATH" NEXT_TELEMETRY_DISABLED=1
PAYLOAD=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
MODE=${1:---check}
[[ $# -le 1 && ( "$MODE" == --check || "$MODE" == --apply ) ]] || { echo 'USAGE: bash apply-production.sh [--check|--apply]'; exit 2; }
[[ -x "$NODE" && -f "$ACCOUNT/public_html/.htaccess" ]] || { echo 'EXPECTED_LAYOUT_MISSING'; exit 1; }
LIVE=$(HTACCESS="$ACCOUNT/public_html/.htaccess" "$NODE" <<'JS'
const fs=require('fs'),p=process.env.HTACCESS,s=fs.lstatSync(p);
if(!s.isFile()||s.uid!==process.getuid())throw Error('HTACCESS_INVALID');
const roots=[...fs.readFileSync(p,'utf8').matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
if(roots.length!==1||!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/runtime$/.test(roots[0][1]))throw Error('UNEXPECTED_APP_ROOT');
console.log(roots[0][1]);
JS
)
[[ -f "$LIVE/server.js" && -f "$LIVE/.env.production" && -f "$LIVE/.next/BUILD_ID" && -f "$LIVE/DEPLOY_SOURCE" ]] || { echo 'LIVE_LAYOUT_MISSING'; exit 1; }
SOURCE=$(cat "$LIVE/DEPLOY_SOURCE")
[[ "$SOURCE" == "$ACCOUNT"/* && -d "$SOURCE/node_modules/typescript" && -f "$SOURCE/package.json" ]] || { echo 'LIVE_SOURCE_MISSING'; exit 1; }
LIVE_BUILD=$(cat "$LIVE/.next/BUILD_ID")
[[ "$LIVE_BUILD" == "$(cat "$SOURCE/.next/BUILD_ID")" && "$LIVE_BUILD" == 'v7x4e-MKe1YsYzV5EHK3l' ]] || { echo "UNEXPECTED_LIVE_BUILD_ID=$LIVE_BUILD"; exit 1; }
PAYLOAD="$PAYLOAD" SOURCE="$SOURCE" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const root=process.env.PAYLOAD,m=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const allowed=new Set(["scripts/origin-pilot.cjs","scripts/public-response-cache.cjs","scripts/install-public-response-cache.cjs"]);
if(m.release!=='twizou-googlebot-production-canary-20261110-origin'||m.expectedLiveBuildId!=='v7x4e-MKe1YsYzV5EHK3l'||!Array.isArray(m.files)||m.files.length!==allowed.size)throw Error('MANIFEST_INVALID');
const seen=new Set();
for(const f of m.files){
 if(!allowed.has(f.path)||seen.has(f.path)||!/^[a-f0-9]{64}$/.test(f.candidateSha256)||(f.baselineSha256!==null&&!/^[a-f0-9]{64}$/.test(f.baselineSha256)))throw Error('MANIFEST_FILE_INVALID');
 seen.add(f.path);const target=path.join(process.env.SOURCE,f.path);
 if(f.baselineSha256===null){if(fs.existsSync(target))throw Error('NEW_FILE_ALREADY_EXISTS_'+f.path);}
 else if(hash(target)!==f.baselineSha256)throw Error('SOURCE_BASELINE_CHANGED_'+f.path);
 if(hash(path.join(root,f.path))!==f.candidateSha256)throw Error('PAYLOAD_CORRUPT_'+f.path);
}
console.log('SOURCE_AND_PAYLOAD_HASHES_MATCH');
JS
cmp -s "$SOURCE/scripts/public-response-cache.cjs" "$LIVE/twizou-public-response-cache.cjs" || { echo LIVE_CACHE_ADAPTER_DIFFERS; exit 1; }
cmp -s "$SOURCE/scripts/verified-googlebot.cjs" "$LIVE/verified-googlebot.cjs" || { echo LIVE_GOOGLEBOT_ADAPTER_DIFFERS; exit 1; }
[[ ! -e "$ACCOUNT/.xclip-edge-production-canary-v1" && ! -L "$ACCOUNT/.xclip-edge-production-canary-v1" ]] || { echo PILOT_STATE_ALREADY_EXISTS; exit 1; }
"$NODE" "$SOURCE/scripts/check-public-response-controls.cjs" "$SOURCE"
bash "$ACCOUNT/xclip-author-monitor-jitter.sh" --check-runtime
if [[ "$MODE" == --check ]]; then echo "PRECHECK_OK; LIVE_BUILD_ID=$LIVE_BUILD; no production changes"; exit 0; fi
LOCK="$ACCOUNT/.xclip-production-deploy.lock"
mkdir "$LOCK" 2>/dev/null || { echo 'DEPLOYMENT_BUSY'; exit 1; }
MONITOR_PAUSE_HELD=0; STAGE=''; BACKUP=''; ACTIVATED=0
stop_cwd(){ local root="$1" pid; for pid in $(ps -u rbxfxmfd -o pid=,comm= | awk '$2 ~ /^(next-server|node)/ {print $1}'); do [[ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" != "$root" ]] || kill -TERM "$pid" 2>/dev/null || true; done; }
cleanup(){
 rmdir "$LOCK" 2>/dev/null || true
 if [[ "$MONITOR_PAUSE_HELD" == 1 ]]; then flock -u 7 2>/dev/null || true; exec 7>&-; echo 'MONITOR_PAUSE_RELEASED; next scheduled patrol is permitted'; fi
}
rollback(){
 trap - ERR INT TERM HUP
 if [[ "$ACTIVATED" == 1 && -d "$BACKUP" ]]; then
  if [[ -d "$LIVE" ]]; then stop_cwd "$LIVE"; mv "$LIVE" "$STAGE/failed-runtime"; fi
  mv "$BACKUP" "$LIVE"; mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"; echo 'PREVIOUS_RUNTIME_RESTORED'
 fi
 echo 'TWIZOU_GOOGLEBOT_CANARY_ORIGIN_FAILED; inspect private staging logs; do not rerun blindly'
 exit 1
}
snapshot_video_pilot() {
 local label="$1" prefix="$STAGE/video-pilot-$1" status
 : > "$prefix.xml" || return
 status=$(curl -sS --connect-timeout 5 --max-time 30 -D "$prefix.headers" -o "$prefix.xml" \
   -w '%{http_code}' 'https://twizou.net/sitemap-video-pilot.xml') || return
 PILOT_PREFIX="$prefix" PILOT_STATUS="$status" PILOT_LABEL="$label" "$NODE" <<'JS'
const fs = require('node:fs');
const { PILOT_PREFIX: prefix, PILOT_STATUS: status, PILOT_LABEL: label } = process.env;
const headers = fs.readFileSync(prefix + '.headers', 'utf8');
const xml = fs.readFileSync(prefix + '.xml', 'utf8');
if (!/^cache-control:\s*no-store\b/im.test(headers)) throw Error('VIDEO_SITEMAP_PILOT_CACHE_INVALID ' + label);

const expected = [...fs.readFileSync('lib/video-sitemap-pilot.ts', 'utf8')
  .matchAll(/^  "([0-9]{19})",\r?$/gm)].map(m => m[1]);
if (expected.length !== 5 || new Set(expected).size !== 5) throw Error('VIDEO_SITEMAP_PILOT_CONFIG_INVALID');

const ids = [];
if (status === '200') {
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)];
  if (!/^content-type:\s*application\/xml\b/im.test(headers) || /^x-robots-tag:.*noindex/im.test(headers) ||
      !xml.includes('xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"') ||
      !xml.trimEnd().endsWith('</urlset>') || !entries.length || entries.length > expected.length ||
      (xml.match(/<video:video>/g) ?? []).length !== entries.length)
    throw Error('VIDEO_SITEMAP_PILOT_RESPONSE_INVALID ' + label);
  let previousPosition = -1;
  for (const [, entry] of entries) {
    const locations = [...entry.matchAll(/<loc>https:\/\/twizou\.net\/p\/([0-9]{19})<\/loc>/g)];
    const id = locations[0]?.[1];
    const position = expected.indexOf(id);
    if (locations.length !== 1 || position <= previousPosition) throw Error('VIDEO_SITEMAP_PILOT_CANONICAL_MISMATCH ' + label);
    previousPosition = position;
    ids.push(id);
    for (const tag of ['thumbnail_loc', 'title', 'description', 'content_loc', 'publication_date', 'family_friendly']) {
      if (!new RegExp('<video:' + tag + '>[^<]+</video:' + tag + '>').test(entry))
        throw Error('VIDEO_SITEMAP_PILOT_MISSING_' + tag + ' ' + label);
    }
  }
} else if (status !== '404' || xml.trim()) {
  throw Error('VIDEO_SITEMAP_PILOT_UNEXPECTED_HTTP ' + label + ' ' + status);
}
fs.writeFileSync(prefix + '.snapshot', JSON.stringify({ status, ids }));
console.log('VIDEO_SITEMAP_PILOT_SNAPSHOT phase=' + label + ' http=' + status + ' videos=' + ids.length);
JS
}
trap cleanup EXIT
trap rollback ERR INT TERM HUP
exec 7> "$ACCOUNT/.xclip-author-monitor.lock"
if ! flock -n 7; then
 echo 'WAITING_FOR_CURRENT_PATROL; no force stop; max=60m'
 acquired=0
 for attempt in $(seq 1 120); do if flock -w 30 7; then acquired=1; break; fi; echo "WAITING_FOR_CURRENT_PATROL elapsed=$((attempt * 30))s"; done
 [[ "$acquired" == 1 ]] || { echo 'AVAILABILITY_WORKER_BUSY'; rollback; }
fi
MONITOR_PAUSE_HELD=1
echo 'MONITOR_PAUSED_FOR_DEPLOYMENT; lock held through build and checks; no Cron changes'
STAGE=$(mktemp -d "$ACCOUNT/xclip-twizou-googlebot-production-canary-v1.XXXXXX")
mkdir "$STAGE/source" "$STAGE/runtime" "$STAGE/build-home"
echo "STAGING_DIRECTORY=$STAGE"
tar -C "$SOURCE" --exclude='./.next' --exclude='./.git' --exclude='./.env*' --exclude='./.local-admin' --exclude='./artifacts' --exclude='./data' --exclude='./out' --exclude='./.cache' -cf - . | tar -C "$STAGE/source" -xf -
PAYLOAD="$PAYLOAD" STAGE_SOURCE="$STAGE/source" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const m=JSON.parse(fs.readFileSync(path.join(process.env.PAYLOAD,'manifest.json'),'utf8'));
for(const f of m.files){const from=path.join(process.env.PAYLOAD,f.path),to=path.join(process.env.STAGE_SOURCE,f.path);
 if(f.baselineSha256===null){if(fs.existsSync(to))throw Error('STAGED_NEW_FILE_EXISTS_'+f.path);}
 else if(hash(to)!==f.baselineSha256)throw Error('STAGED_BASELINE_CHANGED_'+f.path);
 fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);if(hash(to)!==f.candidateSha256)throw Error('STAGED_COPY_FAILED_'+f.path);
}
console.log('STAGED_PAYLOAD_FILES_COPIED='+m.files.length);
JS
cp "$LIVE/.env.production" "$STAGE/source/.env.production"; chmod 600 "$STAGE/source/.env.production"
cd "$STAGE/source"
"$NODE" scripts/test-search-ux-pilot.cjs > "$STAGE/search-ux-test.log" 2>&1 || { echo SEARCH_UX_TEST_FAILED; rollback; }
"$NODE" scripts/check-canonical.cjs test > "$STAGE/all-tests.log" 2>&1 || { echo 'CANONICAL_TESTS_FAILED'; rollback; }
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
snapshot_video_pilot before || rollback
BACKUP_BASE=$(mktemp -d "$ACCOUNT/xclip-before-twizou-googlebot-production-canary-v1.XXXXXX")
BACKUP="$BACKUP_BASE/runtime"
[[ "$(stat -c %d "$LIVE")" == "$(stat -c %d "$STAGE/runtime")" ]] || { echo 'FILESYSTEM_MISMATCH'; rollback; }
mv "$LIVE" "$BACKUP"; ACTIVATED=1; mv "$STAGE/runtime" "$LIVE"
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
POST='https://twizou.net/p/2091860611881967725'
for label in normal forged_xff; do
 flags=(); [[ "$label" == normal ]] || flags=(-H 'User-Agent: Googlebot/2.1' -H 'X-Forwarded-For: 66.249.66.1' -H 'X-Twizou-Verified-Googlebot: 1' -H 'X-Twizou-Edge-Pilot: forged')
 code=$(curl -sS --connect-timeout 5 --max-time 40 "${flags[@]}" -D "$STAGE/$label.headers" -o "$STAGE/$label.html" -w '%{http_code}' "$POST") || code=000
 [[ "$code" == 200 ]] || { echo "POST_PAGE_FAILED mode=$label code=$code"; rollback; }
 if ! grep -q 'class="age-gate"' "$STAGE/$label.html"; then echo "AGE_GATE_MISSING_FOR_HUMAN_OR_SPOOF mode=$label"; rollback; fi
 if ! grep -qi '^cache-control:.*no-store' "$STAGE/$label.headers"; then echo "POST_CACHE_CONTROL_UNSAFE mode=$label"; rollback; fi
done
echo 'HUMAN_AND_FORGED_XFF_AGE_GATE_CHECK_OK; edge proof disabled pending separate activation'

snapshot_video_pilot after || rollback
cmp -s "$STAGE/video-pilot-before.snapshot" "$STAGE/video-pilot-after.snapshot" || { echo VIDEO_SITEMAP_PILOT_CHANGED_DURING_DEPLOY; rollback; }
echo VIDEO_SITEMAP_PILOT_PUBLIC_CHECK_OK

for id in 2096572807497060638 2093153066023576024; do
 curl -fsS --connect-timeout 5 --max-time 40 -o "$STAGE/description-$id.html" "https://twizou.net/p/$id" || { echo SEARCH_DESCRIPTION_FETCH_FAILED; rollback; }
done
curl -fsS --connect-timeout 5 --max-time 40 -o "$STAGE/search-home.html" 'https://twizou.net/' || { echo SEARCH_HOME_FETCH_FAILED; rollback; }
SEARCH_UX_STAGE="$STAGE" "$NODE" <<'JS'
const fs = require('node:fs'), path = require('node:path');
const read = name => fs.readFileSync(path.join(process.env.SEARCH_UX_STAGE, name), 'utf8');
const ids = ['2096572807497060638', '2093153066023576024'];
for (const id of ids) {
 const html = read('description-' + id + '.html');
 const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
 if (!description?.includes('のX動画') || !description.includes('元の投稿文：') ||
     !html.includes('rel="canonical" href="https://twizou.net/p/' + id + '"') ||
     !html.includes('"@type":"VideoObject"')) throw Error('SEARCH_DESCRIPTION_PUBLIC_CHECK_FAILED ' + id);
}
const html = read('search-home.html');
const form = html.match(/<form\b(?=[^>]*class="site-search-form")[^>]*>[\s\S]*?<\/form>/)?.[0] ?? '';
if (!form.includes('action="/discover"') || !form.includes('method="get"') ||
    !form.includes('name="mode"') || !form.includes('value="search"') ||
    !form.includes('name="q"') || !html.includes('class="video-card"')) throw Error('SEARCH_HOME_PUBLIC_CHECK_FAILED');
console.log('SEARCH_UX_PUBLIC_CHECK_OK descriptions=2');
JS

RISING_CODE=$(curl -sS --connect-timeout 5 --max-time 120 -o "$STAGE/rising.html" -w '%{http_code}' 'https://twizou.net/rising') || RISING_CODE=000
[[ "$RISING_CODE" == 200 ]] || { echo "RISING_PAGE_FAILED code=$RISING_CODE"; rollback; }
grep -q 'class="video-card"' "$STAGE/rising.html" || { echo 'RISING_CARDS_EMPTY'; rollback; }
echo 'RISING_CARDS_VISIBLE_AFTER_RESTORE'
echo "PREVIOUS_RUNTIME_BACKUP=$BACKUP_BASE"
echo "NEW_BUILD_ID=$NEW_BUILD"
echo 'TWIZOU_GOOGLEBOT_CANARY_ORIGIN_DEPLOYMENT_COMPLETE'
echo 'CRONTAB_AND_MONITOR_WRAPPERS=UNCHANGED; no patrol triggered'
