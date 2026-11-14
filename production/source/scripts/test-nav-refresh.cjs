'use strict';
// Navigation refresh: flat header menu, active marker, author cards (thumbnails/sort) and the data behind them. Fixture only.
const fs = require('fs'), path = require('path'), Module = require('module'), ts = require('typescript'), assert = require('assert/strict'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
Module._extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
function loadTsx(file, resolve) { const m = { exports: {} }; new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText)(n => resolve(n) ?? require(n), m, m.exports); return m.exports; }
const Link = ({ children, href, prefetch, ...p }) => React.createElement('a', { href, ...p }, children);
(async () => {
  // Header: eight text links in order, current page marked, search kept.
  const Brand = loadTsx('app/components/SiteBrand.tsx', n => n === 'next/link' ? Link : undefined).default;
  const html = renderToStaticMarkup(React.createElement(Brand, { showSearch: true, active: 'accounts' }));
  const nav = html.match(/<nav class="site-discovery-nav"[^]*?<\/nav>/)[0];
  assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map(m => m[1]), ['急上昇', 'ランキング', '新着', '投稿者', '月別', 'Tier', 'ランダム', 'フォロー']);
  assert.equal((nav.match(/aria-current="page"/g) || []).length, 1); assert(/href="\/accounts" aria-current="page">投稿者/.test(nav));
  for (const href of ['/rising', '/ranking/daily', '/', '/accounts', '/months', '/discover?mode=tier', '/discover?mode=random', '/following']) assert(nav.includes(`href="${href}"`), href);
  assert(html.includes('role="search"') && html.includes('class="site-search-icon"') && html.includes('href="/favorites"') && html.includes('Xで新着情報'));
  assert.equal(renderToStaticMarkup(React.createElement(Brand)).includes('aria-current'), false);

  // Data: cards carry post count, total views and the three newest thumbnails; ordered by post count.
  const { createPublicVideoService } = require('../lib/public-video-service.ts'), { blankCatalog } = require('../lib/public-video-core.ts');
  const hash = 'a'.repeat(64), mk = (id, handle, day, views, poster) => ({ id, authorId: handle, handle, authorName: handle.toUpperCase(), text: 'test ' + id, posterUrl: poster, videoUrl: 'https://video.twimg.com/' + id + '.mp4', createdAt: `2026-10-${day}T00:00:00Z`, sourceHash: hash, eligible: true, views });
  const rows = [mk('101', 'aaa', '01', 10, 'https://pbs.twimg.com/1.jpg'), mk('102', 'aaa', '02', 20, 'https://pbs.twimg.com/2.jpg'), mk('103', 'aaa', '03', 30, 'https://pbs.twimg.com/3.jpg'), mk('104', 'aaa', '04', 40, 'https://pbs.twimg.com/4.jpg'), mk('105', 'bbb', '05', 5, null), mk('106', 'bbb', '06', 6, 'https://pbs.twimg.com/6.jpg'), { ...mk('107', 'ccc', '07', 1, 'https://pbs.twimg.com/7.jpg'), eligible: false }];
  const catalog = blankCatalog();
  const service = createPublicVideoService({ catalog: { read: async () => catalog }, indexVideos: async () => rows, posts: async ids => rows.filter(v => ids.includes(v.id)), authorVideos: async () => [], candidates: async () => [], secret: async () => '' });
  const cards = await service.accountCards(), index = await service.indexable();
  assert.deepEqual(cards.map(c => c.key), index.accounts.map(a => a.key).sort((a, b) => cards.find(c => c.key === b).count - cards.find(c => c.key === a).count || a.localeCompare(b)), 'same accounts as the sitemap index, most posts first');
  assert(!cards.some(c => c.key === 'ccc'), 'ineligible video never shows an author');
  const a = cards.find(c => c.key === 'aaa'); assert.equal(a.count, 4); assert.equal(a.views, 100); assert.deepEqual(a.thumbs.map(t => t.id), ['104', '103', '102']); assert.equal(a.name, 'AAA');
  const b = cards.find(c => c.key === 'bbb'); if (b) assert.deepEqual(b.thumbs.map(t => t.id), ['106'], 'posts without an image add no thumbnail');

  // Page: thumbnails, counts, sort links; only the default sort is indexed; paging keeps the sort.
  const many = Array.from({ length: 45 }, (_, i) => ({ key: 'u' + String(i).padStart(2, '0'), name: 'User ' + i, count: 100 - i, views: i * 1000, latest: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`, thumbs: [{ id: '9' + i, url: 'https://pbs.twimg.com/m/' + i + '.jpg' }] }));
  const resolve = n => {
    if (n === 'next/link') return Link;
    if (n === 'next/navigation') return { notFound() { throw Error('NOT_FOUND'); } };
    if (n.endsWith('public-video-server')) return { readPublicAccountCards: async () => many };
    if (n.endsWith('public-list-pages')) return require('../lib/public-list-pages.ts');
    if (n.endsWith('/seo')) return { SITE_URL: 'https://twizou.net' };
    if (n.endsWith('SiteBrand')) return loadTsx('app/components/SiteBrand.tsx', r => r === 'next/link' ? Link : undefined).default;
    if (n.endsWith('PublicThumbnail')) return ({ src, alt }) => React.createElement('img', { src, alt });
    return undefined;
  };
  const page = loadTsx('app/accounts/page.tsx', resolve);
  const first = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
  assert.equal((first.match(/class="account-card"/g) || []).length, 40); assert(first.includes('投稿 100') && first.includes('合計表示 0') === false && first.includes('src="https://pbs.twimg.com/m/0.jpg"'));
  assert(first.includes('aria-current="page"') && first.includes('href="/accounts?page=2"') && first.includes('投稿者一覧</h1>') && first.includes('全45件'));
  const viewsSorted = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({ sort: 'views' }) }));
  assert(viewsSorted.indexOf('/accounts/u44') < viewsSorted.indexOf('/accounts/u43'), 'sorted by total views');
  assert(viewsSorted.includes('href="/accounts?page=2&amp;sort=views"'));
  assert.equal((await page.generateMetadata({ searchParams: Promise.resolve({}) })).robots.index, true);
  assert.equal((await page.generateMetadata({ searchParams: Promise.resolve({ sort: 'views' }) })).robots.index, false);
  assert.equal((await page.generateMetadata({ searchParams: Promise.resolve({ sort: 'views', page: '2' }) })).alternates.canonical, 'https://twizou.net/accounts?page=2');
  await assert.rejects(page.default({ searchParams: Promise.resolve({ page: '3' }) }), /NOT_FOUND/);

  // CSS: pinned header (sticky), full-width background, six-tab phone bar with MENU sheet.
  const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  assert(/\.site-brand-band \{ position: sticky; top: 0;/.test(css) && /display: contents/.test(css) && /\.menu-sheet-backdrop \{ position: fixed/.test(css));
  // Phones: no wide child box (it caused sideways scrolling and pushed the layout past the phone breakpoint), top ranking tabs hidden.
  assert(!/\.site-brand-band::before/.test(css) && /\.site-brand-band \{[^}]*box-shadow: 0 0 0 100vmax/.test(css), 'full-width header background uses a shadow, not a wide box');
  assert(/@media \(max-width: 720px\) \{[^]*\.ranking-page-nav\[aria-label="ランキングを選択"\] \{ display: none; \}/.test(css), 'phone hides the top ranking tabs');
  console.log('PASS NAV REFRESH: header links/current marker, author cards (thumbs, counts, sort, noindex), sticky/MENU CSS. Fixture only.');
})().catch(e => { console.error(e); process.exit(1); });
