#!/usr/bin/env bash
set -Eeuo pipefail
NODE=/home/rbxfxmfd/.local/node/node-v22.23.2-linux-x64/bin/node
[[ -x "$NODE" ]] || { echo 'XCLIP_FX_PATROL_DIAGNOSTIC_FAILED: EXPECTED_NODE_MISSING'; exit 1; }
exec "$NODE" - "$@" <<'XCLIP_FX_DIAGNOSTIC_JS'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
function regular(file, maximum = 2 * 1024 * 1024) {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > maximum ||
      (typeof process.getuid === 'function' && s.uid !== process.getuid())) throw Error('UNSAFE_INPUT_FILE');
  return fs.readFileSync(file);
}
const number = n => Number.isSafeInteger(n) && n >= 0 ? n : null;
const time = n => number(n) && n < 8640000000000000 ? new Date(n).toISOString() : null;
function reason(text) {
  if (typeof text !== 'string') return null;
  if (text.includes('同一投稿者の投稿一覧')) return 'TIMELINE_IDENTITY_OR_DUPLICATE_CHECK';
  if (text.includes('取得基準がありません')) return 'INITIAL_BASELINE_MISSING';
  if (text.includes('投稿一覧が空')) return 'EMPTY_TIMELINE';
  if (text.includes('ページ送り')) return 'CURSOR_INVALID_OR_NOT_PROGRESSING';
  if (text.includes('429') || text.includes('取得制限')) return 'RATE_LIMIT';
  return 'OTHER_ERROR_REDACTED';
}
function inspect(account, expected, clock = Date.now()) {
  account = path.resolve(account);
  if (fs.realpathSync(account) !== account) throw Error('ACCOUNT_PATH_UNEXPECTED');
  const ht = regular(path.join(account, 'public_html/.htaccess')).toString('utf8');
  const roots = [...ht.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
  if (roots.length !== 1) throw Error('RUNTIME_NOT_UNIQUE');
  function tree(p, leaf) {
    p = path.resolve(p);
    if (!/^xclip-[^\\/\r\n]+[\\/](?:runtime|source)$/.test(path.relative(account, p)) ||
        path.basename(p) !== leaf || fs.realpathSync(p) !== p) throw Error('UNEXPECTED_DEPLOY_PATH');
    return p;
  }
  const runtime = tree(roots[0][1], 'runtime');
  const source = tree(regular(path.join(runtime, 'DEPLOY_SOURCE')).toString('utf8').trim(), 'source');
  const buildId = regular(path.join(runtime, '.next/BUILD_ID')).toString('utf8').trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId) || buildId !== regular(path.join(source, '.next/BUILD_ID')).toString('utf8').trim()) throw Error('BUILD_ID_MISMATCH');
  const report = { diagnostic: 'xclip-fx-patrol-readonly-20261013', runtime, source, buildId, buildMatches: true,
    checkedAtUtc: time(clock), codeChecks: {}, providerRequests: 0, databaseRequests: 0, stateChanges: false };
  for (const [n, digest] of Object.entries(expected)) {
    const b = regular(path.join(source, n));
    report.codeChecks[n] = { sha256: sha(b), matchesRelease: sha(b) === digest || sha(b.toString('utf8').replace(/\r\n/g, '\n')) === digest };
  }
  if (Object.values(report.codeChecks).some(v => !v.matchesRelease)) {
    report.stateInspection = 'SKIPPED_UNKNOWN_CODE'; return report;
  }
  // Read just the configured directory name. Never expose environment names/values or execute app code.
  const env = parseEnv(regular(path.join(runtime, '.env.production')).toString('utf8'));
  const directory = env.XCLIP_FREE_CURATED_STATE_DIR || path.join(account, '.xclip-free-curated');
  if (!path.isAbsolute(directory) || directory.includes('\n') || directory.includes('\r') ||
      !path.relative(account, directory) || path.relative(account, directory).startsWith('..') ||
      path.isAbsolute(path.relative(account, directory)) || fs.realpathSync(directory) !== directory) throw Error('UNSAFE_STATE_DIRECTORY');
  const files = ['state-v1.json', 'x-api-v1.json', 'fx-patrol-v1.json'];
  const snapshots = files.map(n => {
    const file = path.join(directory, n);
    if (!fs.existsSync(file)) return { file, bytes: null, value: null };
    const bytes = regular(file); return { file, bytes, value: JSON.parse(bytes.toString('utf8')) };
  });
  const [state, x, fx] = snapshots.map(s => s.value);
  if (!state || state.version !== 1 || !Array.isArray(state.authors) || state.authors.length > 100 ||
      state.authors.some(a => !/^\d{2,20}$/.test(a.id) || !/^[a-z0-9_]{1,15}$/i.test(a.username))) throw Error('STATE_FORMAT_UNEXPECTED');
  if ((x && (x.version !== 1 || !Array.isArray(x.reservations))) ||
      (fx && (fx.version !== 1 || !fx.positions || typeof fx.positions !== 'object'))) throw Error('STATE_FORMAT_UNEXPECTED');
  report.stateInspection = 'READ_ONLY_SNAPSHOT';
  report.lastRun = state.lastRun ? {
    atUtc: time(state.lastRun.at), finishedAtUtc: time(state.lastRun.finishedAt),
    outcome: ['running','completed','skipped','paused','error'].includes(state.lastRun.outcome) ? state.lastRun.outcome : null,
    processed: number(state.lastRun.processed), fetched: number(state.lastRun.fetched), saved: number(state.lastRun.saved), failed: number(state.lastRun.failed)
  } : null;
  report.fx = fx ? { attempts: number(fx.attempts), requests: number(fx.requests), responseItems: number(fx.rawPosts) } : null;
  report.activeRolling24hReservations = x ? x.reservations.filter(r => number(r.at) !== null && r.at > clock - 86400000 && r.at <= clock).length : null;
  report.nextBatchAtUtc = time(state.nextBatchAt);
  report.recentAuthors = [...state.authors].sort((a,b) => b.checkedAt-a.checkedAt).slice(0,12).map(a => ({
    username: a.username, checkedAtUtc: time(a.checkedAt), nextEligibleAtUtc: time(a.nextCheckAt),
    fetched: number(a.metrics?.lastFetched), saved: number(a.metrics?.lastSaved),
    lastSuccessAtUtc: time(a.metrics?.lastSuccessAt), errorClass: reason(a.lastError),
    hasLegacyBaseline: !!(a.latestId || a.baselineId || a.initialBaselineId),
    hasFxPosition: !!fx?.positions[a.id], hasPendingFxCursor: !!fx?.positions[a.id]?.cursor
  }));
  for (const s of snapshots) {
    if (s.bytes ? !s.bytes.equals(regular(s.file)) : fs.existsSync(s.file)) throw Error('STATE_CHANGED_DURING_READ');
  }
  report.environmentScope = 'runtime file only; Cron inherited environment not inspected';
  report.responseComposition = 'NOT_RECORDED; no live provider probe; identity mismatch cause not yet confirmed';
  return report;
}
function main(account, expected, args) {
  try {
    if (args.length) throw Error('INVALID_ARGUMENT');
    console.log(JSON.stringify(inspect(account, expected), null, 2));
    console.log('XCLIP_FX_PATROL_READONLY_DIAGNOSTIC_COMPLETE; no provider/DB requests or changes');
  } catch(e) {
    const allowed = new Set(['UNSAFE_INPUT_FILE','ACCOUNT_PATH_UNEXPECTED','RUNTIME_NOT_UNIQUE','UNEXPECTED_DEPLOY_PATH','BUILD_ID_MISMATCH',
      'UNSAFE_STATE_DIRECTORY','STATE_FORMAT_UNEXPECTED','STATE_CHANGED_DURING_READ','INVALID_ARGUMENT']);
    console.error('XCLIP_FX_PATROL_DIAGNOSTIC_FAILED: ' + (allowed.has(e.message) ? e.message : 'INPUT_UNREADABLE_OR_PARSE_FAILED') + '; no raw errors or secrets printed');
    process.exitCode = 1;
  }
}
module.exports = { inspect, reason, main };

// ENTRYPOINT
main("/home/rbxfxmfd",{"lib/fx-curated-scan.ts": "0c3e67520f52d015ede4855b088e60f45811243c71f1a55f17df1be865990b17", "lib/fx-curated-state.ts": "ab371ab620da26c92d360e2357f5267df13d011383057a0968bafcaa05641530", "lib/free-curated-scan.ts": "53dbf8d867f93da2276af3dc33cda7a615f15bbba2dfb1ded1f1c07b6d4c57e3", "lib/fxtwitter-curated.ts": "028945a4db60bfc9066193501cea36ed0242877e5fccf31c4cc7d767c6d997cc", "scripts/scan-free-curated.cjs": "70fcd041cc8c1225d7da988f9b07f881ad2ab50c9bd79966b47f909aef14ea5a"},process.argv.slice(2));
XCLIP_FX_DIAGNOSTIC_JS
