# TWIVIDEO 動画再生可能性監査

調査日時：2026-08-30（JST）

## 対象3件

| rank / TWIVIDEO item ID | HEAD | 最小Range | リダイレクト | Content-Type | Content-Length | Accept-Ranges | 有効期限らしいパラメータ |
|---|---:|---:|---:|---|---|---|---|
| 1 / 4008488 | 403 | 403 | なし | `text/html; charset=UTF-8` | 5554（制限HTML） | なし | なし |
| 25 / 4006606 | 403 | 403 | なし | `text/html; charset=UTF-8` | 5554（制限HTML） | なし | なし |
| 50 / 3997797 | 403 | 403 | なし | `text/html; charset=UTF-8` | 5554（制限HTML） | なし | なし |

3件とも動画応答ではなく、TWIVIDEO側の403制限応答だった。制限回避、動画本体・画像の取得保存は行っていない。

## 推奨方式

- A：TWIVIDEO公開リンクをvideo要素へ直接指定 — 不適。403で、既存プロキシの許可ホスト外。
- B：既存 `/api/video` プロキシ — 正規の `video.twimg.com` URLを取得できた場合のみ利用可能。
- C：元X投稿URLから正規の `video.twimg.com` URLを取得 — 第一候補。
- D：TWIVIDEO item IDから正規動画URLを解決する専用resolver — 元X URLを取得できない項目の代替候補。

## 残るリスク

- 元X URLを取得できないランキング項目がある。
- TWIVIDEO公開リンクから正規再生URLの有効期限・削除状態を確認できない。
- 49件のレビュー画面を作る前に、再生URL解決経路と失敗時の表示を決める必要がある。

## 変更の有無

コード、DB、既存ファイル、教師データは変更していない。本ファイルのみを追加した。
