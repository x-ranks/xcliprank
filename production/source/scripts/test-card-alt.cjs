'use strict';
// Ranking card thumbnails: alt text names the author and the posting date (JST) instead of repeating a rank sentence.
const assert = require('node:assert/strict'), fs = require('node:fs');
const src = fs.readFileSync('app/components/RankingClient.tsx', 'utf8');
assert(src.includes('function thumbnailAlt(p: RankPost)') && src.includes('alt={thumbnailAlt(p)}'), 'cards use thumbnailAlt');
assert(!src.includes('の動画（ランキング'), 'old rank-sentence alt is gone');
const body = src.slice(src.indexOf('function thumbnailAlt'), src.indexOf('\n}\n', src.indexOf('function thumbnailAlt')) + 3);
const fn = new Function(body.replace('(p: RankPost)', '(p)') + '; return thumbnailAlt;')();
assert.equal(fn({ author_name: 'テスト', author_username: 'test', created_at: '2026-11-10T16:00:00Z' }), 'テストのX動画（11月11日の投稿）', 'JST date (UTC+9 crosses midnight)');
assert.equal(fn({ author_name: null, author_username: 'user1', created_at: '2026-01-05T00:00:00Z' }), 'user1のX動画（1月5日の投稿）');
assert.equal(fn({ author_name: null, author_username: null, created_at: 'broken' }), '投稿者のX動画', 'bad date falls back');
console.log('PASS CARD ALT: author + JST date, no rank sentence, safe fallback.');
