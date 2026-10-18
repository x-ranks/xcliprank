'use strict';
const fs = require('node:fs'), path = require('node:path');
// Amend only the two previously deployed API deny rules. All other bytes remain.
function amend(before) {
  let current = before;
  for (const [guard, extra, required] of [
    ['RewriteCond %{REQUEST_METHOD} !^(GET|HEAD)$ [NC]', ['public-label-admin', 'public-save-event'], ['engagement', 'contact-requests', 'removal-requests', 'collect-curated-author']],
    ['RewriteCond %{REQUEST_URI} ^/api/ [NC]', ['public-video', 'public-label-admin', 'public-save-event'], ['rankings', 'reels', 'video', 'engagement', 'engagement-stats']],
  ]) {
    let matches = 0;
    const pattern = /^(\s*RewriteCond\s+%\{REQUEST_URI\}\s+!\^\/api\/\()([a-z0-9|\-]+)(\)\(\/\|\$\)\s+\[NC\][ \t]*)$/gm;
    current = current.replace(pattern, (line, start, names, end, offset) => {
      const previous = current.slice(0, offset).trimEnd().split(/\r?\n/).at(-1)?.trim();
      if (previous !== guard) return line;
      const following = current.slice(offset + line.length).trimStart().split(/\r?\n/)[0]?.trim();
      const list = names.split('|');
      if (following !== 'RewriteRule ^ - [F,L]' || required.some(n => !list.includes(n)) || new Set(list).size !== list.length) throw Error('UNEXPECTED_API_ALLOWLIST; public unchanged');
      matches++;
      return start + [...list, ...extra.filter(n => !list.includes(n))].join('|') + end;
    });
    if (matches !== 1) throw Error('API_ALLOWLIST_MATCH_COUNT_' + matches + '; public unchanged');
  }
  return current;
}
function run(action, target, folder) {
  const check = () => { const s = fs.lstatSync(target); if (!s.isFile() || s.uid !== process.getuid() || (s.mode & 0o777) !== 0o644) throw Error('HTACCESS_MUST_BE_OWNED_REGULAR_FILE_MODE_644'); };
  check();
  const beforePath = path.join(folder, 'htaccess.before'), afterPath = path.join(folder, 'htaccess.after');
  function atomic(bytes) {
    check(); const temp = target + '.xclip-public-pages-' + process.pid; let fd;
    try {
      fd = fs.openSync(temp, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fchmodSync(fd, 0o644); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temp, target); check(); if (!fs.readFileSync(target).equals(bytes)) throw Error('HTACCESS_WRITE_MISMATCH');
    } finally { if (fd !== undefined) fs.closeSync(fd); if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  if (action === 'prepare') {
    const before = fs.readFileSync(target), after = Buffer.from(amend(before.toString('utf8')));
    fs.writeFileSync(beforePath, before, { flag: 'wx', mode: 0o600 }); fs.writeFileSync(afterPath, after, { flag: 'wx', mode: 0o600 });
    console.log('PUBLIC_PAGES_API_ALLOWLIST_PREPARED; public unchanged');
  } else if (action === 'check-installed') {
    const now = fs.readFileSync(target, 'utf8'); if (amend(now) !== now) throw Error('PUBLIC_PAGES_API_ALLOWLIST_MISSING');
    console.log('PUBLIC_PAGES_API_ALLOWLIST_VERIFIED; MODE=644');
  } else if (action === 'apply' || action === 'restore' || action === 'verify') {
    const before = fs.readFileSync(beforePath), after = fs.readFileSync(afterPath), now = fs.readFileSync(target);
    if (!Buffer.from(amend(before.toString('utf8'))).equals(after)) throw Error('HTACCESS_PREPARED_BYTES_MISMATCH');
    if (action === 'apply') {
      if (!now.equals(before)) throw Error('HTACCESS_CHANGED_EXTERNALLY; apply stopped');
      if (!before.equals(after)) atomic(after);
      console.log('PUBLIC_PAGES_API_ALLOWLIST_APPLIED; MODE=644');
    } else if (action === 'restore') {
      if (now.equals(before)) console.log('HTACCESS_ORIGINAL_IN_PLACE; MODE=644');
      else if (now.equals(after)) { atomic(before); console.log('HTACCESS_ROLLBACK_COMPLETE; MODE=644'); }
      else throw Error('HTACCESS_CHANGED_EXTERNALLY; restore skipped to preserve newer settings');
    } else if (!now.equals(after)) throw Error('HTACCESS_CHANGED_EXTERNALLY; verify failed');
  } else throw Error('INVALID_HTACCESS_ACTION');
}
module.exports = { amend, run };
if (require.main === module) { try { run(...process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; } }
