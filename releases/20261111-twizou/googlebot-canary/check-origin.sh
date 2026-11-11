#!/usr/bin/env bash
set -euo pipefail
account=/home/rbxfxmfd
htaccess="$account/public_html/.htaccess"
node="$account/.local/node/node-v22.23.2-linux-x64/bin/node"
[[ "$(id -un)" == rbxfxmfd && -x "$node" && -r "$htaccess" ]] ||
  { echo 'EXPECTED_ACCOUNT_OR_LAYOUT_MISSING'; exit 1; }

live=$(sed -n 's/^[[:space:]]*PassengerAppRoot "\([^"]*\)"[[:space:]]*$/\1/p' "$htaccess")
[[ "$live" == "$account"/xclip-*/runtime && "$live" != *$'\n'* && -d "$live" ]] ||
  { echo 'UNEXPECTED_PASSENGER_ROOT'; exit 1; }
source=$(cat "$live/DEPLOY_SOURCE")
[[ "$source" == "$account"/xclip-*/source && "$source" != *$'\n'* && -d "$source" ]] ||
  { echo 'UNEXPECTED_SOURCE_ROOT'; exit 1; }

printf 'LIVE_BUILD_ID=%s\n' "$(cat "$live/.next/BUILD_ID")"
printf 'SOURCE_BUILD_ID=%s\n' "$(cat "$source/.next/BUILD_ID")"
for file in public-response-cache.cjs install-public-response-cache.cjs verified-googlebot.cjs; do
  hash=$(sha256sum "$source/scripts/$file" | cut -d' ' -f1)
  printf 'SOURCE_%s=%s\n' "$file" "$hash"
done
cmp -s "$source/scripts/public-response-cache.cjs" "$live/twizou-public-response-cache.cjs" ||
  { echo 'LIVE_CACHE_ADAPTER_DIFFERS'; exit 1; }
cmp -s "$source/scripts/verified-googlebot.cjs" "$live/verified-googlebot.cjs" ||
  { echo 'LIVE_GOOGLEBOT_ADAPTER_DIFFERS'; exit 1; }
echo 'ORIGIN_PREFLIGHT_OK'
