# twizou SEO追加実装・個別URL登録（2026-10-19）

本番とローカルの適用をユーザー提供ログおよびローカルのファイルハッシュで確認した配布物です。適用証跡は [`docs/completions/20261019-twizou-seo-followup.json`](../../docs/completions/20261019-twizou-seo-followup.json) に保存しました。

- `twizou-seo-followup-v1-original.zip`: 初回配布物。404検査がNext.jsのストリーミングメタ情報を見落として失敗したため、**このZIP内のシェルは再実行しないでください**。コードペイロード自体は修正版と同じです。
- `twizou-seo-followup-v1-fix1.zip`: 404 HTML全体でメタ件数を確認する修正版。今回成功した本番配布物。
- `apply-production-followup-fix1.sh`: 実際の本番適用で成功したシェル。初回ZIPの展開済みディレクトリに置いて使われました。
- `twizou-seo-followup-local-v1.zip`: ローカル38ファイルの同期・照合・復元用配布物。
- `SHA256SUMS.txt`: 上記4ファイルのSHA-256。

これらは適用時の基準ソースへの差分で、GitHubのソースツリー全体が本番と一致することを示すものではありません。稼働済み環境への再適用手順ではなく、再利用時は変更前ハッシュと稼働ソースを再照合してください。
