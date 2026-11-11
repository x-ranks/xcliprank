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
[[ "$(sha256sum "$live/origin-pilot.cjs" | cut -d' ' -f1)" == 1caad0c1ff2ce9746bb68fc75a8fb7925c58308988b24204ae5ccd841c98eefb ]] ||
  { echo 'ORIGIN_CANARY_SHA_MISMATCH'; exit 1; }
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
    const until = now + 86300;
    const next = path.join(dir, 'settings-' + crypto.randomUUID());
    fs.writeFileSync(next, JSON.stringify({ secret, mode: 'observe', started: now, until }) + '\n',
      { mode: 0o600, flag: 'wx' });
    fs.renameSync(next, enabled);
    console.log('ORIGIN_CANARY_MODE=observe');
    console.log('CANARY_UNTIL=' + until);
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
    throw Error('USAGE: bash observe-origin.sh [init|observe|status|off]');
}
NODE
