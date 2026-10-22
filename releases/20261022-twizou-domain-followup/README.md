# twizou.net 移行後のHTTPS転送とローカルURL補正（2026-10-22）

`http://twizou.net/` が200のままだったため、共有ドキュメントルートの `.htaccess` に新ドメイン限定のHTTPS転送を追加した。`GET`/`HEAD` は301、それ以外はメソッドを保つ308を返す。既存の旧ドメイン転送と旧APIの互換経路は維持した。アプリのruntime、Cron、Build IDは変更していない。

- 本番適用：`twizou-https-canonical-20261022-fix2.sh --check` 成功、`--apply` は `TWIZOU_HTTPS_CANONICAL_DEPLOYMENT_COMPLETE`。
- 本番 `.htaccess` バックアップ：`/home/rbxfxmfd/xclip-twizou-https-canonical-20261022.3hbXMX/htaccess.before`。
- 初回版は日本語タグのパーセントエンコードの表記差で検証に失敗。fix1は更新直後のHTTPトップが200で失敗。どちらも `PREVIOUS_HTACCESS_RESTORED` を確認した。成功したfix2は反映待ちを上限付きで追加した。
- 公開独立確認：新HTTPトップ・個別ページ・クエリ付きURLが新HTTPSへ301。日本語タグは転送後200。新HTTPSトップとサイトマップは200。旧HTTP/HTTPSトップは新ドメインへ301、旧ランキングAPIは200。
- ローカル適用：`scripts/contact-sheet.cjs` の既定ランキングAPIを新ドメインへ変更。変更前SHA-256 `d036e774f02e7ab03c6433f3fdefe9c94512b164e0da77aac7e844bed11fa320`、変更後SHA-256 `42c07c758f4121ac7a64112a6084e02acb9061afc28e7c954989a7a4bacde0a4`。`node --check` 成功。ローカルの旧ファイルは `C:\Users\USER\Documents\Codex\contact-sheet-before-twizou-20261022.cjs` に保存。
- このリリースには適用済みの本番スクリプトとローカルスクリプトのコピーだけを保存する。ZIP内の2ファイルは実際に使ったものとSHA-256が一致する。実際の `.htaccess`、環境ファイル、認証情報、データベースは含めない。

| 配布物 | SHA-256 |
| --- | --- |
| [本番適用スクリプト](./twizou-https-canonical-20261022-fix2.sh) | `a0da19ab83bf7c832b2592ee6b64636d4a1ffae05427012062e82842c26f764e` |
| [本番・ローカルの実ファイルZIP](./twizou-domain-followup-20261022.zip) | `b017fd5f77f7f952fa91f1bcf07c21a0da53dbee4af604546e89c48c4b7d5d5c` |

Search Consoleの新ドメイン所有権確認、サイトマップ送信、旧プロパティのアドレス変更と、ColorfulBoxのAutoSSL更新設定は未確認。これらは今回の適用成功に含めない。
