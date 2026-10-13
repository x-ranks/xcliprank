#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
export PATH="$(dirname "$NODE"):$PATH"
[[ "$#" -le 1 && ( "${1:-}" == "" || "${1:-}" == "--once" || "${1:-}" == "--wait" ) ]] || { echo 'FREE_CURATED_COLLECTOR_INVALID_ARGUMENT'; exit 2; }
if [[ "${1:-}" == "--wait" ]]; then
 for ((attempt=1;attempt<=96;attempt++)); do
  if /bin/bash "$0" --once; then exit 0; else result=$?; fi
  [[ "$result" == 3 || "$result" == 4 ]] || exit "$result"
  [[ "$attempt" != 96 ]] || break
  echo 'XCLIP_FX_RANDOM_FIVE_WAITING; next eligibility check in15minutes; no forced retries; Ctrl+C stops waiting'
  sleep 900
 done
 echo 'XCLIP_FX_RANDOM_FIVE_WAIT_TIMEOUT; no success claimed'; exit 3
fi
exec 9> "$ACCOUNT/.xclip-free-curated-collector.lock"
flock -n 9 || { echo 'XCLIP_FX_RANDOM_FIVE_COLLECTOR_BUSY; no scan started'; exit 4; }
if ! LOCATIONS_TEXT=$(ACCOUNT="$ACCOUNT" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),a=process.env.ACCOUNT;
const ht=fs.readFileSync(path.join(a,'public_html/.htaccess'),'utf8');
const roots=[...ht.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
if(roots.length!==1||!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/runtime$/.test(roots[0][1]))throw Error('UNEXPECTED_RUNTIME');
const runtime=roots[0][1],source=fs.readFileSync(path.join(runtime,'DEPLOY_SOURCE'),'utf8').trim();
if(!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/source$/.test(source)||
 fs.readFileSync(path.join(source,'.next/BUILD_ID'),'utf8').trim()!==fs.readFileSync(path.join(runtime,'.next/BUILD_ID'),'utf8').trim())throw Error('MONITOR_SOURCE_MISMATCH');
console.log(runtime);console.log(source);
JS
); then
 echo 'FREE_CURATED_COLLECTOR_RUNTIME_LOOKUP_FAILED; no scan started'
 exit 1
fi
readarray -t LOCATIONS <<< "$LOCATIONS_TEXT"
unset LOCATIONS_TEXT
[[ "${#LOCATIONS[@]}" == 2 ]] || { echo 'FREE_CURATED_COLLECTOR_RUNTIME_NOT_FOUND'; exit 1; }
RUNTIME="${LOCATIONS[0]}"
SOURCE="${LOCATIONS[1]}"
[[ -f "$SOURCE/scripts/scan-free-curated.cjs" ]] || { echo 'FREE_CURATED_COLLECTOR_NOT_SUPPORTED_BY_RUNTIME'; exit 1; }
SOURCE="$SOURCE" "$NODE" <<'VERIFY_CODE'
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const expected={"lib/fx-curated-scan.ts": "252ab29ce5ece0c17761e6fe09dcb574758fc91e45acd21570ee8050dcc5cb84", "lib/fx-curated-state.ts": "a969d227e69596700a5b9660f5a7b38c32fde575593ae2c07efe74e9c7f95d00", "lib/fxtwitter-curated.ts": "41a0ebaac09b2995bd5a5d0da84f53f14ca8c8eb5a1b4f2517131655e9e9460e", "scripts/scan-free-curated.cjs": "00e9c212ab5059dd95f39988289c1fd9c4e2d3c38f4b189ab9f99a44090ede85"};
for(const[n,h]of Object.entries(expected)){
 const b=fs.readFileSync(path.join(process.env.SOURCE,n));const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
 if(hash(b)!==h&&hash(b.toString('utf8').replace(/\r\n/g,'\n'))!==h)throw Error('FX_TIMELINE_FIX_CODE_MISMATCH; no scan started');
}
console.log('XCLIP_FX_RANDOM_FIVE_CODE_OK; same rolling quota and locks; real Fx/DB calls only when eligible');
VERIFY_CODE
cd "$SOURCE"
exec "$NODE" --env-file="$RUNTIME/.env.production" scripts/scan-free-curated.cjs --verify-random-five
