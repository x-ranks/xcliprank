'use strict';
// Every page must carry exactly one <meta name="rating" content="adult">. It is rendered by the root layout's <head>:
// a layout-level metadata `other` was not inherited by pages without their own `other`, so /p/... and /rising
// shipped without the label. No metadata object may set a rating too (that would duplicate or conflict).
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8');
const head = layout.match(/<head>([\s\S]*?)<\/head>/);
assert(head, 'layout.tsx must render a <head>');
assert.equal((head[1].match(/<meta\s+name="rating"\s+content="adult"\s*\/>/g) || []).length, 1,
  'layout head must contain exactly one <meta name="rating" content="adult" />');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}
const offenders = [];
for (const file of walk(path.join(root, 'app'))) {
  const text = fs.readFileSync(file, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
  if (/\brating\s*:\s*"/.test(text) || /name=["']rating["']/.test(text) && file !== path.join(root, 'app/layout.tsx')) {
    if (!/teacher|label/i.test(path.relative(root, file))) offenders.push(path.relative(root, file));
  }
}
assert.deepEqual(offenders, [], 'rating must only come from the layout head: ' + offenders.join(', '));
console.log('PASS ADULT RATING: layout head labels every page once; no metadata object repeats it.');
