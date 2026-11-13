'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '..');
function load(file, resolve = require) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true
  } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(resolve, module, module.exports);
  return module.exports;
}

const { videoMetadata } = load('lib/public-video-core.ts', name =>
  name === './indexability' ? load('lib/indexability.ts') : require(name));
const video = {
  id: '2096572807497060638', handle: 'example', authorName: 'Sample',
  authorId: '1', createdAt: '2026-10-11T02:00:00.000Z', text: 'Sample source caption https://t.co/x',
  posterUrl: null, sourceHash: 'fixture', eligible: true
};
const labels = [{ id: '1', name: '撮影テスト', active: true }];
const pilot = videoMetadata(video, null, labels);
const baseline = videoMetadata({ ...video, id: '2119291393604825164' }, null, labels);
assert.match(pilot.description, /^SampleのX動画｜2026年10月11日｜タグ：撮影テスト｜元の投稿文：Sample source caption$/);
assert.match(baseline.description, /^Sample source caption｜タグ：/);
assert.equal(pilot.title, baseline.title);
assert.equal(pilot.index, baseline.index);
assert.equal(pilot.canonical, 'https://twizou.net/p/' + video.id);
assert.doesNotMatch(videoMetadata({ ...video, eligible: false }, null, labels).description, /元の投稿文/);

const anchor = ({ href, children, prefetch, ...rest }) => React.createElement('a', { href, ...rest }, children);
const Brand = load('app/components/SiteBrand.tsx', name => name === 'next/link' ? anchor : require(name)).default;
const full = renderToStaticMarkup(React.createElement(Brand, { showSearch: true }));
const compact = renderToStaticMarkup(React.createElement(Brand));
const form = full.match(/<form[^>]*>/)?.[0] ?? '';
for (const attr of ['action="/discover"', 'method="get"', 'role="search"']) assert(form.includes(attr), attr);
assert.match(full, /name="mode" value="search"/);
assert.match(full, /type="search"[^>]*name="q"/);
assert.match(full, /ランダム/);
assert.doesNotMatch(compact, /<form/);
assert.match(compact, /href="\/discover\?mode=search"/);
assert.match(compact, /href="\/rising"/);

const Cards = load('app/components/PublicVideoCards.tsx', name => {
  if (name === 'next/link') return anchor;
  if (name.endsWith('PublicPostLink')) return ({ children, id }) => React.createElement('a', { href: '/p/' + id }, children);
  if (name.endsWith('public-video-core')) return { authorHref: () => '/accounts/example', cardDate: () => null };
  if (name.startsWith('./')) return () => null;
  return require(name);
}).default;
const cards = renderToStaticMarkup(React.createElement(Cards, { videos: [
  { ...video, views: 0 },
  { ...video, id: '2119291393604825164', views: 123, likes: 3, bookmarks: 4 }
] }));
assert.doesNotMatch(cards, /X表示 0/);
assert.match(cards, /X表示 123/);
assert.match(cards, /ブックマーク 4/);
assert.match(cards, /class="public-card-x-likes">いいね 3/);
console.log('SEARCH_UX_FIXTURE_OK');

