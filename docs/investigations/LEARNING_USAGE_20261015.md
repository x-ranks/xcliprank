# 2026-10-15 JST：学習待機通信の削減 v1（ローカル用・未適用）

- ユーザーの過去24時間Logs集計：xclip_tier_state GET200=101615、posts GET200=10441、other_database_api DELETE204=8428/POST200=8410、authors GET200=493、posts HEAD200=267、engagement_events POST201=54。前のログソース集計ではedge_logs130867（約99.4％）。異なる時点の集計であり各総数を一致するものとして扱わない。その他のPOST/DELETEが学習leaseと一致するかは未分類だが、コード上のclaim/releaseパターンと整合する。
- ユーザーは複数タブでローカル管理を長時間開いていたと回答。実コードは5秒ごとGET詳細（モデル等6読取）→POST step（待機中もclaim/状態読取/解放）。学習専用画面も10秒ごと詳細GET。最初のランキング中心の仮説を更新し、ログの第一改善対象をローカル学習の待機・重複通信とする。転送バイト内訳の主因まで確定したとはしない。
- 少量の追加DB読取：採用モデルpayload80706 bytes、worker-status19014、config121等。旧詳細GETの合計概算180838 bytes（採用モデル2読取）。実DBでJSON射影2種類を読取のみで確認し、モデル概要1815 bytes・採用概要295 bytes、重みなし。本人のモデル・教師・応答本文は出力/保存せず、安全なサイズ集計のみ記録。圧縮等を含む課金バイトとは区別する。
- 本番読取診断：runtime=/home/rbxfxmfd/xclip-video-card-20261004.DJKKID/runtime、source=/home/rbxfxmfd/xclip-ranking-updates-v2-20261014.aj9FwJ/source、BUILD_ID=H6KQokOwZZcvhnEQnY251、buildMatches=true。標準edition保存先の直近24時間書込46件。常時5分288回/日の前の14.75GB試算を実績として扱わない。46件は重複作成試行や削除済みファイルを数えず、正確なDB集計回数ではない。
- 修正：ローカルのブラウザworkerはPOST stepを直接呼び、事前の詳細GETを廃止。現在の有効/停止/モデル/DBlease/安全性確認は既存サーバー処理を使う。対象なし/完了は30→60→120→300秒、停止は300秒、busy/errorは30秒。処理中の1.5秒/5秒を維持。
- 複数タブ：Web Locks対応ブラウザの同じoriginでworkerを1つにし、待機タブはDB通信なし。操作はBroadcastChannelで実行タブにも伝え即再確認。終了中のリクエストが落ち着くまでlock保持。未対応ブラウザとlocalhost/127.0.0.1別origin間では既存DBleaseが同時処理を保護するが、ブラウザ単位の要求集約は適用されない。
- 詳細画面：表示確認を10秒→60秒、非表示タブでは詳細確認を休止、再表示時に読取。処理workerの背景タブ動作は維持。操作後の詳細読取とworker起動は維持。
- 状態表示：personalModelStatusとreleaseStatusはPostgRESTのJSON項目選択で必要な概要だけを取得し、モデル重みを取得しない。返す状態・採用情報・プレビューhashは従来と一致。学習/モデル採用・解除・新着評価の実処理は変更しない。
- 互換：ローカルUI2ファイル、新規制御module、状態概要関数2ファイル、模擬testと累積履歴/台帳。本番コード・DB SQL・env・Cron・1,000登録・24/8巡回・取得位置・教師データ・モデル・手動Tier・除去状態を変更しない。ローカルの既存APIの応答形式と操作を維持。インストール中は実サービス通信なし。
- 検証：実制御module/実TSX effectで模擬HTTP・仮想24hの2タブ待機291 POST/詳細GET0（旧名目34560 GET+34560 POST）。active1.5/5秒、pause/busy/error、wake、別タブBroadcast、handover、inflight終了、ローカル限定、hidden詳細/60秒表示、型・配布実PS1適用/再適用/復元/未知編集拒否はVERIFY参照。測定のDB削減率・GB削減・無料継続を保証する数字ではない。
- 状態：作成/隔離検証候補。実ローカル/本番への適用は未実施。実効果は適用後24〜72hの同じLogs集計と転送量/ログ増分を比較。学習機能の停止・モデル解除ボタンを応急策として案内しない（既存config.enabledは本番モデル適用にも影響するため）。無料継続の判断とランキング通信改善は未完了。


配布：releases/20261015-learning-poll-v1/。未適用。実配布検証結果はVERIFY-learning-poll-20261015.json。
