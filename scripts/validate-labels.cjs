#!/usr/bin/env node
/* validate-labels.cjs — data/labels/*.json を SCHEMA.md に照らして検証 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LABEL_DIR = path.join(ROOT, 'data', 'labels');
const META_DIR = path.join(LABEL_DIR, 'meta');
const SCHEMA_PATH = path.join(LABEL_DIR, 'SCHEMA.md');

const errors = [];
const warns = [];
const E = (f, m) => errors.push(f + ' :: ' + m);
const W = (f, m) => warns.push(f + ' :: ' + m);

const CONF = ['high', 'med', 'low'];
const TIERS = ['s', 'a', 'b', 'c'];
const REQUIRED_ITEM = ['n','author','genre_group','framing','tags','flags','desc_ja','alt','confidence'];
const OPTIONAL_ITEM = ['tier'];
const BATCH_RE = /^(trending|daily|weekly)-(\d{1,3})-(\d{1,3})\.json$/;
const DESC_MAX = 40;

function parseSchema(md) {
  const S = { genre: [], framing: [], tags: [], flags: [] };
  let sec = 0;
  for (const line of md.split(/\r?\n/)) {
    const h = line.match(/^##\s+(\d+)\./);
    if (h) { sec = Number(h[1]); continue; }
    if (sec === 4) {
      const m = line.match(/^([a-z_]+)\s+/); if (m) S.genre.push(m[1]);
    } else if (sec === 5) {
      const m = line.match(/^([a-z_]+)\s+/); if (m) S.framing.push(m[1]);
    } else if (sec === 6) {
      const m = line.match(/^(\S+):\s+(\S.*)$/);
      if (m) S.tags.push.apply(S.tags, m[2].split(/\s+/).filter(Boolean));
    } else if (sec === 7) {
      const m = line.match(/^\|\s*([a-z_]+)\s*\|/);
      if (m && m[1] !== 'flag') S.flags.push(m[1]);
    }
  }
  return S;
}

function validateFile(file, S) {
  const full = path.join(LABEL_DIR, file);
  let data;
  try { data = JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (e) { E(file, 'JSONパース失敗: ' + e.message); return; }

  const m = file.match(BATCH_RE);
  const batch = m[1] + '-' + m[2] + '-' + m[3];
  const start = Number(m[2]);
  const end = Number(m[3]);
  const count = end - start + 1;

  ['batch','sheet','schema_version','taxonomy_version','labeled_by','labeled_at','items']
    .forEach(k => { if (!(k in data)) E(file, 'ヘッダに ' + k + ' が無い'); });

  if (data.batch && data.batch !== batch) E(file, 'batch がファイル名と不一致: ' + data.batch);
  if (!Array.isArray(data.items)) { E(file, 'items が配列でない'); return; }
  if (data.items.length !== count) E(file, 'items 件数 ' + data.items.length + '（期待 ' + count + '）');

  if (!fs.existsSync(path.join(META_DIR, batch + '.json'))) {
    W(file, 'meta が無い: data/labels/meta/' + batch + '.json');
  }

  const seen = new Set();
  data.items.forEach((it, i) => {
    const id = file + '#' + (it && it.n != null ? it.n : 'idx' + i);
    REQUIRED_ITEM.forEach(k => { if (!(k in it)) E(id, '必須フィールド欠落: ' + k); });

    if (!Number.isInteger(it.n)) { E(id, 'n が整数でない'); return; }
    if (it.n < start || it.n > end) E(id, 'n が範囲外 (' + start + '..' + end + ')');
    if (seen.has(it.n)) E(id, 'n 重複: ' + it.n);
    seen.add(it.n);

    if (it.author !== null && typeof it.author !== 'string') E(id, 'author は string か null');
    if (it.author === '') E(id, 'author は "" でなく null');
    if (it.tier !== undefined && it.tier !== null && TIERS.indexOf(it.tier) < 0) {
      E(id, 'tier が不正: ' + it.tier);
    }
    if (S.genre.indexOf(it.genre_group) < 0) E(id, 'genre_group が許可外: ' + it.genre_group);
    if (S.framing.indexOf(it.framing) < 0) E(id, 'framing が許可外: ' + it.framing);
    if (CONF.indexOf(it.confidence) < 0) E(id, 'confidence が許可外: ' + it.confidence);

    if (!Array.isArray(it.tags)) E(id, 'tags が配列でない');
    else it.tags.forEach(t => { if (S.tags.indexOf(t) < 0) E(id, 'tags が語彙外: ' + t); });

    if (typeof it.desc_ja !== 'string') E(id, 'desc_ja が文字列でない');
    else if (Array.from(it.desc_ja).length > DESC_MAX) E(id, 'desc_ja が ' + DESC_MAX + ' 字超');
    if (typeof it.alt !== 'string' || !it.alt) E(id, 'alt が空');

    if (it.flags === null || typeof it.flags !== 'object' || Array.isArray(it.flags)) {
      E(id, 'flags がオブジェクトでない');
    } else {
      Object.keys(it.flags).forEach(k => {
        const v = it.flags[k];
        if (k === 'lang_guess') {
          if (v !== null && ['ja','en','zh'].indexOf(v) < 0) E(id, 'lang_guess 不正: ' + v);
        } else if (S.flags.indexOf(k) < 0) {
          W(id, '未知の flag: ' + k);
        } else if (typeof v !== 'boolean') {
          E(id, 'flag ' + k + ' が bool でない');
        }
      });
    }
    if (it.flags && it.flags.needs_review === false && it.confidence === 'low') {
      W(id, 'confidence=low なのに needs_review が false');
    }
  });

  for (let n = start; n <= end; n++) if (!seen.has(n)) E(file, 'n 欠番: ' + n);
}

(function main() {
  if (!fs.existsSync(SCHEMA_PATH)) { console.error('SCHEMA.md が無い'); process.exit(1); }
  const S = parseSchema(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  if (!S.genre.length || !S.framing.length || !S.tags.length) {
    console.error('SCHEMA.md のパースに失敗'); process.exit(1);
  }
  console.log('語彙読込: genre ' + S.genre.length + ' / framing ' + S.framing.length +
              ' / tags ' + S.tags.length + ' / flags ' + S.flags.length);

  const files = fs.existsSync(LABEL_DIR)
    ? fs.readdirSync(LABEL_DIR).filter(f => BATCH_RE.test(f)).sort() : [];

  if (!files.length) { console.log('ラベルファイルはまだ無い。'); return; }
  files.forEach(f => validateFile(f, S));

  console.log('\nラベル検証: エラー ' + errors.length + ' / 警告 ' + warns.length);
  if (warns.length) { console.log('\n[警告]'); warns.forEach(w => console.log('  - ' + w)); }
  if (errors.length) { console.log('\n[エラー]'); errors.forEach(e => console.log('  - ' + e)); }
  process.exit(errors.length ? 1 : 0);
})();