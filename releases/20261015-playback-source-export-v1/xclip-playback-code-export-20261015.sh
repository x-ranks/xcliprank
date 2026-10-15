#!/usr/bin/env bash
set -Eeuo pipefail
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
[[ -x "$NODE" ]] || { printf '%s\n' 'NODE_NOT_FOUND; no changes'; exit 1; }
ACCOUNT="$ACCOUNT" "$NODE" <<'JS'
"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const account=process.env.ACCOUNT;
const expected={"app/components/DirectPlaybackVideo.tsx":{"bytes":4895,"sha256":"86a3cdd4d19c22f89407b142f12fcfaa3406821fb06ec32af1571818fb0479e2"},"lib/browser-stream-playback.ts":{"bytes":4501,"sha256":"eb1c8426b8a1f7503bf71e2881a07273eab3b31c1e5077fb8298f3e7599c0233"},"lib/browser-direct-playback.ts":{"bytes":2487,"sha256":"949376d6a5267838cfd29098baf091ca880362af919bfbab5923062832c9994f"},"lib/browser-direct-download.ts":{"bytes":3566,"sha256":"dfcff3262a04e4d762030e8e762549567ca894a70e77806423d93c69ca04ffa7"},"lib/playback-refresh.ts":{"bytes":2304,"sha256":"6d99c05b6214e09ede453a88d46c640c241a0cf1e25b2104e383eceabc0044ed"},"lib/download-free.ts":{"bytes":8214,"sha256":"295b052cd33ee6daba9dc3620727e453764d08fccec63483b87d8262a7195d26"},"lib/video-download.ts":{"bytes":2980,"sha256":"9e0ae9501b50f32f5b84561c179af40db62f5c9f992eb5fecfe89efe35fba37c"},"app/api/video-playback-url/route.ts":{"bytes":2652,"sha256":"fe228ecb1cf7fb2580b3d5a00bca021aef83e07f4840e8758919ec2a07eaa60b"},"app/components/RankingClient.tsx":{"bytes":15544,"sha256":"566cc2ce5554d58646a83be9a7e4fb3ca40aff0eebd120c051b637b0d422caff"},"app/reels/ReelsFeed.tsx":{"bytes":13353,"sha256":"aebe67d17c0d3b9b88be873aabc03babb646088e3a9d8f0585029595c43c878e"},"app/layout.tsx":{"bytes":1449,"sha256":"3601e5f334c10af1f8613073dcacb766448428c71d094956cf05f2e1532ca9cc"},"app/components/VideoDurationBadge.tsx":{"bytes":3739,"sha256":"33c9a3bf7b964fd6175e65d77fc164932ecef12f4ee520949636182b512d8885"},"lib/supabase-admin.ts":{"bytes":492,"sha256":"f8b8ce736e78bc7ce0ded8dee0861921e6eeb90ffe93b070f9ba2c618fb502fe"},"lib/vendor/hls.mjs":{"bytes":1484971,"sha256":"11e668e41247b44b5807a10264f36e2edd9eaaa681167c46c9a681bd3757059b"}};
const expectedBuild='H6KQokOwZZcvhnEQnY251';
const expectedRuntime=account+'/xclip-video-card-20261004.DJKKID/runtime';
const expectedSource=account+'/xclip-ranking-updates-v2-20261014.aj9FwJ/source';
let exportDir,exportFile;
function regular(file,max=2*1024*1024){
 const s=fs.lstatSync(file);
 if(!s.isFile()||s.isSymbolicLink()||s.size>max||s.uid!==process.getuid()||fs.realpathSync(file)!==file)throw Error('UNSAFE_FILE');
 const bytes=fs.readFileSync(file);
 if(bytes.length>max)throw Error('UNSAFE_FILE');
 return bytes;
}
function confined(p){
 if(!path.isAbsolute(p)||!p.startsWith(account+'/xclip-')||/[\r\n\0]/.test(p)||fs.realpathSync(p)!==p)throw Error('UNEXPECTED_PATH');
 const s=fs.lstatSync(p);
 if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid())throw Error('UNEXPECTED_PATH');
 return p;
}
function active(){
 const ht=regular(account+'/public_html/.htaccess',65536).toString('utf8');
 const roots=[...ht.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
 if(roots.length!==1)throw Error('UNEXPECTED_APP_ROOT');
 const runtime=confined(roots[0][1]);
 if(runtime!==expectedRuntime)throw Error('SOURCE_CHANGED_RERUN_DIAGNOSTIC');
 const build=regular(runtime+'/.next/BUILD_ID',4096).toString('utf8').trim();
 const source=confined(regular(runtime+'/DEPLOY_SOURCE',4096).toString('utf8').trim());
 const sourceBuild=regular(source+'/.next/BUILD_ID',4096).toString('utf8').trim();
 if(build!==expectedBuild||sourceBuild!==build||source!==expectedSource)throw Error('SOURCE_CHANGED_RERUN_DIAGNOSTIC');
 return {runtime,source,buildId:build};
}
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function codeFile(source,name){
 const bytes=regular(path.join(source,name));
 if(bytes.length!==expected[name].bytes||sha(bytes)!==expected[name].sha256)throw Error('SOURCE_CHANGED_RERUN_DIAGNOSTIC');
 return bytes;
}
try{
 const current=active(),files={};
 for(const name of Object.keys(expected)){
  const bytes=codeFile(current.source,name);
  files[name]={...expected[name],included:name!=='lib/vendor/hls.mjs'};
  if(files[name].included){
   const text=bytes.toString('utf8');
   if(!Buffer.from(text,'utf8').equals(bytes)||text.includes('\0'))throw Error('INVALID_TEXT');
   if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b|\bsb_secret_[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/.test(text))throw Error('POSSIBLE_SECRET_EXPORT_REFUSED');
   files[name].text=text;
  }
 }
 active();
 for(const name of Object.keys(expected))codeFile(current.source,name);
 const document={format:'xclip-playback-code-export-v1',...current,buildMatches:true,files,
  scope:'Allowlisted playback program code only; vendor hash only; no env, DB, logs, registry, model, teacher data or video bytes',
  networkRequests:0,databaseQueries:0,applicationChanged:false,operationalStateChanged:false};
 const body=JSON.stringify(document,null,2)+'\n';
 if(Buffer.byteLength(body)>200000)throw Error('EXPORT_TOO_LARGE');
 exportDir=fs.mkdtempSync(account+'/xclip-playback-source-20261015-');
 fs.chmodSync(exportDir,0o700);
 exportFile=path.join(exportDir,'xclip-playback-source-20261015.json');
 fs.writeFileSync(exportFile,body,{flag:'wx',mode:0o600});
 fs.chmodSync(exportFile,0o600);
 console.log('XCLIP_PLAYBACK_CODE_EXPORT_OK');
 console.log('ATTACH_FILE='+exportFile);
 console.log('EXPORTED_CODE_FILES=13; VENDOR_HASH_ONLY=1; NO_ENV_DB_PROVIDER_REQUESTS; APPLICATION_UNCHANGED');
}catch(error){
 if(exportFile){try{fs.unlinkSync(exportFile);}catch{}}
 if(exportDir){try{fs.rmdirSync(exportDir);}catch{}}
 const safe=new Set(['UNSAFE_FILE','UNEXPECTED_PATH','UNEXPECTED_APP_ROOT','SOURCE_CHANGED_RERUN_DIAGNOSTIC','INVALID_TEXT','POSSIBLE_SECRET_EXPORT_REFUSED','EXPORT_TOO_LARGE']);
 console.error('XCLIP_PLAYBACK_CODE_EXPORT_FAILED: '+(safe.has(error.message)?error.message:'FILE_OPERATION_FAILED')+'; application unchanged; no code printed');
 process.exitCode=1;
}
JS
