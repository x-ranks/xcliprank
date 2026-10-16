#!/usr/bin/env bash
set -Eeuo pipefail
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
[[ -x "$NODE" ]] || { printf '%s\n' 'NODE_NOT_FOUND; no changes'; exit 1; }
ACCOUNT="$ACCOUNT" "$NODE" <<'JS'
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const account=process.env.ACCOUNT;
function regular(file,max=2*1024*1024){
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.size>max||s.uid!==process.getuid())throw Error('UNSAFE_OR_LARGE_FILE');
 return fs.readFileSync(file);
}
function confined(p){
 if(!path.isAbsolute(p)||!p.startsWith(account+'/xclip-')||/[\r\n\0]/.test(p)||fs.realpathSync(p)!==p)throw Error('UNEXPECTED_PATH');
 return p;
}
try{
 const ht=regular(path.join(account,'public_html/.htaccess')).toString('utf8');
 const roots=[...ht.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
 if(roots.length!==1)throw Error('UNEXPECTED_APP_ROOT');
 const runtime=confined(roots[0][1]);
 if(path.basename(runtime)!=='runtime')throw Error('UNEXPECTED_APP_ROOT');
 const build=regular(path.join(runtime,'.next/BUILD_ID'),4096).toString('utf8').trim();
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(build))throw Error('INVALID_BUILD_ID');
 const source=confined(regular(path.join(runtime,'DEPLOY_SOURCE'),4096).toString('utf8').trim());
 const sourceBuild=regular(path.join(source,'.next/BUILD_ID'),4096).toString('utf8').trim();
 if(sourceBuild!==build)throw Error('BUILD_MISMATCH');
 const names=['app/api/rankings/route.ts','lib/ranking-editions.ts','lib/supabase-admin.ts',
  'lib/free-curated-dashboard.ts','app/api/engagement/route.ts','app/api/engagement-stats/route.ts',
  'lib/engagement-client.ts','app/api/local-admin-status/route.ts','app/api/ranking-admin/route.ts'];
 const files={};
 for(const name of names){
  const file=path.join(source,name);
  if(!fs.existsSync(file)){files[name]={present:false};continue;}
  const value=regular(file);
  files[name]={present:true,bytes:value.length,sha256:crypto.createHash('sha256').update(value).digest('hex')};
 }
 // List edition filenames and timestamps only; never read post IDs, state or env files.
 let cache={inspected:false,reason:'default_directory_not_present_or_unsafe'};
 const cacheDir=path.join(account,'.xclip-ranking-feed');
 if(fs.existsSync(cacheDir)){
  const stat=fs.lstatSync(cacheDir);
  if(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&fs.realpathSync(cacheDir)===cacheDir){
   const now=Date.now(),times=[],ages=[];let total=0;
   for(const name of fs.readdirSync(cacheDir)){
    if(!/^\d{13}-[a-f0-9]{12}\.json$/.test(name))continue;
    const s=fs.lstatSync(path.join(cacheDir,name));
    if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid())continue;
    total++;
    if(now-s.mtimeMs<86400000){times.push(s.mtimeMs);ages.push(Number(name.slice(0,13)));}
   }
   cache={inspected:true,path:'default',files:total,filesWrittenLast24h:times.length,
    firstWriteLast24h:times.length?new Date(Math.min(...times)).toISOString():null,
    lastWriteLast24h:times.length?new Date(Math.max(...times)).toISOString():null,
    note:'default directory only; custom state directory and historical usage are not inferred'};
  }
 }
 const result={diagnostic:'xclip-db-usage-source-check-20261015',runtime,source,buildId:build,
  buildMatches:true,files,rankingEditionCache:cache,networkRequests:0,databaseQueries:0,stateChanges:false,envRead:false};
 console.log(JSON.stringify(result,null,2));
 console.log('XCLIP_DB_USAGE_SOURCE_CHECK_OK; read only; no secrets or provider calls');
}catch(error){
 const safe=new Set(['UNSAFE_OR_LARGE_FILE','UNEXPECTED_PATH','UNEXPECTED_APP_ROOT','INVALID_BUILD_ID','BUILD_MISMATCH']);
 console.error('XCLIP_DB_USAGE_SOURCE_CHECK_FAILED: '+(safe.has(error.message)?error.message:'REQUIRED_FILE_UNAVAILABLE')+'; no changes');
 process.exitCode=1;
}
JS
