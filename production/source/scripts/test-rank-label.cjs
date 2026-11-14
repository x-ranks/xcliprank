'use strict';
// One rank label on every ranking card: bottom-left (card text row), yellow, top 5 stronger, crown only for 1st. Source + CSS assertions.
const assert = require('node:assert/strict'), fs = require('node:fs');
const ranking = fs.readFileSync('app/components/RankingClient.tsx', 'utf8'), cards = fs.readFileSync('app/components/PublicVideoCards.tsx', 'utf8'), css = fs.readFileSync('app/globals.css', 'utf8');
assert.ok(!ranking.includes('className="rank-badge"'), '24h/weekly no longer draw the top-left badge');
assert.ok(ranking.indexOf('<div className="author-row">') < ranking.indexOf('<RankLabel rank={p.ranking_position ?? index + 1} />'), 'rank sits in the bottom text row');
for (const src of [ranking, cards]) {
  assert.ok(src.includes('rank <= 5 ? "public-card-rank public-card-rank-top" : "public-card-rank"'), 'top 5 emphasis');
  assert.ok(src.includes('rank === 1 ? <span className="public-card-crown" aria-hidden="true">👑</span> : null'), 'crown for 1st only');
  assert.ok(src.includes('{rank}位</b>'), 'same "N位" text');
}
assert.match(css, /\.public-card-rank \{[^}]*color:#ffd666/); assert.match(css, /\.public-card-rank-top \{/); assert.match(css, /\.public-card-rank\[data-rank="1"\]/);
assert.ok(css.includes('.author-row .public-card-rank { display:inline-flex; }'), 'not hidden by the mobile author-row span rule');
assert.ok(/\.public-card-rank \{[^}]*flex:none[^}]*white-space:nowrap/.test(css) && css.includes('.public-card-byline .public-card-date { flex:none; white-space:nowrap; }') && css.includes('.public-card-byline { flex-wrap:nowrap; }'), 'rank and date never wrap into a vertical column on phones');
assert.ok(css.includes('.author-row .public-card-crown { display:inline;'), 'crown survives the mobile author-row span rule');
console.log('PASS RANK LABEL: same bottom-left yellow rank on all ranking cards, top-5 emphasis, crown for 1st.');
