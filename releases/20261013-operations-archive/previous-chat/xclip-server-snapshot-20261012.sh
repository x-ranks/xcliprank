#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
ENGINE="$HERE/xclip-snapshot-20261012.cjs"
[[ -x "$NODE" && -f "$ENGINE" ]] || { echo 'BACKUP_TOOL_MISSING'; exit 1; }
[[ ! -e "$ACCOUNT/.xclip-production-deploy.lock" && ! -e "$ACCOUNT/.xclip-free-download-deploy.lock" ]] || { echo 'DEPLOYMENT_BUSY'; exit 1; }
# Exclude deployment and both scheduled collectors, without altering their schedules.
mkdir "$ACCOUNT/.xclip-production-deploy.lock" || { echo 'DEPLOYMENT_BUSY'; exit 1; }
cleanup() { unset XCLIP_BACKUP_PASSWORD; rmdir "$ACCOUNT/.xclip-production-deploy.lock" 2>/dev/null || true; }
trap cleanup EXIT
exec 7> "$ACCOUNT/.xclip-author-monitor.lock"
flock -n 7 || { echo 'AVAILABILITY_BUSY_RETRY_LATER'; exit 1; }
exec 8> "$ACCOUNT/.xclip-free-curated-collector.lock"
flock -n 8 || { echo 'COLLECTOR_BUSY_RETRY_LATER'; exit 1; }
RUNTIME=$(ACCOUNT="$ACCOUNT" "$NODE" -e 'const fs=require("fs"),path=require("path"),a=process.env.ACCOUNT;const t=fs.readFileSync(path.join(a,"public_html/.htaccess"),"utf8"),m=[...t.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];if(m.length!==1||!m[0][1].startsWith(a+"/"))throw Error("UNEXPECTED_APP_ROOT");console.log(m[0][1]);')
[[ -f "$RUNTIME/.env.production" ]] || { echo 'RUNTIME_ENV_MISSING'; exit 1; }
printf 'Close local management and avoid changes until this backup finishes. Type YES: '
read -r READY
[[ "$READY" == YES ]] || exit 1
printf 'Backup passphrase (12+ characters, keep it for restore): '
read -rs XCLIP_BACKUP_PASSWORD; printf '\n'
export XCLIP_BACKUP_PASSWORD
mkdir -p "$ACCOUNT/xclip-backups"
DEST="$ACCOUNT/xclip-backups/server-$(date -u +%Y%m%dT%H%M%SZ)-$$"
"$NODE" --env-file="$RUNTIME/.env.production" "$ENGINE" server "$ACCOUNT" "$DEST"
echo 'COPY_ENCRYPTED_BACKUP_OFF_SERVER; SHARE_ONLY_SAFE_REPORT'
