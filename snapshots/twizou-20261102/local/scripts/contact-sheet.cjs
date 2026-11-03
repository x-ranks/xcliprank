#!/usr/bin/env node
/**
 * コンタクトシート生成
 * サムネイルを1枚の画像にまとめて、番号を振る。AIにまとめて見せる用。
 *
 * 使い方:
 *   node scripts/contact-sheet.cjs
 *   node scripts/contact-sheet.cjs --range daily --start 65
 *   node scripts/contact-sheet.cjs --cols 8 --rows 8 --tile 240
 */
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const API = process.env.CONTACT_SHEET_API || "https://twizou.net/api/rankings";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
}
const num = (n, d) => {
  const v = Number(arg(n, NaN));
  return Number.isFinite(v) ? v : d;
};

const RANGE = String(arg("range", "trending"));
const START = Math.max(1, num("start", 1));
const COLS = Math.max(1, Math.min(12, num("cols", 8)));
const ROWS = Math.max(1, Math.min(12, num("rows", 8)));
const TILE_W = Math.max(120, num("tile", 240));
const GAP = 8;
const PAD = 16;
const TILE_H = Math.round(TILE_W * 16 / 9);
const PER_SHEET = COLS * ROWS;

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "out", "contact-sheets");
const FILE_IN = arg("file", null);

function get(url, type, depth) {
  depth = depth || 0;
  if (depth > 5) return Promise.reject(new Error("リダイレクトが深すぎ: " + url));
  return new Promise((res, rej) => {
    const req = https.get(
      url,
      { headers: { "user-agent": "xclip-contact-sheet/1.0" } },
      (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          return get(r.headers.location, type, depth + 1).then(res, rej);
        }
        if (r.statusCode !== 200) {
          r.resume();
          return rej(new Error(url + " -> HTTP " + r.statusCode));
        }
        const c = [];
        r.on("data", (d) => c.push(d));
        r.on("end", () => {
          const buf = Buffer.concat(c);
          if (type === "json") {
            try { res(JSON.parse(buf.toString("utf8"))); }
            catch (e) { rej(new Error("JSONとして読めない: " + url)); }
          } else res(buf);
        });
      }
    );
    req.on("error", rej);
    req.setTimeout(30000, () => { req.destroy(); rej(new Error("timeout: " + url)); });
  });
}

function pickThumb(p) {
  return (
    p.preview_image_url || p.thumbnail_url || p.preview_url || p.image_url || null
  );
}

async function pool(items, size, fn) {
  let i = 0;
  const out = new Array(items.length);
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  let sharp;
  try { sharp = require("sharp"); }
  catch { console.error("sharp がありません。先に  npm install  を実行してください。"); process.exit(1); }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  let posts = [];
  if (FILE_IN) {
    console.log("ファイルから読み込み: " + FILE_IN);
    const raw = JSON.parse(fs.readFileSync(path.resolve(ROOT, String(FILE_IN)), "utf8"));
    posts = Array.isArray(raw) ? raw : raw.data || [];
  } else {
    const url = API + "?range=" + RANGE;
    console.log("ランキングを取得: " + url);
    const json = await get(url, "json");
    posts = Array.isArray(json) ? json : json.data || [];
  }
  if (!posts.length) {
    console.error("投稿が0件でした。--range daily を試すか、APIの形を確認してください。");
    process.exit(1);
  }
  console.log("取得: " + posts.length + " 件");

  const slice = posts.slice(START - 1, START - 1 + PER_SHEET);
  if (!slice.length) {
    console.error("start=" + START + " が件数を超えています（全 " + posts.length + " 件）");
    process.exit(1);
  }
  console.log("このシートに載せる: " + slice.length + " 件（番号 " + START + " 〜 " + (START + slice.length - 1) + "）");

  const tiles = await pool(slice, 6, async (p, k) => {
    const label = String(START + k);
    const thumb = pickThumb(p);
    let base = null;
    if (thumb) {
      for (let attempt = 0; attempt < 2 && !base; attempt++) {
        try {
          const buf = await get(thumb, "bin");
          base = await sharp(buf)
            .flatten({ background: "#0b0e14" })
            .resize(TILE_W, TILE_H, { fit: "contain", background: "#0b0e14" })
            .png()
            .toBuffer();
        } catch { /* 次を試す */ }
      }
    }
    if (!base) {
      base = await sharp({
        create: { width: TILE_W, height: TILE_H, channels: 3, background: "#1a2230" }
      }).png().toBuffer();
    }
    const badge = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + TILE_W + '" height="30">' +
      '<rect width="' + TILE_W + '" height="30" fill="#000000" fill-opacity="0.75"/>' +
      '<text x="7" y="22" font-family="DejaVu Sans, Segoe UI, Arial, sans-serif" ' +
      'font-size="19" font-weight="700" fill="#22d3ee">' + label + '</text>' +
      '</svg>'
    );
    return sharp(base).composite([{ input: badge, top: 0, left: 0 }]).png().toBuffer();
  });

  const rowsUsed = Math.ceil(tiles.length / COLS);
  const sheetW = PAD * 2 + COLS * TILE_W + (COLS - 1) * GAP;
  const sheetH = PAD * 2 + rowsUsed * TILE_H + (rowsUsed - 1) * GAP;

  const comps = tiles.map((t, k) => ({
    input: t,
    left: PAD + (k % COLS) * (TILE_W + GAP),
    top: PAD + Math.floor(k / COLS) * (TILE_H + GAP)
  }));

  const sheet = await sharp({
    create: { width: sheetW, height: sheetH, channels: 3, background: "#05070b" }
  }).composite(comps).png({ compressionLevel: 9 }).toBuffer();

  const from = START;
  const to = START + tiles.length - 1;
  const stem = "contact-" + RANGE + "-" + from + "-" + to;
  const pngPath = path.join(OUT_DIR, stem + ".png");
  const jsonPath = path.join(OUT_DIR, stem + ".json");
  fs.writeFileSync(pngPath, sheet);
  fs.writeFileSync(jsonPath, JSON.stringify({
    range: RANGE,
    from: from,
    to: to,
    cols: COLS,
    rows: ROWS,
    generated_at: new Date().toISOString(),
    items: slice.map((p, k) => ({
      n: from + k,
      post_id: p.x_post_id || null,
      author_name: p.author_name || null,
      author_username: p.author_username || null,
      x_url: p.x_url || null,
      thumb_url: pickThumb(p),
      views: p.views || 0,
      likes: p.likes || 0
    }))
  }, null, 2), "utf8");

  console.log("");
  console.log("できました:");
  console.log("  画像: " + pngPath);
  console.log("  対応表: " + jsonPath);
  console.log("  (" + sheetW + "x" + sheetH + " / " + tiles.length + " 件)");
  console.log("");
  console.log("→ 画像をチャットにドラッグして送ってください。");
  if (to < posts.length) {
    console.log("→ 続き: node scripts/contact-sheet.cjs --range " + RANGE + " --start " + (to + 1));
  }
})().catch((e) => {
  console.error("");
  console.error("失敗しました: " + (e && e.message ? e.message : e));
  console.error("もう一度実行してみてください。改善しなければエラー全文を送ってください。");
  process.exit(1);
});