#!/usr/bin/env bash
# twizou 自動反映 v1
# GitHub の main にある production/source を、安全確認つきで本番へ反映する。
#   --check          何を変えるかを表示するだけ（本番は変更しない）
#   --apply          今すぐ反映する（手動実行用）
#   --auto           Cron 用。変更がなければ何も出力しない。PAUSE と失敗済みコミットを尊重する
#   --status         現在の状態を表示する
#   --init-baseline  「いま本番にあるファイル」を基準として記録する（設置時に1回）
#   --enable-cron / --disable-cron   5分ごとの自動実行を入れる／外す
# 既存の手動配布スクリプトと同じ排他ロック・復旧手順を使う。秘密情報は表示しない。
set -Eeuo pipefail
umask 077

ACCOUNT=${TWIZOU_ACCOUNT:-$HOME}
STATE="$ACCOUNT/.twizou-auto-deploy"
GIT_URL=${TWIZOU_GIT_URL:-https://github.com/x-ranks/xcliprank.git}
TARBALL_BASE=${TWIZOU_TARBALL_BASE:-https://codeload.github.com/x-ranks/xcliprank/tar.gz}
BASE_URL=${TWIZOU_BASE_URL:-https://twizou.net}
BRANCH=${TWIZOU_BRANCH:-main}
ME=$(id -un)
NODE=${TWIZOU_NODE:-$(ls -d "$ACCOUNT"/.local/node/*/bin/node 2>/dev/null | sort -V | tail -n 1 || true)}
MODE=${1:---check}
SELF="$STATE/deploy.sh"
CRON_TAG='# twizou-auto-deploy'
MANAGED_DIRS=(app lib scripts sql supabase public)
MANAGED_ROOT=(middleware.ts next.config.ts package.json package-lock.json tsconfig.json next-env.d.ts)

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "$*"; exit 1; }
case "$MODE" in
  --check|--apply|--auto|--status|--init-baseline|--enable-cron|--disable-cron) ;;
  *) echo 'USAGE: deploy.sh [--check|--apply|--auto|--status|--init-baseline|--enable-cron|--disable-cron]'; exit 2 ;;
esac
mkdir -p "$STATE"
[[ -n "$NODE" && -x "$NODE" ]] || die 'NODE_NOT_FOUND'
export PATH="$(dirname "$NODE"):$PATH" NEXT_TELEMETRY_DISABLED=1

# ---------- Cron の入れ替え（他の Cron 行は一切変えない） ----------
if [[ "$MODE" == --enable-cron || "$MODE" == --disable-cron ]]; then
  command -v crontab >/dev/null || die 'CRONTAB_UNAVAILABLE'
  [[ -f "$STATE/baseline.sha256" ]] || die 'BASELINE_MISSING; run --init-baseline first'
  BACKUP_FILE="$STATE/crontab.backup.$(date +%s)"
  crontab -l > "$BACKUP_FILE" 2>/dev/null || : > "$BACKUP_FILE"
  before=$(grep -c . "$BACKUP_FILE" || true)
  if [[ "$MODE" == --enable-cron ]]; then
    if grep -qF "$CRON_TAG" "$BACKUP_FILE"; then log 'CRON_ALREADY_ENABLED'; exit 0; fi
    { cat "$BACKUP_FILE"; echo "*/5 * * * * $SELF --auto >> $STATE/log 2>&1 $CRON_TAG"; } | crontab -
    after=$(crontab -l | grep -c . || true)
    [[ "$after" == $((before + 1)) ]] || { crontab "$BACKUP_FILE"; die 'CRON_UPDATE_UNEXPECTED; previous crontab restored'; }
    log "CRON_ENABLED; other cron lines unchanged ($before); backup=$BACKUP_FILE"
  else
    grep -vF "$CRON_TAG" "$BACKUP_FILE" | crontab -
    log "CRON_DISABLED; backup=$BACKUP_FILE"
  fi
  exit 0
fi

# ---------- 共通の部品 ----------
hashes() { # $1=ルート。管理対象ファイルの sha256 一覧（パス順）
  ( cd "$1" && {
      for d in "${MANAGED_DIRS[@]}"; do if [[ -d "$d" ]]; then find "$d" -type f -print0; fi; done
      for f in "${MANAGED_ROOT[@]}"; do if [[ -f "$f" ]]; then printf '%s\0' "$f"; fi; done
    } | LC_ALL=C sort -z | xargs -0 -r sha256sum )
}

find_live() {
  local htaccess="$ACCOUNT/public_html/.htaccess"
  [[ -f "$htaccess" && ! -L "$htaccess" ]] || die 'HTACCESS_MISSING'
  LIVE=$(HTACCESS="$htaccess" ACCOUNT="$ACCOUNT" "$NODE" <<'JS'
const fs=require('fs');
const roots=[...fs.readFileSync(process.env.HTACCESS,'utf8').matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
const prefix=process.env.ACCOUNT.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
if(roots.length!==1||!new RegExp('^'+prefix+'/xclip-[^\\r\\n]+/runtime$').test(roots[0][1]))throw Error('UNEXPECTED_APP_ROOT');
console.log(roots[0][1]);
JS
)
  [[ -f "$LIVE/server.js" && -f "$LIVE/.env.production" && -f "$LIVE/.next/BUILD_ID" && -f "$LIVE/DEPLOY_SOURCE" ]] || die 'LIVE_LAYOUT_MISSING'
  SOURCE=$(cat "$LIVE/DEPLOY_SOURCE")
  [[ "$SOURCE" == "$ACCOUNT"/* && -d "$SOURCE/node_modules/typescript" && -f "$SOURCE/package.json" ]] || die 'LIVE_SOURCE_MISSING'
  LIVE_BUILD=$(cat "$LIVE/.next/BUILD_ID")
  [[ "$LIVE_BUILD" == "$(cat "$SOURCE/.next/BUILD_ID")" ]] || die 'LIVE_SOURCE_BUILD_MISMATCH'
}

if [[ "$MODE" == --status ]]; then
  find_live
  echo "live_build_id=$LIVE_BUILD"
  echo "live_git_sha=$(cat "$LIVE/DEPLOY_GIT_SHA" 2>/dev/null || echo unknown)"
  echo "paused=$([[ -e "$STATE/PAUSE" ]] && echo yes || echo no)"
  echo "cron=$(crontab -l 2>/dev/null | grep -qF "$CRON_TAG" && echo enabled || echo disabled)"
  echo "last_check=$(cat "$STATE/last-check" 2>/dev/null || echo none)"
  echo "last_result=$(cat "$STATE/last-sha" 2>/dev/null || echo none)"
  echo '--- log (last 15 lines) ---'; tail -n 15 "$STATE/log" 2>/dev/null || true
  exit 0
fi

if [[ "$MODE" == --init-baseline ]]; then
  find_live
  [[ ! -f "$STATE/baseline.sha256" ]] || die 'BASELINE_ALREADY_EXISTS; refusing to overwrite'
  hashes "$SOURCE" > "$STATE/baseline.sha256.tmp"
  mv "$STATE/baseline.sha256.tmp" "$STATE/baseline.sha256"
  log "BASELINE_RECORDED files=$(wc -l < "$STATE/baseline.sha256") source=${SOURCE#"$ACCOUNT"/} build=$LIVE_BUILD"
  exit 0
fi

# ---------- ここから check / apply / auto ----------
exec 9> "$STATE/run.lock"
flock -n 9 || { [[ "$MODE" == --auto ]] || log 'ANOTHER_RUN_IN_PROGRESS'; exit 0; }
if [[ -f "$STATE/log" && $(stat -c %s "$STATE/log") -gt 1048576 ]]; then mv "$STATE/log" "$STATE/log.1"; fi
if [[ "$MODE" == --auto && -e "$STATE/PAUSE" ]]; then exit 0; fi
[[ -f "$STATE/baseline.sha256" ]] || die 'BASELINE_MISSING; run --init-baseline first'

REMOTE_SHA=$(git ls-remote "$GIT_URL" "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}' | head -n 1)
[[ "$REMOTE_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'GITHUB_UNREACHABLE; nothing changed'
date -u +"%Y-%m-%dT%H:%M:%SZ $REMOTE_SHA" > "$STATE/last-check"
if [[ "$MODE" == --auto ]] && grep -qF "$REMOTE_SHA" "$STATE/last-sha" 2>/dev/null; then exit 0; fi

TMP=$(mktemp -d "$STATE/work.XXXXXX")
STAGE=''; BACKUP_BASE=''; BACKUP=''; ACTIVATED=0; LOCKS_HELD=0; DEPLOY_LOCK="$ACCOUNT/.xclip-production-deploy.lock"; LOCK_TAKEN=0
cleanup() {
  rm -rf "$TMP"
  if [[ "$LOCK_TAKEN" == 1 ]]; then rmdir "$DEPLOY_LOCK" 2>/dev/null || true; fi
}
trap cleanup EXIT

curl -fsSL --connect-timeout 10 --max-time 300 -o "$TMP/src.tar.gz" "$TARBALL_BASE/$REMOTE_SHA" || die 'DOWNLOAD_FAILED; nothing changed'
mkdir "$TMP/new"
tar -xzf "$TMP/src.tar.gz" -C "$TMP/new" --strip-components=3 --wildcards '*/production/source/*' 2>/dev/null || true
[[ -f "$TMP/new/package.json" && -d "$TMP/new/app" ]] || { echo "$REMOTE_SHA no-production-source" > "$STATE/last-sha"; die 'PRODUCTION_SOURCE_NOT_IN_COMMIT'; }
[[ -z "$(find "$TMP/new" -type l -print -quit)" ]] || { echo "$REMOTE_SHA refused-symlink" > "$STATE/last-sha"; die 'REFUSED: symlink in source'; }

find_live
hashes "$TMP/new" > "$TMP/new.sha256"
hashes "$SOURCE" > "$TMP/live.sha256"
MAXN=100000; [[ "$MODE" != --auto ]] || MAXN=120
set +e
BASE_F="$STATE/baseline.sha256" LIVE_F="$TMP/live.sha256" NEW_F="$TMP/new.sha256" PLAN_F="$TMP/plan" MAXN="$MAXN" "$NODE" <<'JS'
const fs=require('fs'),e=process.env;
const load=f=>new Map(fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>{const m=/^([0-9a-f]{64}) [ *](.+)$/.exec(l);if(!m)throw Error('BAD_HASH_LINE');return [m[2],m[1]];}));
const base=load(e.BASE_F),live=load(e.LIVE_F),next=load(e.NEW_F);
const ops=[],refuse=[];
for(const [p,h] of next) if(live.get(p)!==h) ops.push(['C',p]);
for(const p of live.keys()) if(!next.has(p)) ops.push(['R',p]);
for(const [k,p] of ops){
  if(live.has(p)){ if(!base.has(p)) refuse.push('UNKNOWN_SERVER_FILE '+p); else if(base.get(p)!==live.get(p)) refuse.push('SERVER_FILE_CHANGED_OUTSIDE_DEPLOY '+p); }
  else if(base.has(p)) refuse.push('SERVER_FILE_DELETED_OUTSIDE_DEPLOY '+p);
}
if(ops.some(([,p])=>p==='package.json'||p==='package-lock.json'))refuse.push('DEPENDENCY_FILES_CHANGED; manual deployment required');
if(ops.length>Number(e.MAXN))refuse.push('TOO_MANY_FILES '+ops.length+' (auto limit '+e.MAXN+')');
fs.writeFileSync(e.PLAN_F,ops.map(([k,p])=>k+' '+p).join('\n')+(ops.length?'\n':''));
console.log('files_to_change='+ops.filter(o=>o[0]==='C').length+' files_to_remove='+ops.filter(o=>o[0]==='R').length);
for(const [k,p] of ops.slice(0,25))console.log('  '+(k==='C'?'CHANGE ':'REMOVE ')+p);
if(ops.length>25)console.log('  ... and '+(ops.length-25)+' more');
for(const r of refuse.slice(0,15))console.log('REFUSED: '+r);
process.exitCode=refuse.length?3:(ops.length?0:4);
JS
PLAN_RC=$?
set -e
if [[ "$PLAN_RC" == 4 ]]; then
  echo "$REMOTE_SHA up-to-date" > "$STATE/last-sha"
  [[ "$MODE" == --auto ]] || log "UP_TO_DATE github=$REMOTE_SHA"
  exit 0
fi
if [[ "$PLAN_RC" == 3 ]]; then
  echo "$REMOTE_SHA refused" > "$STATE/last-sha"
  log "PLAN_REFUSED github=$REMOTE_SHA; production unchanged"
  [[ "$MODE" == --auto ]] && exit 0 || exit 1
fi
[[ "$PLAN_RC" == 0 ]] || die "PLAN_FAILED rc=$PLAN_RC"
if [[ "$MODE" == --auto ]] && [[ "$(cat "$STATE/failed-sha" 2>/dev/null || true)" == "$REMOTE_SHA" ]]; then exit 0; fi
if [[ "$MODE" == --check ]]; then log "CHECK_ONLY github=$REMOTE_SHA; production unchanged"; exit 0; fi

# ---------- 反映 ----------
log "DEPLOY_START github=$REMOTE_SHA live_build=$LIVE_BUILD"
mkdir "$DEPLOY_LOCK" 2>/dev/null || { log 'DEPLOYMENT_BUSY; another deployment holds the lock'; [[ "$MODE" == --auto ]] && exit 0 || exit 1; }
LOCK_TAKEN=1
[[ ! -e "$ACCOUNT/.xclip-free-download-deploy.lock" ]] || die 'OLDER_DEPLOYMENT_LOCK_EXISTS'
JITTER="$ACCOUNT/xclip-author-monitor-jitter.sh"
[[ -f "$JITTER" ]] && bash "$JITTER" --check-runtime || { [[ ! -f "$JITTER" ]] || die 'MONITOR_RUNTIME_CHECK_FAILED'; }

stop_cwd() { local root="$1" pid; for pid in $(ps -u "$ME" -o pid=,comm= | awk '$2 ~ /^(next-server|node)/ {print $1}'); do [[ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" != "$root" ]] || kill -TERM "$pid" 2>/dev/null || true; done; }
fail() { # 失敗時：必要なら元の runtime に戻す
  trap - ERR INT TERM HUP
  local why="$1"
  if [[ "$ACTIVATED" == 1 && -d "$BACKUP" ]]; then
    if [[ -d "$LIVE" ]]; then stop_cwd "$LIVE"; mv "$LIVE" "$STAGE/failed-runtime"; fi
    mv "$BACKUP" "$LIVE"; mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"; log 'PREVIOUS_RUNTIME_RESTORED'
  fi
  echo "$REMOTE_SHA" > "$STATE/failed-sha"; echo "$REMOTE_SHA failed" > "$STATE/last-sha"
  log "DEPLOY_FAILED reason=$why github=$REMOTE_SHA; production is on build $(cat "$LIVE/.next/BUILD_ID" 2>/dev/null || echo unknown); staging kept: ${STAGE:-none}"
  exit 1
}
trap 'fail "UNEXPECTED_ERROR line $LINENO"' ERR
trap 'fail "INTERRUPTED"' INT TERM HUP

exec 7> "$ACCOUNT/.xclip-author-monitor.lock"
if ! flock -n 7; then
  if [[ "$MODE" == --auto ]]; then
    flock -w 20 7 || { trap - ERR; log 'MONITOR_BUSY; will retry on the next run'; exit 0; }
  else
    log 'WAITING_FOR_CURRENT_PATROL; max=60m'; flock -w 3600 7 || fail 'AVAILABILITY_WORKER_BUSY'
  fi
fi

STAGE=$(mktemp -d "$ACCOUNT/xclip-twizou-auto.XXXXXX")
mkdir "$STAGE/source" "$STAGE/runtime" "$STAGE/build-home"
tar -C "$SOURCE" --exclude='./.next' --exclude='./.git' --exclude='./.env*' --exclude='./.local-admin' --exclude='./artifacts' --exclude='./data' --exclude='./out' --exclude='./.cache' -cf - . | tar -C "$STAGE/source" -xf -
while read -r kind path; do
  case "$path" in /*|*..*) fail "UNSAFE_PATH $path" ;; esac
  if [[ "$kind" == C ]]; then mkdir -p "$STAGE/source/$(dirname "$path")"; cp "$TMP/new/$path" "$STAGE/source/$path"; else rm -f "$STAGE/source/$path"; fi
done < "$TMP/plan"
hashes "$STAGE/source" > "$TMP/staged.sha256"
cmp -s "$TMP/staged.sha256" "$TMP/new.sha256" || fail 'STAGED_SOURCE_DIFFERS_FROM_GITHUB'
cp "$LIVE/.env.production" "$STAGE/source/.env.production"; chmod 600 "$STAGE/source/.env.production"
log "STAGED $(wc -l < "$TMP/plan") file changes; running tests and build"
cd "$STAGE/source"
"$NODE" scripts/check-canonical.cjs test > "$STAGE/tests.log" 2>&1 || fail 'TESTS_FAILED (see tests.log in staging)'
"$NODE" scripts/check-canonical.cjs types > "$STAGE/types.log" 2>&1 || fail 'TYPES_FAILED (see types.log in staging)'
HOME="$STAGE/build-home" USERPROFILE="$STAGE/build-home" NODE_OPTIONS="--require $STAGE/source/scripts/offline-guard.cjs" npm run build > "$STAGE/build.log" 2>&1 || fail 'BUILD_FAILED (see build.log in staging)'
cp -a .next/standalone/. "$STAGE/runtime/"
"$NODE" scripts/install-public-response-cache.cjs "$STAGE/runtime" > /dev/null
mkdir -p "$STAGE/runtime/.next" "$STAGE/runtime/public"
cp -a .next/static "$STAGE/runtime/.next/static"
if [[ -d "$LIVE/public" ]]; then cp -a "$LIVE/public/." "$STAGE/runtime/public/"; fi
if [[ -d public ]]; then cp -a public/. "$STAGE/runtime/public/"; fi
cp "$LIVE/.env.production" "$STAGE/runtime/.env.production"; chmod 600 "$STAGE/runtime/.env.production"
NEW_BUILD=$(cat .next/BUILD_ID)
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/DEPLOY_COMMIT"
printf '%s\n' "$STAGE/source" > "$STAGE/runtime/DEPLOY_SOURCE"
printf '%s\n' "$REMOTE_SHA" > "$STAGE/runtime/DEPLOY_GIT_SHA"
printf '%s\n' "$NEW_BUILD" > "$STAGE/runtime/public/twizou-speed-v5-version.txt"
[[ "$(cat "$STAGE/runtime/.next/BUILD_ID")" == "$NEW_BUILD" ]] || fail 'STAGED_BUILD_MISMATCH'
[[ "$NEW_BUILD" != "$LIVE_BUILD" ]] || fail 'BUILD_ID_UNCHANGED'
log "STAGED_BUILD_AND_TESTS_OK new_build=$NEW_BUILD"
[[ "$(cat "$LIVE/.next/BUILD_ID")" == "$LIVE_BUILD" && "$(cat "$LIVE/DEPLOY_SOURCE")" == "$SOURCE" ]] || fail 'LIVE_CHANGED_DURING_BUILD'

exec 8> "$ACCOUNT/.xclip-free-curated-collector.lock"
flock -n 8 || flock -w 60 8 || fail 'COLLECTOR_BUSY'
exec 6> "$ACCOUNT/.xclip-rising-refresh.lock"
flock -n 6 || flock -w 60 6 || fail 'RISING_REFRESH_BUSY'
BACKUP_BASE=$(mktemp -d "$ACCOUNT/xclip-before-twizou-auto.XXXXXX")
BACKUP="$BACKUP_BASE/runtime"
[[ "$(stat -c %d "$LIVE")" == "$(stat -c %d "$STAGE/runtime")" ]] || fail 'FILESYSTEM_MISMATCH'
mv "$LIVE" "$BACKUP"; ACTIVATED=1; mv "$STAGE/runtime" "$LIVE"
mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
if [[ -f "$JITTER" ]]; then bash "$JITTER" --check-runtime || fail 'MONITOR_RUNTIME_CHECK_FAILED_AFTER_SWITCH'; fi
stop_cwd "$BACKUP"

# ---------- 公開サイトでの確認（1つでも失敗したら元に戻す） ----------
fetch() { curl -sS --connect-timeout 5 --max-time 120 -D "$3" -o "$2" -w '%{http_code}' "$1" 2>/dev/null || echo 000; }
VERIFIED=0
for attempt in $(seq 1 20); do
  code=$(fetch "$BASE_URL/twizou-speed-v5-version.txt?check=$(date +%s)-$attempt" "$TMP/version.txt" "$TMP/version.h")
  if [[ "$code" == 200 ]] && cmp -s "$LIVE/DEPLOY_COMMIT" "$TMP/version.txt"; then VERIFIED=1; break; fi
  sleep 2
done
[[ "$VERIFIED" == 1 ]] || fail 'PUBLIC_VERSION_VERIFY_FAILED'
for route in / /rising; do
  code=$(fetch "$BASE_URL$route" "$TMP/page.html" "$TMP/page.h")
  [[ "$code" == 200 ]] || fail "PAGE_FAILED route=$route code=$code"
  grep -q 'class="video-card"' "$TMP/page.html" || fail "CARDS_EMPTY route=$route"
  [[ "$route" != /rising ]] || cp "$TMP/page.html" "$TMP/rising.html"
done
POST_ID=$(grep -o '/p/[0-9]\{19\}' "$TMP/rising.html" | head -n 1 | cut -d/ -f3 || true)
[[ -n "$POST_ID" ]] || fail 'NO_POST_LINK_ON_RISING'
code=$(fetch "$BASE_URL/p/$POST_ID" "$TMP/post.html" "$TMP/post.h")
[[ "$code" == 200 ]] || fail "POST_PAGE_FAILED code=$code"
grep -q 'class="age-gate"' "$TMP/post.html" || fail 'AGE_GATE_MISSING'
grep -qi '^cache-control:.*no-store' "$TMP/post.h" || fail 'POST_CACHE_CONTROL_UNSAFE'
grep -qF "rel=\"canonical\" href=\"$BASE_URL/p/$POST_ID\"" "$TMP/post.html" || fail 'POST_CANONICAL_MISSING'
code=$(fetch "$BASE_URL/sitemap.xml" "$TMP/sitemap.xml" "$TMP/sitemap.h")
[[ "$code" == 200 ]] && grep -q '<urlset' "$TMP/sitemap.xml" || fail 'SITEMAP_FAILED'

# ---------- 成功：基準の更新と後片付け ----------
trap - ERR INT TERM HUP
cp "$TMP/new.sha256" "$STATE/baseline.sha256.tmp" && mv "$STATE/baseline.sha256.tmp" "$STATE/baseline.sha256"
echo "$REMOTE_SHA deployed $NEW_BUILD" > "$STATE/last-sha"; rm -f "$STATE/failed-sha"
log "DEPLOY_COMPLETE github=$REMOTE_SHA new_build=$NEW_BUILD previous_runtime_backup=$BACKUP_BASE"
# 自動反映が作った古い世代だけ整理する（新しい4世代は残す。他の xclip-* は触らない）
KEEP=4
for pattern in 'xclip-twizou-auto' 'xclip-before-twizou-auto'; do
  ls -dt "$ACCOUNT/$pattern".?????? 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    [[ -d "$old" && ! -L "$old" && "$old" != "$STAGE" && "$old" != "$BACKUP_BASE" && "$(cat "$LIVE/DEPLOY_SOURCE")" != "$old/source" ]] || continue
    rm -rf -- "$old" && log "OLD_GENERATION_REMOVED $(basename "$old")"
  done || true
done
exit 0
