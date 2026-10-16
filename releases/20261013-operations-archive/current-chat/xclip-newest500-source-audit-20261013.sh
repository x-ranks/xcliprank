#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
NODE=/home/rbxfxmfd/.local/node/node-v22.23.2-linux-x64/bin/node
[[ -x "$NODE" ]] || { echo 'EXPECTED_NODE_MISSING; application unchanged'; exit 1; }
XCLIP_AUDIT_ACCOUNT=/home/rbxfxmfd "$NODE" <<'XCLIP_AUDIT_JS'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const FILES = [
  'lib/ranking-liquidity.ts',
  'app/api/rankings/route.ts',
  'lib/initial-ranking.ts',
  'lib/seo.ts',
  'app/page.tsx',
  'app/components/RankingClient.tsx',
  'app/components/DedicatedRankingPage.tsx',
  'app/globals.css',
  'app/ranking/daily/page.tsx',
  'app/ranking/weekly/page.tsx',
  'scripts/test-ranking-liquidity-route.cjs',
];

function audit(account) {
  account = path.resolve(account);
  const reads = new Map();
  function inside(file) {
    const rel = path.relative(account, file);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('PATH_OUTSIDE_ACCOUNT');
    for (let p = file; p !== account; p = path.dirname(p)) {
      if (fs.lstatSync(p).isSymbolicLink()) throw Error('SYMLINK_REFUSED');
    }
  }
  function read(file, max = 1024 * 1024) {
    inside(file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > max) throw Error('UNSAFE_SOURCE_FILE');
    if (process.getuid && stat.uid !== process.getuid()) throw Error('FILE_OWNER_MISMATCH');
    const bytes = fs.readFileSync(file);
    reads.set(file, hash(bytes));
    return bytes.toString('utf8');
  }
  const htaccess = path.join(account, 'public_html/.htaccess');
  const roots = [...read(htaccess).matchAll(/^\s*PassengerAppRoot\s+"([^"\r\n]+)"\s*$/gm)];
  if (roots.length !== 1) throw Error('ONE_PASSENGER_APP_ROOT_REQUIRED');
  const runtime = path.resolve(roots[0][1]);
  inside(runtime);
  const runtimeRel = path.relative(account, runtime).split(path.sep).join('/');
  if (!/^xclip-[^/]+\/runtime$/.test(runtimeRel)) throw Error('UNEXPECTED_RUNTIME');
  const buildId = read(path.join(runtime, '.next/BUILD_ID'), 256).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId)) throw Error('INVALID_BUILD_ID');
  const source = path.resolve(read(path.join(runtime, 'DEPLOY_SOURCE'), 4096).trim());
  inside(source);
  const sourceRel = path.relative(account, source).split(path.sep).join('/');
  if (!/^xclip-[^/]+(?:\/source)?$/.test(sourceRel)) throw Error('UNEXPECTED_SOURCE');
  if (read(path.join(source, '.next/BUILD_ID'), 256).trim() !== buildId) throw Error('BUILD_ID_MISMATCH');
  const files = FILES.map(rel => {
    const content = read(path.join(source, rel));
    // Refuse literal credentials; environment variable names/references are allowed.
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) ||
        /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/.test(content) ||
        /(?:postgres(?:ql)?|mysql):\/\/[^\s/:]+:[^\s@]+@/i.test(content) ||
        /(?:X_BEARER_TOKEN|CRON_SECRET|SUPABASE_SERVICE_ROLE_KEY|DATABASE_PASSWORD)\s*[:=]\s*["'`][^"'`\r\n]{12,}["'`]/.test(content)) {
      throw Error('POSSIBLE_LITERAL_SECRET_REFUSED');
    }
    return { path: rel, sha256: hash(Buffer.from(content)), content };
  });
  for (const [file, digest] of reads) {
    inside(file);
    if (hash(fs.readFileSync(file)) !== digest) throw Error('SOURCE_CHANGED_DURING_AUDIT');
  }
  return {
    diagnostic: 'xclip-newest500-source-audit-20261013',
    capturedAtUtc: new Date().toISOString(),
    runtime, source, buildId, buildMatches: true,
    files,
    providerRequests: 0, databaseQueries: 0, databaseWrites: 0,
    applicationChanges: false, environmentFilesRead: false,
    privatePatrolStateRead: false,
    note: 'Only the explicit ranking source allowlist is included; no .env, DB data or patrol state.',
  };
}

module.exports = { audit, FILES };

// CLI ENTRY
try {
  const account = process.env.XCLIP_AUDIT_ACCOUNT;
  if (!account) throw Error('ACCOUNT_REQUIRED');
  const report = audit(account);
  const name = 'xclip-newest500-source-20261013-' + Date.now() + '-' + crypto.randomUUID().slice(0, 8) + '.json';
  const file = path.join(account, name);
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('XCLIP_NEWEST500_SOURCE_AUDIT_OK');
  console.log('BUILD_ID=' + report.buildId);
  console.log('SOURCE_FILES=' + report.files.length);
  console.log('SHARE_FILE=' + file);
  console.log('NO_DB_OR_PROVIDER_REQUESTS; application/env/cron/private-state unchanged');
} catch (error) {
  const allowed = /^(?:PATH_OUTSIDE_ACCOUNT|SYMLINK_REFUSED|UNSAFE_SOURCE_FILE|FILE_OWNER_MISMATCH|ONE_PASSENGER_APP_ROOT_REQUIRED|UNEXPECTED_RUNTIME|INVALID_BUILD_ID|UNEXPECTED_SOURCE|BUILD_ID_MISMATCH|POSSIBLE_LITERAL_SECRET_REFUSED|SOURCE_CHANGED_DURING_AUDIT|ACCOUNT_REQUIRED)$/;
  const reason = allowed.test(String(error.message)) ? error.message : error.code === 'ENOENT' ? 'REQUIRED_SOURCE_FILE_MISSING' : 'READ_OR_REPORT_WRITE_FAILED';
  console.error('XCLIP_NEWEST500_SOURCE_AUDIT_FAILED: ' + reason + '; application unchanged');
  process.exitCode = 1;
}
XCLIP_AUDIT_JS
