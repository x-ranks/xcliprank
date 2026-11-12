#!/usr/bin/env bash
set -euo pipefail
umask 077
account=/home/rbxfxmfd
node="$account/.local/node/node-v22.23.2-linux-x64/bin/node"
state="$account/.xclip-edge-production-canary-v1"
mode=status
if [[ $# -gt 0 ]]; then mode=$1; fi
[[ "$(id -un)" == rbxfxmfd && -x "$node" && $# -le 1 ]] || {
  echo 'EXPECTED_ACCOUNT_OR_NODE_MISSING'; exit 1;
}
live=$(sed -n 's/^[[:space:]]*PassengerAppRoot "\([^"]*\)"[[:space:]]*$/\1/p' "$account/public_html/.htaccess")
[[ "$live" == "$account"/xclip-*/runtime && "$live" != *$'\n'* && -f "$live/origin-pilot.cjs" ]] ||
  { echo 'EXPECTED_ORIGIN_CANARY_NOT_INSTALLED'; exit 1; }
source=$(cat "$live/DEPLOY_SOURCE" 2>/dev/null || true)
[[ "$source" == "$account"/xclip-*/source && "$source" != *$'\n'* && -f "$source/scripts/origin-pilot.cjs" ]] ||
  { echo 'EXPECTED_DEPLOY_SOURCE_MISSING'; exit 1; }
if ! cmp -s "$source/scripts/origin-pilot.cjs" "$live/origin-pilot.cjs"; then
  echo 'ORIGIN_CANARY_NOT_UP_TO_DATE_WITH_SOURCE'
  echo "LIVE_SHA=$(sha256sum "$live/origin-pilot.cjs" | cut -d' ' -f1)"
  echo "SOURCE_SHA=$(sha256sum "$source/scripts/origin-pilot.cjs" | cut -d' ' -f1)"
  exit 1
fi
grep -q 'MAX_WINDOW_SECONDS' "$live/origin-pilot.cjs" || { echo 'ORIGIN_CANARY_NOT_SITE_WIDE_VERSION'; exit 1; }
MODE="$mode" STATE="$state" "$node" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = process.env.STATE;
const secretFile = path.join(dir, 'secret');
const enabled = path.join(dir, 'enabled.json');
const nonceDir = path.join(dir, 'nonces');
const now = Math.floor(Date.now() / 1000);

function assertPrivate(location, isDir) {
  const stat = fs.lstatSync(location);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0 ||
      !(isDir ? stat.isDirectory() : stat.isFile())) throw Error('ORIGIN_CANARY_STATE_UNSAFE');
}

switch (process.env.MODE) {
  case 'init':
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.mkdirSync(nonceDir, { mode: 0o700 });
    fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
    console.log('ORIGIN_CANARY_SECRET_READY');
    break;
  case 'observe': {
    assertPrivate(dir, true);
    assertPrivate(nonceDir, true);
    assertPrivate(secretFile, false);
    const secret = fs.readFileSync(secretFile, 'utf8').trim();
    if (!/^[a-f0-9]{64}$/.test(secret)) throw Error('ORIGIN_CANARY_SECRET_INVALID');
    const until = now + 30 * 86400 - 100;
    const next = path.join(dir, 'settings-' + crypto.randomUUID());
    fs.writeFileSync(next, JSON.stringify({ secret, mode: 'observe', started: now, until }) + '\n',
      { mode: 0o600, flag: 'wx' });
    fs.renameSync(next, enabled);
    console.log('ORIGIN_CANARY_MODE=observe');
    console.log('CANARY_UNTIL=' + until);
    break;
  }
  case 'renew': {
    assertPrivate(dir, true);
    assertPrivate(enabled, false);
    const current = JSON.parse(fs.readFileSync(enabled, 'utf8'));
    if (!['observe', 'active'].includes(current.mode) || !/^[a-f0-9]{64}$/.test(current.secret ?? '') ||
        !Number.isSafeInteger(current.started)) throw Error('ORIGIN_CANARY_CONFIG_INVALID');
    const until = now + 30 * 86400 - 100;
    const next = path.join(dir, 'settings-' + crypto.randomUUID());
    fs.writeFileSync(next, JSON.stringify({ ...current, until }) + '\n', { mode: 0o600, flag: 'wx' });
    fs.renameSync(next, enabled);
    console.log('ORIGIN_CANARY_MODE=' + current.mode);
    console.log('CANARY_UNTIL=' + until);
    console.log('CANARY_UNTIL_UTC=' + new Date(until * 1000).toISOString());
    break;
  }
  case 'status': {
    assertPrivate(dir, true);
    assertPrivate(nonceDir, true);
    if (!fs.existsSync(enabled)) { console.log('ORIGIN_CANARY_MODE=off'); break; }
    assertPrivate(enabled, false);
    const s = JSON.parse(fs.readFileSync(enabled, 'utf8'));
    if (!['observe','active'].includes(s.mode) || !Number.isSafeInteger(s.started) ||
        !Number.isSafeInteger(s.until)) throw Error('ORIGIN_CANARY_CONFIG_INVALID');
    const times = fs.readdirSync(nonceDir).filter(name => /^\d{10}\.[a-f0-9-]{36}$/.test(name))
      .map(name => Number(name.slice(0, 10))).filter(time => time >= s.started - 5 && time <= s.until + 5);
    console.log('ORIGIN_CANARY_MODE=' + (s.until > now ? s.mode : 'expired'));
    console.log('ORIGIN_CANARY_UNTIL_UTC=' + new Date(s.until * 1000).toISOString());
    console.log('VERIFIED_GOOGLEBOT_PROOFS=' + times.length);
    if (times.length) console.log('LATEST_PROOF_UTC=' + new Date(Math.max(...times) * 1000).toISOString());
    break;
  }
  case 'off':
    assertPrivate(dir, true);
    if (fs.existsSync(enabled)) { assertPrivate(enabled, false); fs.unlinkSync(enabled); }
    console.log('ORIGIN_CANARY_MODE=off');
    break;
  default:
    throw Error('USAGE: bash observe-origin.sh [init|observe|renew|status|off]');
}
NODE
