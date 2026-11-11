#!/usr/bin/env bash
# twizou 自動反映の設置（Cron は入れない。本番も変更しない）
#   使い方: curl -fsSL <この install.sh のURL> | bash -s -- <反映スクリプトのコミットSHA>
set -Eeuo pipefail
umask 077
SHA="${1:-}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo 'USAGE: install.sh <40-char commit sha>'; exit 2; }
RAW_BASE="${TWIZOU_RAW_BASE:-https://raw.githubusercontent.com/x-ranks/xcliprank}"
STATE="${TWIZOU_ACCOUNT:-$HOME}/.twizou-auto-deploy"
mkdir -p "$STATE"
curl -fsSL --connect-timeout 10 --max-time 60 -o "$STATE/deploy.sh.new" "$RAW_BASE/$SHA/tools/auto-deploy/twizou-auto-deploy.sh"
bash -n "$STATE/deploy.sh.new"
chmod 700 "$STATE/deploy.sh.new"
mv "$STATE/deploy.sh.new" "$STATE/deploy.sh"
echo "INSTALLED $STATE/deploy.sh sha256=$(sha256sum "$STATE/deploy.sh" | cut -d' ' -f1) commit=$SHA"
[[ -f "$STATE/baseline.sha256" ]] || "$STATE/deploy.sh" --init-baseline
echo '--- 現在の本番とGitHubの差（何も変更しません） ---'
"$STATE/deploy.sh" --check || true
echo 'INSTALL_DONE; cron is NOT enabled'
