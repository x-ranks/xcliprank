'use strict';
// Card byline date + device-specific save guides (/download/iphone, /download/android). Fixture only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const opts = { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } };
Module._extensions['.ts'] = (m, f) => m._compile(ts.transpileModule(fs.readFileSync(f, 'utf8'), opts).outputText, f);
const { cardDate } = require('../lib/public-video-core.ts');

// Date helper: JST, same year short, other year full, invalid -> null.
const now = new Date('2026-11-14T00:00:00+09:00');
assert.deepEqual(cardDate('2026-11-10T15:30:00Z', now).text, '11/11'); // 00:30 JST on the 11th
assert.equal(cardDate('2026-11-10T14:59:00Z', now).text, '11/10');
assert.equal(cardDate('2025-03-05T00:00:00Z', now).text, '2025/3/5');
assert.equal(cardDate('2026-12-31T16:00:00Z', new Date('2026-12-31T16:00:00Z')).text, '1/1'); // JST new year
assert.equal(cardDate('not a date', now), null);
assert.equal(cardDate(null, now), null);
assert.equal(cardDate('', now), null);
assert.match(cardDate('2026-11-10T00:00:00Z', now).iso, /^2026-11-10T00:00:00\.000Z$/);

// Card markup keeps the existing numbers line and adds the date to the byline.
const cards = read('app/components/PublicVideoCards.tsx');
assert(cards.includes('public-card-byline') && cards.includes('<time className="public-card-date"') && cards.includes('cardDate(v.createdAt)'));
assert(cards.includes('public-card-x-stats') && cards.includes('X表示 '));
assert(/\.public-card-date/.test(read('app/globals.css')));

// Guide pages: render with a stubbed next/link.
const guideSrc = ts.transpileModule(read('app/download/DeviceGuide.tsx'), opts).outputText;
const m = { exports: {} };
new Function('require', 'module', 'exports', guideSrc)(n => n === 'next/link' ? { __esModule: true, default: ({ href, children, ...p }) => React.createElement('a', { href, ...p }, children) } : require(n), m, m.exports);
for (const device of ['iphone', 'android']) {
  const src = read(`app/download/${device}/page.tsx`);
  assert(src.includes(`alternates: { canonical: "/download/${device}" }`), device + ' canonical');
  assert(!/robots\s*:/.test(src), device + ' stays indexable');
  const title = src.match(/const TITLE = "([^"]+)"/)[1];
  assert(title.length <= 60, device + ' title length ' + title.length);
}
const html = renderToStaticMarkup(React.createElement(m.exports.default, { device: 'iphone', heading: 'H', lead: 'L', browser: 'B', steps: [{ title: 's1', body: 'b1' }], whereTitle: 'W', where: ['w1'], faqs: [{ q: 'q1', a: 'a1' }], official: { href: 'https://example.com', label: 'o' } }));
for (const v of ['<h1>H</h1>', 'href="/download"', 'href="/download-policy"', 'href="/download/android"', 'href="/rising"', 'noopener noreferrer']) assert(html.includes(v), v);
assert.equal((html.match(/<h1/g) || []).length, 1, 'single h1');
const html2 = renderToStaticMarkup(React.createElement(m.exports.default, { device: 'android', heading: 'H', lead: 'L', browser: 'B', steps: [], whereTitle: 'W', where: [], faqs: [], official: { href: 'https://example.com', label: 'o' } }));
assert(html2.includes('href="/download/iphone"'));

// Wiring: public paths, engagement allowlist, sitemap, internal links.
for (const p of ['/download/iphone', '/download/android']) {
  assert(read('middleware.ts').includes(`"${p}"`), 'middleware ' + p);
  assert(read('lib/engagement-navigation.ts').includes(`"${p}"`), 'engagement ' + p);
  assert(read('app/sitemap.ts').includes('SITE_URL}' + p), 'sitemap ' + p);
  assert(read('app/components/SiteFooter.tsx').includes(`href="${p}"`), 'footer ' + p);
  assert(read('app/download/page.tsx').includes(`href="${p}"`), 'download page ' + p);
}
console.log('PASS CARD META + SAVE GUIDES: JST card date, one h1 per guide, canonical/indexable, middleware/sitemap/footer wiring. Fixture only.');
