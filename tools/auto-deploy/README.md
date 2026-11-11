# twizou 自動反映 v1

GitHub の `main` にある `production/source` を、安全確認つきで本番（ColorfulBox）へ反映する仕組み。

## 流れ
1. 修正は Claude が別ブランチで作り、Pull Request で提出する。
2. 利用者が GitHub 上で内容を確認し「Merge」を押す（これが承認）。
3. サーバーが 5 分ごとに `main` を確認し、`production/source` に差分があれば反映する。
   テスト → 型検査 → ビルド → 入れ替え → 公開サイト確認。どれかが失敗すれば元の状態へ自動で戻る。

## 安全のための決まり
- 反映スクリプト本体はサーバー側（`~/.twizou-auto-deploy/deploy.sh`）にあり、GitHub への push では書き換わらない。更新は設置コマンドの再実行のみ。
- サーバー上のファイルが「前回反映した内容」と違う場合（手動編集など）は、上書きせず反映を中止する。
- `package.json` / `package-lock.json` の変更、120 ファイルを超える変更は自動では反映しない（手動反映）。
- 失敗したコミットは自動では再試行しない。
- 既存の排他ロック（巡回・収集・ランキング更新・配布）を使う。巡回中は待機し、次回に再試行する。
- 自動反映が作った古い世代は新しい 4 世代だけ残して整理する。他の `xclip-*` は触らない。
- 認証情報・環境変数の値は表示も保存もしない。

## 操作（サーバーで実行）
```
~/.twizou-auto-deploy/deploy.sh --status        # 現在の状態
~/.twizou-auto-deploy/deploy.sh --check         # 何が反映されるか確認（変更しない）
~/.twizou-auto-deploy/deploy.sh --apply         # 今すぐ反映（手動）
touch ~/.twizou-auto-deploy/PAUSE               # 自動反映を一時停止
rm ~/.twizou-auto-deploy/PAUSE                  # 再開
~/.twizou-auto-deploy/deploy.sh --enable-cron   # 5 分ごとの自動実行を入れる
~/.twizou-auto-deploy/deploy.sh --disable-cron  # 外す
```
ログは `~/.twizou-auto-deploy/log`。
