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
 const names=["app/components/DirectPlaybackVideo.tsx", "lib/browser-stream-playback.ts", "lib/browser-direct-playback.ts", "lib/browser-direct-download.ts", "lib/playback-refresh.ts", "lib/download-free.ts", "lib/video-download.ts", "app/api/video-playback-url/route.ts", "app/components/RankingClient.tsx", "app/reels/ReelsFeed.tsx", "app/layout.tsx", "app/components/VideoDurationBadge.tsx", "lib/supabase-admin.ts", "lib/vendor/hls.mjs"];
 const files={};
 for(const name of names){
  const file=path.join(source,name);
  if(!fs.existsSync(file)){files[name]={present:false};continue;}
  const value=regular(file);
  files[name]={present:true,bytes:value.length,sha256:crypto.createHash('sha256').update(value).digest('hex')};
 }
 const result={diagnostic:'xclip-playback-source-check-20261015',runtime,source,buildId:build,
  buildMatches:true,files,networkRequests:0,databaseQueries:0,stateChanges:false,envRead:false};
 console.log(JSON.stringify(result,null,2));
 console.log('XCLIP_PLAYBACK_SOURCE_CHECK_OK; read only; no secrets or provider calls');
}catch(error){
 const safe=new Set(['UNSAFE_OR_LARGE_FILE','UNEXPECTED_PATH','UNEXPECTED_APP_ROOT','INVALID_BUILD_ID','BUILD_MISMATCH']);
 console.error('XCLIP_PLAYBACK_SOURCE_CHECK_FAILED: '+(safe.has(error.message)?error.message:'REQUIRED_FILE_UNAVAILABLE')+'; no changes');
 process.exitCode=1;
}
JS
