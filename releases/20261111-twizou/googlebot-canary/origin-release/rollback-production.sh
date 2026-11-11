#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
MODE=${1:---check}; BACKUP_BASE=${2:-}
[[ $# == 2 && ( "$MODE" == --check || "$MODE" == --apply ) ]] || { echo 'USAGE: bash rollback-production.sh [--check|--apply] PREVIOUS_RUNTIME_BACKUP'; exit 2; }
[[ "$BACKUP_BASE" =~ ^/home/rbxfxmfd/xclip-before-twizou-googlebot-production-canary-v1\.[A-Za-z0-9]{6}$ && -d "$BACKUP_BASE/runtime" && ! -L "$BACKUP_BASE" && "$(realpath "$BACKUP_BASE")" == "$BACKUP_BASE" ]] || { echo 'ROLLBACK_BACKUP_PATH_INVALID'; exit 1; }
LIVE=$(HTACCESS="$ACCOUNT/public_html/.htaccess" "$NODE" <<'JS'
const fs=require('fs'),s=fs.readFileSync(process.env.HTACCESS,'utf8'),roots=[...s.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
if(roots.length!==1||!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/runtime$/.test(roots[0][1]))throw Error('UNEXPECTED_APP_ROOT');
console.log(roots[0][1]);
JS
)
verify(){
 LIVE="$LIVE" BACKUP_BASE="$BACKUP_BASE" "$NODE" <<'JS'
const fs=require('fs'),p=require('path'),e=process.env,read=f=>fs.readFileSync(f,'utf8').trim();
const current=read(p.join(e.LIVE,'.next/BUILD_ID')),old=read(p.join(e.BACKUP_BASE,'runtime/.next/BUILD_ID'));
const activeSource=read(p.join(e.LIVE,'DEPLOY_SOURCE'));
if(!/^\/home\/rbxfxmfd\/xclip-twizou-googlebot-production-canary-v1\.[A-Za-z0-9]{6}\/source$/.test(activeSource))throw Error('ROLLBACK_CURRENT_RELEASE_MISMATCH');
if(old!=='v7x4e-MKe1YsYzV5EHK3l'||read(p.join(e.LIVE,'DEPLOY_COMMIT'))!==current||read(p.join(e.LIVE,'public/twizou-speed-v5-version.txt'))!==current)throw Error('ROLLBACK_BUILD_MISMATCH');
for(const runtime of [e.LIVE,p.join(e.BACKUP_BASE,'runtime')]){
 const stat=fs.lstatSync(runtime);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('ROLLBACK_RUNTIME_INVALID');
 const source=read(p.join(runtime,'DEPLOY_SOURCE'));if(!source.startsWith('/home/rbxfxmfd/')||read(p.join(source,'.next/BUILD_ID'))!==read(p.join(runtime,'.next/BUILD_ID')))throw Error('ROLLBACK_SOURCE_MISMATCH');
}
console.log('ROLLBACK_PRECHECK_OK current='+current+' previous='+old);
JS
}
verify
[[ "$MODE" == --apply ]] || exit 0
LOCK="$ACCOUNT/.xclip-production-deploy.lock"
mkdir "$LOCK" 2>/dev/null || { echo 'DEPLOYMENT_BUSY'; exit 1; }
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
exec 7> "$ACCOUNT/.xclip-author-monitor.lock"; flock -w 3600 7 || { echo 'AVAILABILITY_WORKER_BUSY'; exit 1; }
exec 8> "$ACCOUNT/.xclip-free-curated-collector.lock"; flock -w 60 8 || { echo 'COLLECTOR_BUSY'; exit 1; }
exec 6> "$ACCOUNT/.xclip-rising-refresh.lock"; flock -w 60 6 || { echo 'RISING_REFRESH_BUSY'; exit 1; }
verify
SAVED=$(mktemp -d "$ACCOUNT/xclip-twizou-googlebot-production-canary-rollback.XXXXXX")
SWITCHED=0
stop_cwd(){ local root="$1" pid; for pid in $(ps -u rbxfxmfd -o pid=,comm= | awk '$2 ~ /^(next-server|node)/ {print $1}'); do [[ "$(readlink "/proc/$pid/cwd" 2>/dev/null)" != "$root" ]] || kill -TERM "$pid" 2>/dev/null || true; done; }
recover(){
 trap - ERR INT TERM
 if [[ "$SWITCHED" == 1 ]]; then
  if [[ -d "$LIVE" ]]; then stop_cwd "$LIVE"; mv "$LIVE" "$SAVED/failed-previous-runtime"; fi
  mv "$SAVED/runtime" "$LIVE"; mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
  echo 'ROLLBACK_FAILED_FORWARD_RUNTIME_RESTORED'
 fi
 echo "ROLLBACK_FAILED inspect=$SAVED"; exit 1
}
trap recover ERR INT TERM
mv "$LIVE" "$SAVED/runtime"; SWITCHED=1
mv "$BACKUP_BASE/runtime" "$LIVE"
mkdir -p "$LIVE/tmp"; touch "$LIVE/tmp/restart.txt"
stop_cwd "$SAVED/runtime"
VERIFIED=0
for attempt in $(seq 1 20); do
 code=$(curl -sS --connect-timeout 5 --max-time 15 -o "$SAVED/version.txt" -w '%{http_code}' "https://twizou.net/twizou-speed-v5-version.txt?rollback=$(date +%s)-$attempt") || code=000
 if [[ "$code" == 200 && "$(cat "$SAVED/version.txt")" == 'v7x4e-MKe1YsYzV5EHK3l' ]]; then VERIFIED=1; break; fi
 sleep 2
done
[[ "$VERIFIED" == 1 ]] || recover
echo "ROLLED_BACK_RUNTIME_BACKUP=$SAVED"
echo 'TWIZOU_GOOGLEBOT_CANARY_ORIGIN_ROLLBACK_COMPLETE; previous runtime restored; crontab unchanged'
