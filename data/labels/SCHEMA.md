# data/labels/SCHEMA.md

ラベルデータの唯一の正（Single Source of Truth）。
このファイルを変更せずに、コード側がフィールド名・enum値・採点規則を
追加/変更してはならない。

- schema_version: 1.0
- taxonomy_version: 1.2
- owner: data側（アングラ担当AI）
- consumer: code側（ChatGPT）
- 生成方法: コンタクトシート画像をVisionで目視ラベリング
- 実行時AI呼び出し: なし（完全に静的な凍結データ）

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
  SCHEMA.md                      ← このファイル
  trending.json                  ← ラベル本体（凍結）
  trending.csv                   ← 人間が目視確認する用
  daily.json                     ← 将来: dailyランキング用
sheets/
  contact-trending-001-064.png   ← 元画像（0詰め3桁）
  contact-trending-001-064.json  ← サイドカー（n → 投稿メタ）
  ...

### 命名規則
`contact-<range>-<start:3桁>-<end:3桁>.png`
range: trending | daily | weekly

---

## 2. サイドカーJSON（sheets/*.json）

`n` を投稿メタに結びつける対応表。データ側が生成する。

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
      "score": 12345
    }
  ]
}

- `n` は 1 始まりの連番。**安定キー**。
- `post_id` は変わりうる（再取得で別IDになる可能性あり）。
  永続キーとしては `n` + range を使うこと。
- `author` は null 可。

---

## 3. ラベルJSON（data/labels/*.json）

{
  "batch": "trending-001-064",
  "sheet": "sheets/contact-trending-001-064.png",
  "schema_version": "1.0",
  "taxonomy_version": "1.2",
  "labeled_by": "venice-vision",
  "labeled_at": "2026-10-16",
  "items": [ Item, ... ]
}

### Item

| field | 型 | 必須 | 説明 |
|---|---|---|---|
| n | int | yes | サイドカーの n とJOINするキー |
| author | string\|null | yes | 判明した場合のみ。null=不明（""と同一視しない） |
| genre_group | enum | yes | 12種。下記4節 |
| framing | enum | yes | 4種。下記5節 |
| tags | string[] | yes | 下記6節の語彙から0個以上 |
| flags | object | yes | 下記7節 |
| desc_ja | string | yes | 日本語1文・40字以内。meta description候補 |
| alt | string | yes | 日本語。img alt属性 |
| confidence | enum | yes | high / med / low |

### 完全性ルール
- items は 1 から count まで **欠番なし**で並ぶこと。
- 判別不能でも行は必ず作る（genre_group:"other", confidence:"low"）。
- 行を消してはならない。削除はデータ側の判断。

---

## 4. genre_group（12種・これ以外禁止）

handjob         手コキ・素手で握っている
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
「手コキ×closeup」と「手コキ×upper」は別物として扱う。

---

## 6. tags（許可語彙）

tags は下記のみ。表記ゆれ禁止（全角/半角・カタカナ長音に注意）。

構図:   接写 引き 見上げ 見下ろし 前かがみ 横たわり 仰向け 座り 立ち 腕組み
体:     巨乳 剛毛 胸 お尻 脚 足裏 肌 日焼け跡 タトゥー ピアス 黒髪 金髪
行為:   手コキ 騎乗位 立ちバック バック 正常位 レズ キス パイズリ 脚上げ 縛り 亀甲縛り 2人
服装:   白ランジェリー 黒ランジェリー 白下着 黒下着 ニーハイ ストッキング ヒール 水着 和装 眼鏡 猫耳 仮面 サングラス 花柄 紐
場所:   ベッド ソファ 浴室 部屋 屋外 鏡
照明:   明るい 暗め 紫 赤
画面:   縦 横
メタ:   透かし モザイク ステッカー 七爷 ローション オイル おもちゃ スタンプ
状態:   要再確認

---

## 7. flags（bool・全て必須）

| flag | 意味 |
|---|---|
| face_visible | 顔（目が判別できる）が写っている |
| watermark | 投稿者名/ロゴ/OnlyFans等の合成文字がある |
| black | サムネがほぼ真っ黒で内容判別不能 |
| sfw | 全年齢で見られる（性器が直接写っていない等） |
| ai_generated | AI生成（グラビア系）と推定 |
| lang_guess | "ja" / "en" / "zh" / null |
| needs_review | confidence が low、または要人間確認 |

---

## 8. 採点規則（★ここが一番揉める。コード側は従うだけ）

ランキングスコアへの乗算係数。データ側が定義する。

  base = 1.0
  face_visible == true        → × 1.05
  black == true               → × 0.50
  watermark == true           → × 0.98
  confidence == "low"         → 順位変動なし（desc_jaをmetaに使わない）

適用順序は乗算のみ。加算しない。複数該当は係数を掛け合わせる。
係数を変えたい場合はコード側でなくデータ側に言う。

### desc_ja / alt の使用規則
- confidence が "high" または "med" → desc_ja を meta description に使用可
- confidence が "low" → alt のみ使用。desc_ja は表示しない
- alt は confidence 問わず常に使用してよい（空文字は不可）

### sfw レーン
flags.sfw == true の投稿のみ `/sfw` 配下に出す。
sfw は「性器が直接写っていない」の意味であり、
ヌードの有無とは独立。

---

## 9. ページ生成規則（コード側が実装する）

- `/genre/[group]`   … genre_group のユニーク値から generateStaticParams
- `/tag/[tag]`       … tags のユニーク値から（出現3件以上のみ）
- `/framing/[f]`     … framing のユニーク値から
- `/accounts/[author]` … author != null のみ。null は /accounts に含めない
- カードは必ず `<a href>` にする。`<article onClick>` は不可。

### 表示にラベルを使う場所
1. img の alt 属性
2. カード下のタグチップ（各チップが /tag/* へのリンク）
3. meta description（confidence 規則に従う）

---

## 10. degrade-safe 実装チェックリスト

- [ ] data/labels/trending.json を削除してもビルドが通る
- [ ] items の一部 n だけ存在しても通る
- [ ] 未知の genre_group が来ても 404 にならず other 扱い
- [ ] author == null を空文字として扱わない
- [ ] flags に未知キーが増えても無視する
- [ ] taxonomy_version が上がっても壊れない

---

## 11. 変更手順

1. データ側が taxonomy_version を上げ、このファイルを更新
2. コード側は「読むだけ」で追従
3. コード側から enum 追加を提案する場合は、このファイルを直接
   編集せず、データ側に差分を伝える

---

## 12. 検証

scripts/validate-labels.cjs を実行して通ること。
- 全 item が必須フィールドを持つ
- enum が許可値内
- n が 1..count で連続
- desc_ja が 40 字以内
- tags が許可語彙内

検証NGのままコード側に渡してはならない。