#!/usr/bin/env node
/* setup-labels.cjs — meta整備 → 検証 を1コマンドで */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHEET_DIR = path.join(ROOT, 'out', 'contact-sheets');
const LABEL_DIR = path.join(ROOT, 'data', 'labels');
const META_DIR = path.join(LABEL_DIR, 'meta');

if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

// --- 1. サイドカーを meta/ にコピー ---
let copied = 0, kept = 0;
if (fs.existsSync(SHEET_DIR)) {
  for (const f of fs.readdirSync(SHEET_DIR)) {
    const m = f.match(/^contact-((?:trending|daily|weekly)-\d{1,3}-\d{1,3})\.json$/);
    if (!m) continue;
    const dest = path.join(META_DIR, m[1] + '.json');
    if (fs.existsSync(dest)) { kept++; continue; }
    fs.copyFileSync(path.join(SHEET_DIR, f), dest);
    console.log('meta作成: ' + m[1] + '.json');
    copied++;
  }
}
console.log('meta: 新規' + copied + ' / 既存' + kept);

// --- 2. ラベルとmetaの突き合わせ ---
const labels = fs.existsSync(LABEL_DIR)
  ? fs.readdirSync(LABEL_DIR).filter(f => /^(trending|daily|weekly)-\d{1,3}-\d{1,3}\.json$/.test(f))
  : [];
const metas = fs.readdirSync(META_DIR).map(f => f.replace(/\.json$/, ''));
const labelBases = new Set(labels.map(f => f.replace(/\.json$/, '')));

console.log('\nラベルファイル ' + labels.length + ' 件:');
labels.sort().forEach(f => console.log('  OK  ' + f));

const noLabel = metas.filter(b => !labelBases.has(b));
if (noLabel.length) {
  console.log('\n[metaはあるがラベルが無い — ここを埋めれば完成]');
  noLabel.forEach(b => console.log('  --> data/labels/' + b + '.json'));
}

// --- 3. 検証を実行 ---
console.log('\n===== 検証 =====');
try {
  execFileSync(process.execPath, [path.join(__dirname, 'validate-labels.cjs')], { stdio: 'inherit' });
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}