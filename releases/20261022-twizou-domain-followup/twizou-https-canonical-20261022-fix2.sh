#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

MODE=${1:---check}
[[ $# -le 1 && ( "$MODE" == --check || "$MODE" == --apply ) ]] || { echo 'USAGE: bash twizou-https-canonical-20261022.sh [--check|--apply]'; exit 2; }
ACCOUNT=/home/rbxfxmfd
HTACCESS="$ACCOUNT/public_html/.htaccess"
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
[[ -x "$NODE" && -f "$HTACCESS" ]] || { echo 'EXPECTED_LAYOUT_MISSING'; exit 1; }

check_layout() {
  HTACCESS="$HTACCESS" "$NODE" <<'JS'
const fs=require('fs');
const p=process.env.HTACCESS,s=fs.lstatSync(p),t=fs.readFileSync(p,'utf8');
if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid())throw Error('HTACCESS_UNSAFE');
const required=[
  'RewriteEngine On',
  '# BEGIN TWIZOU DOMAIN MIGRATION',
  '# END TWIZOU DOMAIN MIGRATION',
  'RewriteRule ^(.*)$ https://twizou.net/$1 [R=301,L,NE]',
  'RewriteCond %{HTTP_HOST} ^xcliprank-test[.]cfbx[.]jp$ [NC]'
];
for(const item of required)if(!t.includes(item))throw Error('HTACCESS_BASELINE_UNKNOWN');
if((t.match(/^[ \t]*RewriteEngine[ \t]+On[ \t]*$/gm)||[]).length!==1||
   (t.match(/# BEGIN TWIZOU DOMAIN MIGRATION/g)||[]).length!==1||
   (t.match(/# END TWIZOU DOMAIN MIGRATION/g)||[]).length!==1)throw Error('HTACCESS_BASELINE_AMBIGUOUS');
if(t.includes('# BEGIN TWIZOU HTTPS CANONICAL'))throw Error('HTTPS_RULE_ALREADY_PRESENT');
console.log('HTACCESS_BASELINE_CONFIRMED');
JS
}

probe() {
  local url="$1" result
  result=$(curl -sS --connect-timeout 5 --max-time 25 --max-redirs 0 -o /dev/null -w '%{http_code}|%{redirect_url}' "$url") || result='000'
  printf '%s\n' "$result"
}

check_layout
[[ "$(probe 'https://twizou.net/')" == '200|' ]] || { echo 'NEW_HTTPS_NOT_READY'; exit 1; }
[[ "$(probe 'https://xcliprank.com/')" == '301|https://twizou.net/' ]] || { echo 'OLD_HTTPS_REDIRECT_CHANGED'; exit 1; }
[[ "$(probe 'http://xcliprank.com/')" == '301|https://twizou.net/' ]] || { echo 'OLD_HTTP_REDIRECT_CHANGED'; exit 1; }
CURRENT=$(probe 'http://twizou.net/')
[[ "$CURRENT" == '200|' ]] || { echo "NEW_HTTP_BASELINE_CHANGED status=$CURRENT"; exit 1; }
if [[ "$MODE" == --check ]]; then echo 'PRECHECK_OK; new HTTP is 200; no changes'; exit 0; fi

LOCK="$ACCOUNT/.xclip-production-deploy.lock"
mkdir "$LOCK" 2>/dev/null || { echo 'PRODUCTION_DEPLOYMENT_BUSY'; exit 1; }
STAGE=''; CHANGED=0
cleanup(){ rmdir "$LOCK" 2>/dev/null || true; }
rollback(){
  trap - ERR INT TERM
  if [[ "$CHANGED" == 1 && -f "$STAGE/htaccess.before" ]]; then
    cp -p "$STAGE/htaccess.before" "$HTACCESS" && echo 'PREVIOUS_HTACCESS_RESTORED' || echo 'HTACCESS_RESTORE_FAILED'
  fi
  echo 'TWIZOU_HTTPS_CANONICAL_FAILED; inspect staging and do not rerun blindly'
  exit 1
}
trap cleanup EXIT
trap rollback ERR INT TERM
STAGE=$(mktemp -d "$ACCOUNT/xclip-twizou-https-canonical-20261022.XXXXXX")
echo "STAGING_DIRECTORY=$STAGE"
cp -p "$HTACCESS" "$STAGE/htaccess.before"
BASELINE_SHA=$(sha256sum "$HTACCESS" | awk '{print $1}')
check_layout
HTACCESS_INPUT="$HTACCESS" HTACCESS_OUTPUT="$STAGE/htaccess.updated" "$NODE" <<'JS'
const fs=require('fs');
const input=fs.readFileSync(process.env.HTACCESS_INPUT,'utf8');
const marker='# END TWIZOU DOMAIN MIGRATION';
if(input.indexOf(marker)!==input.lastIndexOf(marker))throw Error('MIGRATION_MARKER_AMBIGUOUS');
const at=input.indexOf(marker)+marker.length;
const nl=input.includes('\r\n')?'\r\n':'\n';
const rule=[
  '# BEGIN TWIZOU HTTPS CANONICAL',
  'RewriteCond %{HTTP_HOST} ^twizou[.]net$ [NC]',
  'RewriteCond %{HTTPS} !=on',
  'RewriteCond %{REQUEST_METHOD} ^(GET|HEAD)$ [NC]',
  'RewriteRule ^(.*)$ https://twizou.net/$1 [R=301,L,NE]',
  'RewriteCond %{HTTP_HOST} ^twizou[.]net$ [NC]',
  'RewriteCond %{HTTPS} !=on',
  'RewriteRule ^(.*)$ https://twizou.net/$1 [R=308,L,NE]',
  '# END TWIZOU HTTPS CANONICAL'
].join(nl);
fs.writeFileSync(process.env.HTACCESS_OUTPUT,input.slice(0,at)+nl+rule+input.slice(at));
console.log('HTTPS_RULE_STAGED');
JS
chmod --reference="$HTACCESS" "$STAGE/htaccess.updated"
[[ "$(sha256sum "$HTACCESS" | awk '{print $1}')" == "$BASELINE_SHA" ]] || { echo 'HTACCESS_CHANGED_DURING_PREPARE'; exit 1; }
mv -f "$STAGE/htaccess.updated" "$HTACCESS"
CHANGED=1

expect_redirect_after_reload(){
  local url="$1" expected="$2" actual='' attempt
  for attempt in $(seq 1 15); do
    actual=$(probe "$url")
    [[ "${actual,,}" == "${expected,,}" ]] && return 0
    sleep 2
  done
  echo "REDIRECT_NOT_ACTIVE url=$url status=$actual; waited for server reload"
  return 1
}

for path in '/' '/p/2111989753172345043' '/tags/%E5%80%8B%E4%BA%BA%E6%92%AE%E5%BD%B1'; do
  expected="301|https://twizou.net$path"
  expect_redirect_after_reload "http://twizou.net$path" "$expected" || { echo "NEW_HTTP_REDIRECT_FAILED path=$path"; rollback; }
done
[[ "$(probe 'http://twizou.net/?from=canonical-check')" == '301|https://twizou.net/?from=canonical-check' ]] || { echo 'NEW_HTTP_QUERY_REDIRECT_FAILED'; rollback; }
[[ "$(probe 'https://twizou.net/')" == '200|' ]] || { echo 'NEW_HTTPS_SMOKE_FAILED'; rollback; }
[[ "$(probe 'https://xcliprank.com/')" == '301|https://twizou.net/' ]] || { echo 'OLD_HTTPS_SMOKE_FAILED'; rollback; }
[[ "$(probe 'http://xcliprank.com/')" == '301|https://twizou.net/' ]] || { echo 'OLD_HTTP_SMOKE_FAILED'; rollback; }
[[ "$(probe 'https://xcliprank.com/api/rankings?range=daily')" == '200|' ]] || { echo 'OLD_API_SMOKE_FAILED'; rollback; }
[[ "$(probe 'https://twizou.net/sitemap.xml')" == '200|' ]] || { echo 'SITEMAP_SMOKE_FAILED'; rollback; }
trap - ERR INT TERM
echo "PREVIOUS_HTACCESS_BACKUP=$STAGE/htaccess.before"
echo 'TWIZOU_HTTPS_CANONICAL_DEPLOYMENT_COMPLETE'
