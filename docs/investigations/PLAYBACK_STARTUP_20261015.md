# Xclip 再生開始速度・開き直し調査（2026-10-15）

依頼：サイトで動画を開くと再生開始が遅い場合や、何度か開かないと再生できない場合を改善したい。ユーザーは複数の端末環境と、通常ランキング/Reelsの両方で発生すると回答した。まだ症状の実ブラウザ再現・CDN応答計測は行っていない。

静的調査で見つけた改善対象：
1. 共通DirectPlaybackVideoはnative error時にだけ復旧を開始する。初回ロードや再生が進まないstalled/waitingに対する進捗監視・時間制御はない。ブラウザの自動再生拒否と通信停止は分けて扱う必要がある。
2. 復旧はmetadata更新→HLS→全体Blob。HLSの準備待ち上限45秒、Blobの待ち上限600秒。Blob経路はfetchDirectVideoが全体受信終了後に返すので、先頭から再生できる方法より待つ場合がある。実測で毎回この上限まで待ったとは断定しない。
3. failed後に同じ画面内の再試行操作がない。requestedが同一identityのままで再復旧を開始しないため、閉じて開き直すと再試行が可能になる構造。
4. 親から渡されたonErrorは_onErrorとして保持するだけで呼ばれない。親側の最終失敗処理との整合が必要。ただし早いerrorで即親へ渡すと既存の復旧を打ち切るため、最終失敗と一時的な失敗を分ける。
5. 通常ランキングの選択動画はpreload=metadata、Reelsのactive動画はauto。preloadはブラウザへのヒントで、autoへの変更だけで速くなるとは保証できない。全一覧の動画を先読みする案にはしない。
6. HLSはlibrary読込後にnative対応を調べる。端末別にnative/HLS.jsの起動順を比較する余地はあるが、referrer/CORSや音声の互換性を無視して順を変えない。

推奨する修正範囲：
- 共通プレイヤーに、開いた動画だけの読込進捗・playing/waiting/errorを扱う状態制御を追加。十分な進捗がある遅い回線、バックグラウンド、ユーザーのpause/seeking、自動再生拒否を通信失敗と混同しない。
- 有限回の復旧と、画面内の明示再試行/タップ再生を用意。古い動画の非同期結果が次の動画へ混入しないようcleanup/abort/identityを検証する。
- 復旧で得たMP4/HLSを使い、全体Blob受信の前に部分再生できる経路を検討。既存の無料provider固定・media identity・非掲載拒否・CDN allowlist/サイズ上限は維持する。
- 無関係な動画の一括先読み、動画のSupabase保存、サイトサーバー経由の中継、有料X API追加取得は今回の方針にしない。再生URL更新は復旧時に回数を制限し、無料枠の節約と両立させる。
- 通常ランキング/Reels両方、複数端末、遅延/停止/error/429/非公開、無音/有音、自動再生拒否、画質/音声、保存を回帰確認する。

状態：静的調査と方針、読取診断ファイルを作成した段階。改善アプリコードは未作成・未適用。実本番の再生ファイルSHAは前のDB診断に含まれていなかったため、今回のSHで照合する。版が違えば未知hashを許可して上書きしない。

配布SH：runtime/DEPLOY_SOURCE/BUILD_IDと再生関連14パスの存在/サイズ/SHAのみ読取。env・登録/巡回/教師/モデル本文・動画・DB・providerへアクセスせず、書込なし。VideoDurationBadge等の未配置もそのまま報告し、欠落だけでアプリを変更しない。

参照：
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/waiting_event
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/preload
- https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play
