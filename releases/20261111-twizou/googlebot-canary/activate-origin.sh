#!/usr/bin/env bash
set -euo pipefail
umask 077
account=/home/rbxfxmfd
node="$account/.local/node/node-v22.23.2-linux-x64/bin/node"
edge="$account/twizou-googlebot-production-canary-20261110-edge"
[[ $# -eq 1 && $1 =~ ^[0-9]{10}$ ]] || {
  echo 'USAGE: bash activate-origin.sh CANARY_UNTIL'; exit 1;
}
until=$1
status=$(bash "$edge/observe-origin.sh" status)
if ! grep -qx 'ORIGIN_CANARY_MODE=observe' <<< "$status" ||
   ! grep -Eq '^VERIFIED_GOOGLEBOT_PROOFS=[1-9][0-9]*$' <<< "$status"; then
  printf '%s\n' "$status"
  echo 'ACTIVE_REQUIRES_OBSERVED_GOOGLEBOT'; exit 1
fi

STATE="$account/.xclip-edge-production-canary-v1" EXPECTED_UNTIL="$until" "$node" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dir = process.env.STATE;
const file = path.join(dir, 'enabled.json');
const now = Math.floor(Date.now() / 1000);
const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
if (settings.mode !== 'observe' || !/^[a-f0-9]{64}$/.test(settings.secret ?? '') ||
    !Number.isSafeInteger(settings.started) || settings.started > now ||
    settings.until !== Number(process.env.EXPECTED_UNTIL) ||
    settings.until <= now || settings.until - now > 86400) {
  throw Error('ACTIVE_OBSERVATION_WINDOW_INVALID');
}

const next = path.join(dir, 'active-' + randomUUID());
fs.writeFileSync(next, JSON.stringify({ ...settings, mode: 'active', started: now }) + '\n',
  { mode: 0o600, flag: 'wx' });
try {
  fs.renameSync(next, file);
} finally {
  if (fs.existsSync(next)) fs.unlinkSync(next);
}
console.log('ORIGIN_CANARY_MODE=active');
console.log('ACTIVE_SINCE_UTC=' + new Date(now * 1000).toISOString());
console.log('CANARY_UNTIL=' + settings.until);
NODE
