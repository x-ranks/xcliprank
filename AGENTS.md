# Xclip 更新作業の引き継ぎ

- 着手前に `docs/XCLIP_CURRENT_STATUS.md`、`docs/XCLIP_UPDATE_HISTORY.md`、`docs/xclip-update-artifacts.json` を読む。
- この保存用ブランチの直下コードは過去の基準。適用済みのスナップショットと `releases/20261014-registration-recovery1000/` の未適用候補を区別する。最新Git保存結果は同配布の `GITHUB_RECORD.json`。
- 実ローカルは C:\Projects\xcliprank、本番はColorfulBox xcliprank.com。実コード・稼働元・BUILD_ID・対象SHAを確認し、未知編集を上書きしない。過去Vercel手順を現本番にそのまま適用しない。
- ユーザーの明示指示なしにPC/UI操作や実環境への適用をしない。隔離したコード作成・模擬検証・ユーザー実行を分けて報告する。配布リンクと実行手順はチャット本文に記載する。
- 全状態参照（登録、巡回枠、取得位置、監視、手動削除、学習）を隔離してテスト。実際に配布する埋め込みパッチを適用/再適用/復元/未知編集拒否まで確認する。
- 更新ごとに以前の会話を含む累積履歴、対象SHA、作成/検証/適用/Git状態、互換性、復旧方法を記録。秘密・実運用状態・DBバックアップをGitへ保存しない。
- Supabase DBパスワードは2026-10-12にリセット済み。今後のDB認証障害では旧パスワードが残っていないか確認を案内する。
