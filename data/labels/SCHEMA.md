# data/labels/SCHEMA.md

ラベルデータの唯一の正（Single Source of Truth）。
このファイルを変更せずに、コード側がフィールド名・enum値・採点規則を
追加/変更してはならない。

- schema_version: 1.1
- taxonomy_version: 1.6
- owner: data側（アングラ担当AI）
- consumer: code側（ChatGPT）
- 生成方法: コンタクトシート画像をVisionで目視ラベリング
- 実行時AI呼び出し: なし（完全に静的な凍結データ）
- 状態: FROZEN（v1.5 で凍結。以後の変更は version を上げる）

---

## 0. 大原則

1. このファイルは「データ」である。`app/` や `lib/` のコードは
   これを **読むだけ**。書き換えない。
2. コード側は実行時にAIを呼ばない。JSONは静的アセットとして扱う。
3. enum値を勝手に増やさない。増やす必要が出たら taxonomy_version を
   上げてデータ側に依頼する。
4. キー欠損・null・未知のenum値が来ても **ビルドが落ちてはならない**。
   必ずデフォルト分岐を持たせる（degrade-safe）。
5. ラベルが無い投稿は「ラベル無し」として正常に表示されること。
   `data/labels/*.json` を丸ごと削除してもサイトが壊れてはならない。

---

## 1. ファイル配置

data/labels/
  SCHEMA.md                        ← このファイル
  trending-001-064.json            ← ラベル本体（凍結）
  trending-065-128.json
  trending-129-192.json
  trending-193-256.json
  daily-1-64.json
  meta/                            ← サイドカー（n → 投稿メタ）
    trending-001-064.json
    ...
    daily-1-64.json

out/contact-sheets/                ← コンタクトシート画像（ローカル限定）
  contact-trending-1-64.png
  contact-daily-1-64.png

### 命名規則
ラベル: data/labels/<range>-<start>-<end>.json        （ゼロ埋めなし）
メタ  : data/labels/meta/<range>-<start>-<end>.json   （ゼロ埋めなし）
画像  : out/contact-sheets/contact-<range>-<start>-<end>.png
range : trending | daily | weekly

- バッチ単位でファイルを分ける。既存ファイルを編集せず、新規ファイルを
  足すだけで追記できる。
- n は range ごとの通し番号（1始まり）。
- out/ は git 管理外の想定。meta/ は必ずコミットする（コードが使う）。

---

## 2. サイドカーJSON（data/labels/meta/*.json）

`n` を投稿メタに結びつける対応表。

{
  "range": "trending",
  "start": 1,
  "count": 64,
  "tiles": 8,
  "tile_px": 210,
  "generated_at": "2026-10-16T00:00:00Z",
  "items": [
    {
      "n": 1,
      "post_id": "1893....",
      "author": "handle",
      "author_name": "表示名",
      "x_url": "https://x.com/handle/status/1893....",
      "thumb_url": "https://pbs.twimg.com/....jpg",
      "rank": 1,
      "score": 12345,
      "tier": "s"
    }
  ]
}

- `n` は 1 始まりの連番。**安定キー**。
- `post_id` は変わりうる。永続キーは `n` + range。
- `author` は null 可。
- `tier` は s / a / b / c / null。判明しなければ null。

---

## 3. ラベルJSON（data/labels/*.json）

{
  "batch": "trending-129-192",
  "sheet": "out/contact-sheets/contact-trending-129-192.png",
  "schema_version": "1.1",
  "taxonomy_version": "1.5",
  "labeled_by": "venice-vision",
  "labeled_at": "2026-10-16",
  "items": [ Item, ... ]
}

### Item

| field | 型 | 必須 | 説明 |
|---|---|---|---|
| n | int | yes | meta の n とJOINするキー |
| author | string\|null | yes | 判明した場合のみ。null=不明（""と同一視しない） |
| tier | string\|null | yes | s/a/b/c。meta から転記。不明は null |
| genre_group | enum | yes | 12種。下記4節 |
| framing | enum | yes | 4種。下記5節 |
| tags | string[] | yes | 下記6節の語彙から0個以上 |
| flags | object | yes | 下記7節 |
| desc_ja | string | yes | 日本語1文・40字以内 |
| alt | string | yes | 日本語。img alt属性 |
| confidence | enum | yes | high / med / low |

### 完全性ルール
- items は start から end まで **欠番なし**で並ぶこと。
- n は range 全体の通し番号（trending なら 129〜192 のバッチは 129 から）。
- 判別不能でも行は必ず作る（genre_group:"other", confidence:"low"）。
- 行を消してはならない。

---

## 4. genre_group（12種・これ以外禁止）

handjob         手コキ・素手で握っている
fellatio        フェラ・口で咥えている
couple          2人の絡み（体位が特定できない）
riding          騎乗位
rear            後ろ姿・バック（体位より「尻が主役」）
solo            単独・自撮り・立ち姿
lesbian         女性2人
paizuri         胸が主役
toy             玩具・挿入物
bondage         縛り・拘束
closeup_genital 性器そのものが主役
fullbody        引きの全身
other           判別不能

---

## 5. framing（4種・これ以外禁止）

closeup  画面の半分以上が体の一部の接写
upper    上半身が入る
full     全身が入る
rear     背面から撮影（尻・背中が主役）

補足: framing は genre_group と独立した軸。

---

## 6. tags（許可語彙）

tags は下記のみ。表記ゆれ禁止（全角/半角・カタカナ長音に注意）。

構図:   接写 引き 見上げ 見下ろし 下から 前かがみ 横たわり 仰向け 座り 立ち 腕組み 後ろ姿 全身
体:     巨乳 剛毛 胸 お尻 脚 足裏 手 肌 口 顔あり 日焼け跡 タトゥー ピアス 黒髪 金髪 若い 赤ネイル
行為:   手コキ 騎乗位 立ちバック バック 正常位 レズ キス パイズリ 脚上げ 縛り 亀甲縛り 赤縄 結合部 2人
服装:   白ランジェリー 黒ランジェリー 白下着 黒下着 ニーハイ ストッキング ヒール 水着 和装 セーラー服 欧米 眼鏡 マスク 仮面 サングラス 猫耳 花柄 紐 黒 白
場所:   ベッド ソファ 浴室 部屋 屋外 鏡
照明:   明るい 暗め 紫 赤 青 ピンク
画面:   縦 横
メタ:   透かし モザイク ステッカー スタンプ 七爷 OnlyFans ローション 白濁 オイル おもちゃ
状態:   要再確認

- 補足: 浴衣は「和装」に、海外は「欧米」に統一する。
- 補足: 語彙を増やす場合は taxonomy_version を上げる。

---

## 7. flags

省略時は false（lang_guess は null）。記載する場合は bool 必須。

| flag | 意味 |
|---|---|
| face_visible | 顔（目が判別できる）が写っている |
| watermark | 投稿者名/ロゴ/OnlyFans等の合成文字がある |
| black | サムネがほぼ真っ黒で内容判別不能 |
| sfw | 全年齢で見られる（性器が直接写っていない等） |
| ai_generated | AI生成（グラビア系）と推定 |
| lang_guess | "ja" / "en" / "zh" / null |
| needs_review | 要人間確認。省略時は confidence=="low" と同義とみなす |

---

## 8. 採点規則（★コード側は従うだけ）

  base = 1.0
  face_visible == true        → × 1.05
  black == true               → × 0.50
  watermark == true           → × 0.98
  confidence == "low"         → 順位変動なし（desc_jaをmetaに使わない）

乗算のみ。加算しない。複数該当は係数を掛け合わせる。

### desc_ja / alt の使用規則
- confidence high/med → desc_ja を meta description に使用可
- confidence low → alt のみ。desc_ja は表示しない
- alt は常に使用可（空文字不可）

### sfw レーン
flags.sfw == true のみ `/sfw` 配下に出す。

---

## 9. ページ生成規則（コード側が実装する）

- `/genre/[group]`     … genre_group のユニーク値
- `/tag/[tag]`         … tags のユニーク値（出現3件以上のみ）
- `/framing/[f]`       … framing のユニーク値
- `/tier/[t]`          … tier のユニーク値（null 除く）
- `/accounts/[author]` … author != null のみ
- カードは必ず `<a href>` にする。`<article onClick>` は不可。

### 表示にラベルを使う場所
1. img の alt 属性
2. カード下のタグチップ（/tag/* へのリンク）
3. meta description（confidence 規則に従う）

---

## 10. degrade-safe 実装チェックリスト

- [ ] data/labels/*.json を削除してもビルドが通る
- [ ] meta が無いファイルがあっても通る
- [ ] 未知の genre_group は other 扱いで 404 にしない
- [ ] author == null を空文字として扱わない
- [ ] tier == null を除外して /tier/* を作る
- [ ] flags に未知キーが増えても無視する

---

## 11. 変更手順

1. データ側が version を上げ、このファイルを更新
2. コード側は「読むだけ」で追従
3. コード側から enum 追加を提案する場合はデータ側に差分を伝える

---

## 12. 検証

scripts/validate-labels.cjs が通ること。
検証NGのままコード側に渡してはならない。