# TierプレビューのPC内キャッシュによる互換再生

保存URLと動画プロキシはいずれもHTTP206を返し、FFprobeではH264・AAC・yuv420pを確認できた。一方、Chrome/Edgeの実際の再生は止まったため、ブラウザの逐次取得やMP4構造の影響を分けるためにPC内で完全なMP4を用意してから再生する経路を追加する。原因が確定したわけではなく、Windows実機で再生を確認する必要がある。

## 適用と確認

開発サーバーをCtrl+Cで止めてから、Downloadsに保存したファイルを実行する。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\xclip-tier-compatible-playback-20261008.ps1" -Project "C:\Projects\xcliprank"
cd C:\Projects\xcliprank
$env:XCLIP_FFMPEG_PATH = "C:\Projects\xcliprank\.local-admin\ffmpeg\ffmpeg.exe"
$env:XCLIP_FFPROBE_PATH = "C:\Projects\xcliprank\.local-admin\ffmpeg\ffprobe.exe"
npm run dev -- --hostname 127.0.0.1 -p 3004
```

http://localhost:3004/tier-video-preview で既存の50件を表示する。まず1本で「互換再生を準備（PC内へ取得）」を押し、準備完了後に「再生する」を押す。準備は押した動画だけを対象とし、50件を一括取得しない。学習・抽出・プレビュー作成をやり直す必要はない。

準備エラーとブラウザのplay()エラーは動画下に表示する。読み込み表示で止まった場合も、診断・再読み込みボタンは常に利用できる。まだ止まる場合は「再生エラーを確認」のHTTP、Content-Typeと表示エラーを共有する。

## 動作

- 保存済みのvideo.twimg.comのURLから取得する。API呼び出しや投稿者の再収集はしない。
- FFmpegで映像・音声をコピーし、MP4のmoovを先頭に配置するfaststart形式に整える。再エンコードは行わない。
- PC内にキャッシュしたMP4からRange/HEAD対応で配信し、ブラウザのシークもローカルファイルで処理する。
- 通信量とPCディスクを使う。最大256MiB/本、最大8本（計最大約2GiB）、準備中は一時ファイルの追加容量も必要。9本目を準備すると古いキャッシュを削除する。成功した動画の再準備はキャッシュを使う。
- キャッシュは `.local-admin/tier-video-playback-cache` のみに保存する。動画URL・モデル・教師メモは配布に含めない。
- APIは開発サーバーのlocalhost限定。選択動画が現在のプレビュー対象で安全・公開条件を満たすか、配信のたびに確認する。
- 既存50件・確認メモ・DBのTier・本番ランキングを変更しない。SQL変更も本番デプロイも不要。

## 検証

実際のH264 fixtureをFFmpegでfaststartへ整え、MP4ヘッダーが映像データより前にあること、取得1回でのキャッシュ再利用、206/416/末尾Range/HEAD、8本の保存上限、配信時の対象再確認をテストする。型検査とNext.jsビルドも実行する。Windows実機での再生確認はユーザー環境で行う。
