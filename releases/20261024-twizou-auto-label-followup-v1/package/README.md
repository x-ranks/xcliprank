# twizou 自動ラベル継続処理 v1 — ローカル専用候補

2026-10-24 JST。作成・隔離検証済み。実ローカル適用、定期タスク登録、実動画処理、本番メタデータ更新は未実施。本番アプリの更新は不要。

## 原因と変更

- 2026-10-19のローカル一周は9413件を走査し、844件の動画処理が失敗、公開0件。直近20件は取得失敗10件・96MiB超過10件。取得失敗のHTTP状態は旧コードに記録されていないため、403・404・通信障害などの内訳は未確定。
- 自動反映は管理画面を開き、手動で一周を開始した場合だけ進む実装だった。新規登録は一周の処理中または完了後に自動投入されなかった。
- ローカル専用ワーカーを追加。3時間ごとのWindowsタスクへ登録すると、画面を閉じても保存済み位置から再開し、完了後は次の一周を開始する。新規動画は次の一周の先頭から対象になる。実行中の二重起動を拒否する。
- 自動反映に限り動画上限を256MiBへ拡張。手動教材作成は従来の96MiBを保持。動画の一時ファイルは削除し、モデル・画像・特徴は本番へ送らない。
- HTTP 403・404・410・429・5xxを失敗コードとして記録する。失敗した同一動画URLは原則24時間、256MiB超過は7日間再試行を待つ。URLが変われば再試行できる。既存job.jsonは消さず、旧形式から読み込む。

## 適用と開始

開発サーバーを停止してから、ZIP展開先のPowerShellで次を実行する。適用はラベル処理を開始しない。

```powershell
node .\apply-local.cjs --check
node .\apply-local.cjs --apply
```

成功表示は `LOCAL_SYNC_APPLIED files=8 backup=...`。その後、定期実行を登録する場合は実プロジェクトのスクリプトを使う。登録後、ログと管理画面を確認する。

```powershell
cd C:\Projects\xcliprank
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-auto-label-task.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-auto-label-task.ps1 -Install
```

成功表示は `TASK_REGISTERED name=TwizouAutoLabelLocal interval=3h`。タスクはログイン中のWindowsユーザーで、3時間ごとに直接ローカル処理を動かす。Next開発サーバーを開いておく必要はない。既存の学習モデル、ローカル環境設定、ネットワーク接続は必要。定期処理は動画CDNからの取得と認証付き本番ラベルAPIへの書込を行う。Xの有料APIは使用しない。

結果: `C:\Projects\xcliprank\.local-admin\label-auto-v1\worker-runs.log` と管理画面 `/label-publication`。残る動画のHTTP失敗コードを確認する。実動画を使った成功と本番画面での表示は適用後に確認する。

## 復旧

定期タスクを登録した場合は先にWindowsタスクスケジューラで `TwizouAutoLabelLocal` を無効にする。適用時の `LOCAL_BACKUP` を指定してコードを戻す。

```powershell
node .\apply-local.cjs --rollback 'C:\Projects\xcliprank-local-backups\<実際のバックアップ名>'
```

`job.json`、モデル、教師データ、失敗記録は復旧時にも削除しない。タスクが登録済みなら、コード復旧後も無効のままにする。

## 照合・検証

適用対象8ファイルの基準SHA-256と候補SHA-256は `manifest.json`。未知の版や混合版を拒否する。隔離コピーで `test-label-auto` 14シナリオ、`test-label-learning`、自動ラベルAPI、ラベル公開、TypeScript型検査、Next本番ビルドが成功。配布ファイルから模擬環境への適用とロールバックも成功。実DB・実動画CDN・実本番APIへの書込は検証で行っていない。
