'use strict';
// hls.js is ~0.6 MB of JavaScript. It must only be fetched when an HLS stream is actually played,
// never as part of the first load of the ranking pages.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'vendor' || entry.name === 'node_modules' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}
const staticImport = /^\s*import\s+(?!type\b)[^;]*?from\s+["'][^"']*vendor\/hls\.mjs["']/m;
const offenders = [...walk(path.join(root, 'app')), ...walk(path.join(root, 'lib'))]
  .filter(file => staticImport.test(fs.readFileSync(file, 'utf8')))
  .map(file => path.relative(root, file));
assert.deepEqual(offenders, [], 'hls.js must be loaded with import(), not a static import: ' + offenders.join(', '));
for (const file of ['app/components/ExternalVideo.tsx', 'lib/browser-stream-playback.ts']) {
  assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /import\(\s*["'][^"']*vendor\/hls\.mjs["']\s*\)/, file + ' must load hls.js on demand');
}
console.log('PASS LAZY HLS: no static hls.js import in app/ or lib/; ExternalVideo and stream playback load it on demand.');
