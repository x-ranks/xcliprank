#!/usr/bin/env bash
# twizou 本番サーバーの読み取り専用調査。
# ファイルの作成・変更・削除、サービスの再起動、設定変更は一切しない。
# 環境変数の値、認証情報、Cron の引数は表示しない。
set -u
umask 077
MANIFEST_URL="${1:-}"
ACCOUNT="$HOME"
HTACCESS="$ACCOUNT/public_html/.htaccess"
say() { printf '%s\n' "$*"; }
say "== twizou server survey v1 =="
say "date_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 1. 稼働中の runtime とソース
LIVE=""
if [ -r "$HTACCESS" ]; then
  LIVE=$(sed -n 's/^[[:space:]]*PassengerAppRoot[[:space:]]*"\([^"]*\)"[[:space:]]*$/\1/p' "$HTACCESS" | head -n 1)
  say "passenger_app_root_lines=$(grep -c '^[[:space:]]*PassengerAppRoot' "$HTACCESS")"
else
  say "htaccess=NOT_READABLE"
fi
SOURCE=""
if [ -n "$LIVE" ] && [ -d "$LIVE" ]; then
  say "live_runtime=${LIVE#"$ACCOUNT"/}"
  say "live_build_id=$(cat "$LIVE/.next/BUILD_ID" 2>/dev/null || echo MISSING)"
  say "live_env_file=$([ -f "$LIVE/.env.production" ] && echo present || echo MISSING)"
  say "live_server_js=$([ -f "$LIVE/server.js" ] && echo present || echo MISSING)"
  if [ -f "$LIVE/DEPLOY_SOURCE" ]; then SOURCE=$(head -n 1 "$LIVE/DEPLOY_SOURCE"); fi
else
  say "live_runtime=NOT_FOUND"
fi
if [ -n "$SOURCE" ] && [ -d "$SOURCE" ]; then
  say "deploy_source=${SOURCE#"$ACCOUNT"/}"
  say "source_build_id=$(cat "$SOURCE/.next/BUILD_ID" 2>/dev/null || echo MISSING)"
  say "source_node_modules=$([ -d "$SOURCE/node_modules/next" ] && echo present || echo MISSING)"
else
  say "deploy_source=NOT_RECORDED_OR_MISSING"
fi

# 2. GitHub の production/source との一致
if [ -n "$MANIFEST_URL" ] && [ -n "$SOURCE" ] && [ -d "$SOURCE" ]; then
  TMP=$(mktemp) || TMP=""
  if [ -n "$TMP" ] && curl -fsSL --max-time 30 "$MANIFEST_URL" -o "$TMP"; then
    same=0; diff=0; missing=0; shown=0
    while read -r want rel; do
      [ -n "$rel" ] || continue
      if [ ! -f "$SOURCE/$rel" ]; then
        missing=$((missing+1)); [ "$shown" -lt 40 ] && { say "  MISSING_ON_SERVER $rel"; shown=$((shown+1)); }
      else
        have=$(sha256sum "$SOURCE/$rel" | cut -d' ' -f1)
        if [ "$have" = "$want" ]; then same=$((same+1)); else
          diff=$((diff+1)); [ "$shown" -lt 40 ] && { say "  DIFFERENT $rel"; shown=$((shown+1)); }
        fi
      fi
    done < "$TMP"
    say "github_files_same=$same different=$diff missing_on_server=$missing"
    extra=0; eshown=0
    for d in app lib scripts sql supabase; do
      [ -d "$SOURCE/$d" ] || continue
      while read -r f; do
        rel="${f#"$SOURCE"/}"
        if ! grep -qF "  $rel" "$TMP"; then
          extra=$((extra+1)); [ "$eshown" -lt 20 ] && { say "  ONLY_ON_SERVER $rel"; eshown=$((eshown+1)); }
        fi
      done <<EOT
$(find "$SOURCE/$d" -type f 2>/dev/null)
EOT
    done
    say "only_on_server=$extra"
  else
    say "manifest_download=FAILED"
  fi
  [ -n "$TMP" ] && rm -f "$TMP"
else
  say "github_compare=SKIPPED"
fi

# 3. 自動反映に必要な道具
for t in git curl tar unzip flock crontab sha256sum; do
  say "tool_$t=$(command -v "$t" >/dev/null 2>&1 && echo yes || echo no)"
done
NODE_BIN=$(ls -d "$ACCOUNT"/.local/node/*/bin/node 2>/dev/null | tail -n 1)
say "node=$([ -n "$NODE_BIN" ] && "$NODE_BIN" -v 2>/dev/null || echo NOT_FOUND)"
say "github_codeload_http=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -I https://codeload.github.com/x-ranks/xcliprank/tar.gz/refs/heads/main 2>/dev/null || echo ERR)"

# 4. Cron（時刻と実行ファイル名だけ。引数は表示しない）
if command -v crontab >/dev/null 2>&1; then
  crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' | grep -v '^[A-Za-z_]*=' | while read -r m h dom mon dow cmd rest; do
    say "cron: $m $h $dom $mon $dow $(basename "$cmd")"
  done
  say "cron_entries=$(crontab -l 2>/dev/null | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' | grep -vc '^[A-Za-z_]*=')"
fi

# 5. 容量とロック
say "disk: $(df -h "$ACCOUNT" 2>/dev/null | tail -n 1 | awk '{print "size="$2" used="$3" free="$4" use="$5}')"
say "xclip_dirs=$(ls -d "$ACCOUNT"/xclip-* 2>/dev/null | wc -l)"
say "deploy_lock=$([ -e "$ACCOUNT/.xclip-production-deploy.lock" ] && echo EXISTS || echo none)"
say "memory: $(free -m 2>/dev/null | awk '/^Mem:/{print "total_mb="$2" available_mb="$7}')"
say "cpus=$(nproc 2>/dev/null || echo unknown)"
say "== end =="
