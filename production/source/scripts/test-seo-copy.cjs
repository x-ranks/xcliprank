'use strict';
// Ranking page guide text, /accounts social metadata and the /download heading. Source assertions only; no network.
const assert = require('node:assert/strict'), fs = require('node:fs');
const read = f => fs.readFileSync(f, 'utf8');
const ranking = read('app/components/DedicatedRankingPage.tsx');
for (const s of ['このランキングの見方', '動画の見かた・使いかた', 'よくある質問', 'className="seo-faq"', 'href="/download"', 'href="/download-policy"', 'href="/removal-request"', 'copy.reading', 'copy.other'])
  assert(ranking.includes(s), 'ranking guide has ' + s);
assert.equal((ranking.match(/<details>/g) || []).length, 4, 'four FAQ entries');
const accounts = read('app/accounts/page.tsx');
assert(accounts.includes('twitter: { card: "summary_large_image"') && accounts.includes('images: [SITE_URL + "/twizou-share.png"]'), 'accounts page has twitter card and share image');
assert(accounts.includes('Twitter動画の投稿者一覧'), 'accounts title names the subject');
assert(read('app/download/DownloadForm.tsx').includes('<h1>X動画を投稿URLから保存</h1>'), 'download H1 carries the X動画 / 保存 keywords');
assert(read('app/globals.css').includes('.seo-faq details'));
console.log('PASS SEO COPY: ranking guide + FAQ, accounts social metadata, download heading. Source only.');
