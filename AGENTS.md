# Xclipの更新・引き継ぎルール

ユーザーが2026-10-11に指定したルールです。

- 着手前に `docs/XCLIP_UPDATE_HISTORY.md` と `docs/xclip-update-artifacts.json` を読み、今回に関係する過去の更新・未確認事項・適用状態を確認する。
- 作業先は `C:\Projects\xcliprank`。古い `Documents\x_video_rank_mvp` を現在の更新元にしない。未コミット変更・未追跡ファイル・ローカルデータを保護する。
- 本番はColorfulBox。公開中runtimeとDEPLOY_SOURCE、BUILD_IDを照合する。過去のVercel向け手順を現行本番へそのまま適用しない。
- 作成・検証・ローカル適用・本番適用を区別する。ファイル作成やビルド成功を本番反映済みと説明しない。
- 各更新の目的、対象ファイル、版、SHA-256、基準コード、互換性、検証結果、適用先・状態・時刻・根拠、バックアップと復旧方法を更新履歴へ追記する。以前のチャットの更新も確認できた範囲で遡って記録し、未確認分は未確認と記載する。
- コードに新しい変更があれば照合台帳も更新する。既存ファイルの内容が想定版と異なる場合は差分を調べ、未知の変更を上書きしない。
- 配布する更新ファイルはチャットからダウンロードできるリンクを直接掲載する。実行方法と成功表示もチャット本文に記載し、mdファイルへの案内だけで済ませない。
- 環境変数の値、認証情報、秘密鍵、私的な教師データは履歴・照合台帳へ保存しない。

- 2026-10-11 operating preference: do not operate the PC, apply local changes, or execute commands unless explicitly requested by the user. Provide downloadable updates, cumulative history and commands in chat for the user to run. A request to record in Git authorizes the scoped recording operation; it does not authorize deployment or unrelated updates.
