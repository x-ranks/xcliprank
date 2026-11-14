'use strict';
// UI refresh: bottom tabs (visibility + active tab), slim header search icon, video-page action row, author chips.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
function load(file, stubs) { const m = { exports: {} }; new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText)(n => stubs[n] ?? require(n), m, m.exports); return m.exports; }
let current = '/';
const Link = ({ children, href, prefetch, ...p }) => React.createElement('a', { href, ...p }, children);
const tabs = load('app/components/BottomTabs.tsx', { 'next/link': Link, 'next/navigation': { usePathname: () => current } });
const html = p => { current = p; return renderToStaticMarkup(React.createElement(tabs.default)); };
for (const p of ['/', '/rising', '/ranking/daily', '/browse', '/discover', '/tags/x', '/accounts/a', '/months/2026-10', '/following', '/favorites', '/p/1850123456789012345']) assert(html(p).includes('メインメニュー'), p + ' shows the tabs');
for (const p of ['/privacy', '/contact', '/removal-request', '/ranking-admin']) assert.equal(html(p), '', p + ' has no tabs');
assert(html('/rising').includes('href="/rising" aria-current="page"') && !html('/rising').includes('href="/discover?mode=search" aria-current'));
assert.equal(tabs.activeTab('/accounts/x'), null); assert.equal(tabs.activeTab('/months'), null); assert.equal(tabs.activeTab('/following'), null); assert.equal(tabs.activeTab('/favorites'), '/favorites'); assert.equal(tabs.activeTab('/p/1'), null);
assert.equal(tabs.activeTab('/'), '/'); assert.equal(tabs.activeTab('/browse'), '/'); assert.equal(tabs.activeTab('/ranking/weekly'), '/ranking/daily'); assert.equal(tabs.activeTab('/reels'), null); assert.equal(tabs.activeTab('/download/iphone'), '/download');
assert.equal(tabs.activeTab('/discover'), '/discover?mode=search'); assert.equal(tabs.activeTab('/discover', 'search'), '/discover?mode=search'); assert.equal(tabs.activeTab('/discover', 'random'), null); assert.equal(tabs.activeTab('/discover', 'tier'), null);
for (const t of ['急上昇', 'ランキング', '新着', 'お気に入り', '検索', '動画保存']) assert(html('/').includes(`<span>${t}</span>`));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
assert(read('app/layout.tsx').includes('<BottomTabs />'));
// Six tabs (MENU is in the page header); the sheet (closed on first render) holds the rest and is a labelled dialog when opened.
assert.equal((html('/').match(/<span>/g) || []).length, 6);
const tabSrc = read('app/components/BottomTabs.tsx'); for (const s of ['ランダム', '投稿者一覧', 'Tierで探す', '月別ランキング', 'フォロー新着', 'お気に入り・履歴', 'URLから保存', 'iPhoneでの保存方法', 'Androidでの保存方法', 'role="dialog"']) assert(tabSrc.includes(s), s + ' is in the MENU sheet');
assert(!html('/').includes('role="dialog"'), 'MENU sheet starts closed');
assert(read('app/components/SiteBrand.tsx').includes('className="site-search-icon"') && read('app/components/SiteBrand.tsx').includes('aria-label="動画を検索"'));
// Video page: save, favorite, share, then a "more" menu holding original post / author page / report.
const page = read('app/p/[id]/page.tsx'), viewer = read('app/components/PublicDetailViewer.tsx'), post = read('app/components/PostActionBar.tsx'), at = s => post.indexOf(s);
assert(page.includes('<PostActionBar video={v} />') && viewer.includes('<PostActionBar video={v} />'), 'page and in-list viewer share the same action bar');
assert(viewer.indexOf('<DirectPlaybackVideo') < viewer.indexOf('<h1>{v.authorName') && viewer.indexOf('<h1>{v.authorName') < viewer.indexOf('post-author-follow') && viewer.indexOf('post-author-follow') < viewer.indexOf('<PostActionBar'), 'viewer: player, title, follow, actions');
assert(at('<VideoDownloadButton') < at('<FavoriteButton') && at('<FavoriteButton') < at('share-to-x') && at('share-to-x') < at('post-report') && at('post-report') < at('post-more'));
const menu = post.slice(at('post-more-menu'), at('</details>'));
for (const s of ['元投稿をXで開く', '投稿者ページを見る']) assert(menu.includes(s), s + ' is in the more menu');
// Reporting is one click: a visible button in the bar itself, not an item inside the "more" menu.
assert(!menu.includes('/removal-request'), 'report is not hidden in the more menu');
const report = post.slice(at('post-report') - 20, at('post-more'));
assert(report.includes('/removal-request?post=${v.id}') && report.includes('aria-label="この動画を報告する"') && report.includes('rel="nofollow"'), 'visible report button links to the form with the post id');
assert(page.indexOf('<h1>') > page.indexOf('public-post-player') && page.includes('className="post-breadcrumb"') && viewer.includes('className="post-breadcrumb"'));
// Author page: three chips, videos before the long data section.
const acc = read('app/accounts/[key]/page.tsx');
assert(acc.includes('className="author-chips"') && acc.indexOf('<PublicVideoCards') < acc.indexOf('{dataSection}') && acc.indexOf('{dataSection}') < acc.indexOf('d.relatedAuthors'));
// Only the phone layout hides the old header links; wide screens keep them.
const css = read('app/globals.css'); assert(/\.site-search-icon, \.bottom-tabs, \.bottom-tabs-spacer \{ display:none; \}/.test(css) && /@media \(max-width:720px\) \{[^]*\.bottom-tabs \{ position:fixed/.test(css));
console.log('PASS UI REFRESH: tabs visibility/active, search icon, video action row and more menu, author chips and order, phone-only CSS. Fixture only.');
