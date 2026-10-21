# twizou.net ドメイン移行（2026-10-21）

xcliprank.com から twizou.net への移行を、本番・ローカルの両方で適用した記録です。アプリのソース全体をこの記録コミットへ取り込むものではなく、実際に適用した検証済み配布物と照合値を保存します。

- 本番の基準 Build ID: `OvXwXJ_RaKpqrbERlbax4`
- 初回の本番適用: 旧ドメインが HTTP 200 のままだったため失敗し、`PREVIOUS_RUNTIME_RESTORED` を確認
- 修正版の本番適用: `TWIZOU_DOMAIN_MOVE_V1_DEPLOYMENT_COMPLETE`、新 Build ID `Fx2tcddxuDKSsQFoBPRt6`
- 修正版で `.htaccess` に旧ページURLの301転送を追加。旧 `/api/` 経路は転送せず維持
- 本番のログ: サイトマップ posts=3450 / accounts=86、投稿・タグ・日本語タグ・新着・欠損投稿・認証の検証、旧ドメイン301と旧API確認に成功
- 本番の復旧先: `/home/rbxfxmfd/xclip-before-twizou-domain-move-v1-20261021.yr5SqZ`
- `.htaccess` の復旧先: `/home/rbxfxmfd/xclip-twizou-domain-move-v1-20261021.zqOCxo/htaccess.before`
- ローカル適用: `LOCAL_SYNC_APPLIED files=25`、再実行は `LOCAL_SYNC_ALREADY_APPLIED`
- ローカルの復旧先: `C:\Projects\xcliprank-local-backups\twizou-domain-move-2026-10-21T13-54-23-217Z-7eff18`
- ローカルの対象25ファイルは、適用後に配布マニフェストの SHA-256 と全件一致
- 公開URLの独立確認: `https://twizou.net/` が200・自己参照canonical、旧トップと個別ページが301、旧ランキングAPIが200、新サイトマップが200

配布物:

| ファイル | SHA-256 |
| --- | --- |
| [本番適用 fix1](./twizou-domain-move-v1-20261021-fix1.sh) | `552b6d871f6d633927560e54e5e6a03f684bbec85ad099086136e26acda90989` |
| [ローカル適用](./twizou-domain-move-v1-20261021-local.zip) | `29445a66f67f233b37266d399ce6565db8fa0d1ab7f7afc663da6d9ea22bd2d7` |

配布前の検証: 本番コードは52件のテスト、型検査、ビルドに成功。修正版のシェル構文・埋め込みZIP・リダイレクト設定の生成を検証。ローカルは隔離コピーで適用・復元を確認。実際の公開後の確認は上記の本番ログと公開URLを根拠とします。Search Consoleの新ドメイン登録・サイトマップ送信・アドレス変更は別作業であり、この記録では完了扱いにしません。
