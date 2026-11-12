'use strict';
// Every page must carry <meta name="rating" content="adult">. The layout supplies it, and no page
// may override it with a different value (a page-level `other` replaces the layout's).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
assert.match(layout, /other:\s*\{\s*rating:\s*"adult"\s*\}/, 'layout.tsx must set other: { rating: "adult" }');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /^page\.tsx$/.test(entry.name) ? [full] : [];
  });
}
const offenders = [];
for (const file of walk(path.join(root, 'app'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const block of text.matchAll(/\bother:\s*\{([^}]*)\}/g)) {
    if (/rating\s*:/.test(block[1]) && !/rating:\s*"adult"/.test(block[1])) offenders.push(path.relative(root, file));
  }
}
assert.deepEqual(offenders, [], 'pages must not override the adult rating: ' + offenders.join(', '));
console.log('PASS ADULT RATING: layout labels every page as adult; no page overrides it.');
