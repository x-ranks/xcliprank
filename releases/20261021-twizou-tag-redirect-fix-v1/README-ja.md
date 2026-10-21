# twizou 日本語タグのリダイレクトループ修正

2026-10-21 に本番とローカルへの適用を確認したリリースです。日本語タグの URL エンコードされたルート名と表示用の名前を比較していたため、同じ URL へ 308 リダイレクトが繰り返されていました。ルート名の両形式を受け付けるように修正し、回帰テストを追加しました。

対象ファイルは `app/tags/[name]/page.tsx` と `scripts/test-public-pages.cjs` の2つです。52テスト、型検査、ビルド、隔離環境でのローカル適用・復旧を確認しています。

本番ビルド: `OvXwXJ_RaKpqrbERlbax4`。本番バックアップ: `/home/rbxfxmfd/xclip-before-twizou-tag-redirect-fix-v1-20261021.EOrKhW`。ローカルバックアップ: `C:\Projects\xcliprank-local-backups\twizou-tag-redirect-fix-2026-10-21T12-17-49-547Z-33c85a`。

本番適用後、ユーザーが示した2つの日本語タグURLは、独立したHTTP確認でもリダイレクトなしの200となり、それぞれ100件の動画リンクを含みました。PC・スマホでのクリック操作の結果はまだ報告されていません。詳細は `docs/completions/20261021-twizou-tag-redirect-fix-v1-applied.json` を参照してください。
