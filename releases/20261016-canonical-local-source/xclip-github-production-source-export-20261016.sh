#!/usr/bin/env bash
set -Eeuo pipefail
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
[[ -x "$NODE" ]] || { printf '%s\n' 'NODE_NOT_FOUND; no application changes'; exit 1; }
ACCOUNT="$ACCOUNT" "$NODE" <<'JS'
"use strict";
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const account=process.env.ACCOUNT;
let outputDir,outputFile;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const secret=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b|\bsb_secret_[A-Za-z0-9_-]{20,}|\bAKIA[A-Z0-9]{16}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}/;
const ignored=new Set(['node_modules','data','artifacts','runtime','releases','snapshots']);
const textTypes=new Set(['.ts','.tsx','.mts','.cts','.js','.mjs','.cjs','.css','.sql','.json','.svg','.txt','.py','.sh','.ps1']);
const assetTypes=new Set(['.ico','.png','.jpg','.jpeg','.webp','.woff','.woff2']);
function info(p){const s=fs.lstatSync(p);if(s.isSymbolicLink()||s.uid!==process.getuid()||fs.realpathSync(p)!==p)throw Error('UNSAFE_PATH');return s;}
function read(p,max=2*1024*1024){const s=info(p);if(!s.isFile()||s.size>max)throw Error('UNSAFE_FILE');const b=fs.readFileSync(p);if(b.length>max)throw Error('UNSAFE_FILE');return b;}
function confined(p){if(!path.isAbsolute(p)||!p.startsWith(account+'/xclip-')||/[\r\n\0]/.test(p)||!info(p).isDirectory())throw Error('UNEXPECTED_SOURCE');return p;}
function active(){
 const ht=read(account+'/public_html/.htaccess',65536).toString('utf8');
 const roots=[...ht.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];if(roots.length!==1)throw Error('UNEXPECTED_APP_ROOT');
 const runtime=confined(roots[0][1]);if(path.basename(runtime)!=='runtime')throw Error('UNEXPECTED_APP_ROOT');
 const buildId=read(runtime+'/.next/BUILD_ID',4096).toString('utf8').trim();if(!/^[a-zA-Z0-9_-]{1,128}$/.test(buildId))throw Error('INVALID_BUILD');
 const source=confined(read(runtime+'/DEPLOY_SOURCE',4096).toString('utf8').trim());
 if(read(source+'/.next/BUILD_ID',4096).toString('utf8').trim()!==buildId)throw Error('BUILD_MISMATCH');
 return {runtime,source,buildId};
}
function collect(source){
 const files={};let total=0;
 function add(name){
  const bytes=read(path.join(source,name));total+=bytes.length;
  if(total>25*1024*1024||Object.keys(files).length>=1500)throw Error('EXPORT_LIMIT');
  const entry={bytes:bytes.length,sha256:hash(bytes)};
  if(assetTypes.has(path.extname(name).toLowerCase())){entry.encoding='base64';entry.content=bytes.toString('base64');}
  else{
   const text=bytes.toString('utf8');if(!Buffer.from(text).equals(bytes)||text.includes('\0'))throw Error('INVALID_TEXT');
   if(secret.test(text))throw Error('POSSIBLE_SECRET_EXPORT_REFUSED');entry.encoding='utf8';entry.content=text;
  }
  files[name]=entry;
 }
 function walk(rel){
  const dir=path.join(source,rel);if(!info(dir).isDirectory())throw Error('UNSAFE_PATH');
  for(const name of fs.readdirSync(dir).sort()){
   if(!name||name==='..'||/[\/\\\0\r\n]/.test(name))throw Error('UNSAFE_NAME');
   if(name.startsWith('.')||ignored.has(name))continue;
   const next=path.posix.join(rel,name),p=path.join(source,next),s=info(p);
   if(s.isDirectory())walk(next);
   else if(s.isFile()&&(textTypes.has(path.extname(name).toLowerCase())||assetTypes.has(path.extname(name).toLowerCase())))add(next);
  }
 }
 for(const dir of ['app','lib','scripts','sql','supabase','public'])if(fs.existsSync(path.join(source,dir)))walk(dir);
 for(const file of ['package.json','package-lock.json','tsconfig.json','next.config.ts','next.config.js','next.config.mjs','next-env.d.ts','middleware.ts'])if(fs.existsSync(path.join(source,file)))add(file);
 if(!files['package.json']||!files['app/layout.tsx'])throw Error('REQUIRED_SOURCE_MISSING');
 return {files,total};
}
try{
 const before=active(),first=collect(before.source),after=active();
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error('SOURCE_CHANGED');
 const second=collect(before.source);
 if(JSON.stringify(Object.keys(first.files))!==JSON.stringify(Object.keys(second.files))||Object.entries(first.files).some(([n,v])=>second.files[n].sha256!==v.sha256))throw Error('SOURCE_CHANGED');
 const body=JSON.stringify({format:'xclip-canonical-production-code-v1',...before,files:first.files,totalBytes:first.total,
  applicationChanged:false,operationalStateChanged:false,networkRequests:0,databaseQueries:0,
  excluded:['.env*','DB dumps','data','artifacts','.local-admin','node_modules','.next','model .bin weights','home Cron scripts and live Cron settings']},null,2)+'\n';
 outputDir=fs.mkdtempSync(account+'/xclip-github-source-20261016-');fs.chmodSync(outputDir,0o700);
 outputFile=path.join(outputDir,'xclip-github-production-source-20261016.json');
 fs.writeFileSync(outputFile,body,{flag:'wx',mode:0o600});fs.chmodSync(outputFile,0o600);
 console.log('XCLIP_GITHUB_PRODUCTION_SOURCE_EXPORT_OK');console.log('ATTACH_FILE='+outputFile);
 console.log('CODE_FILES='+Object.keys(first.files).length+'; NO_ENV_DB_PROVIDER_REQUESTS; APPLICATION_UNCHANGED');
}catch(e){
 if(outputFile){try{fs.unlinkSync(outputFile);}catch{}}if(outputDir){try{fs.rmdirSync(outputDir);}catch{}}
 const safe=new Set(['UNSAFE_PATH','UNSAFE_FILE','UNEXPECTED_SOURCE','UNEXPECTED_APP_ROOT','INVALID_BUILD','BUILD_MISMATCH','EXPORT_LIMIT','INVALID_TEXT','POSSIBLE_SECRET_EXPORT_REFUSED','UNSAFE_NAME','REQUIRED_SOURCE_MISSING','SOURCE_CHANGED']);
 console.error('XCLIP_GITHUB_PRODUCTION_SOURCE_EXPORT_FAILED: '+(safe.has(e.message)?e.message:'FILE_OPERATION_FAILED')+'; no application changes; no code printed');process.exitCode=1;
}
JS
