#!/usr/bin/env bash
set +x
set -Eeuo pipefail
umask 077
ulimit -c 0 || true
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
[[ "$#" == 0 ]] || { echo 'TOKEN_MUST_NOT_BE_PASSED_AS_ARGUMENT'; exit 1; }
[[ -x "$NODE" && -t 0 ]] || { echo 'EXPECTED_NODE_AND_INTERACTIVE_TERMINAL_REQUIRED'; exit 1; }
NEW_BEARER=''
LOCK_OWNED=0
DEPLOY_LOCK="$ACCOUNT/.xclip-production-deploy.lock"
cleanup(){ unset NEW_BEARER; if [[ "$LOCK_OWNED" == 1 ]]; then rmdir "$DEPLOY_LOCK" 2>/dev/null || true; fi; }
trap cleanup EXIT
echo 'This updates X_BEARER_TOKEN in the active runtime and source only after one successful usage API check.'
echo 'No posts are fetched. Existing quotas, cursors, CRON_SECRET and DB settings are retained.'
IFS= read -r -s -p 'New X Bearer Token (hidden; token only): ' NEW_BEARER
printf '
'
[[ -n "$NEW_BEARER" ]] || { echo 'NEW_TOKEN_EMPTY; no changes'; exit 1; }
mkdir "$DEPLOY_LOCK" 2>/dev/null || { echo 'DEPLOYMENT_LOCK_EXISTS; no changes'; exit 1; }
LOCK_OWNED=1
[[ ! -e "$ACCOUNT/.xclip-free-download-deploy.lock" ]] || { echo 'OLDER_DEPLOYMENT_LOCK_EXISTS; no changes'; exit 1; }
exec 9> "$ACCOUNT/.xclip-free-curated-collector.lock"
flock -n 9 || { echo 'COLLECTOR_BUSY; no changes; retry after it finishes'; exit 1; }
SCRIPT=$(cat <<'XCLIP_UPDATE_JS'
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{parseEnv}=require('node:util');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||(typeof process.getuid==='function'&&s.uid!==process.getuid()))throw Error('UNSAFE_INPUT_FILE');return fs.readFileSync(file,'utf8');}
function tokenFlags(token,env={}){
 const value=typeof token==='string'?token:'';
 return {present:!!value,outerWhitespace:value!==value.trim(),bearerPrefix:/^\s*Bearer\s/i.test(value),lineBreak:/[\r\n]/.test(value),wrappingQuotes:/^["']|["']$/.test(value),
  placeholder:/^(?:undefined|null|changeme|your[_ -]?(?:bearer[_ -]?)?token|<[^>]+>)$/i.test(value.trim()),
  equalsCronSecret:!!value&&value===env.CRON_SECRET,equalsApiKey:!!value&&['X_API_KEY','TWITTER_API_KEY','X_CONSUMER_KEY','TWITTER_CONSUMER_KEY','X_API_SECRET','X_API_SECRET_KEY'].some(k=>value===env[k])};
}
function inspect(account,expected,inherited=process.env){
 account=path.resolve(account);if(fs.realpathSync(account)!==account)throw Error('ACCOUNT_PATH_UNEXPECTED');
 const ht=regular(path.join(account,'public_html/.htaccess'));
 const roots=[...ht.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];if(roots.length!==1)throw Error('RUNTIME_NOT_UNIQUE');
 function tree(p,leaf){const rel=path.relative(account,p);if(!/^xclip-[^\\/\r\n]+[\\/](?:runtime|source)$/.test(rel)||path.basename(p)!==leaf||fs.realpathSync(p)!==p)throw Error('UNEXPECTED_DEPLOY_PATH');return p;}
 const runtime=tree(roots[0][1],'runtime'),source=tree(regular(path.join(runtime,'DEPLOY_SOURCE')).trim(),'source');
 const build=regular(path.join(runtime,'.next/BUILD_ID')).trim(),sourceBuild=regular(path.join(source,'.next/BUILD_ID')).trim();
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(build)||build!==sourceBuild)throw Error('BUILD_ID_MISMATCH');
 const envFile=path.join(runtime,'.env.production'),fileEnv=parseEnv(regular(envFile));
 const effective={...fileEnv,...inherited};
 // Node --env-file preserves existing process.env values. Interactive env can differ from Cron env.
 const token=has(inherited,'X_BEARER_TOKEN')?inherited.X_BEARER_TOKEN:fileEnv.X_BEARER_TOKEN;
 const report={diagnostic:'xclip-xapi-auth-20261012',runtime,source,buildId:build,buildMatches:true,
  credentialLocation:'active runtime/.env.production -> X_BEARER_TOKEN',runtimeToken:tokenFlags(fileEnv.X_BEARER_TOKEN,fileEnv),effectiveToken:tokenFlags(token,effective),
  interactiveTokenDefined:has(inherited,'X_BEARER_TOKEN'),interactiveTokenDiffersFromFile:has(inherited,'X_BEARER_TOKEN')&&inherited.X_BEARER_TOKEN!==fileEnv.X_BEARER_TOKEN,
  alternativeBearerVariableNames:['TWITTER_BEARER_TOKEN','X_API_BEARER_TOKEN','BEARER_TOKEN'].filter(k=>!!fileEnv[k]),
  environmentScope:'interactive session; Cron inherited environment not inspected',codeChecks:{},credentialValidity:'not tested',providerRequests:0,stateChanges:false};
 for(const [n,digest]of Object.entries(expected)){
  const file=n==='xclip-free-curated-collector.sh'?path.join(account,n):path.join(source,n);
  if(!file.startsWith(account+path.sep))throw Error('UNSAFE_EXPECTED_PATH');
  report.codeChecks[n]=fs.existsSync(file)?hash(Buffer.from(regular(file)))===digest:false;
 }
 const sourceEnv=path.join(source,'.env.production');
 report.sourceEnvTokenMatchesRuntime=fs.existsSync(sourceEnv)?parseEnv(regular(sourceEnv)).X_BEARER_TOKEN===fileEnv.X_BEARER_TOKEN:null;
 return {report,token};
}
async function probeUsage(token,fetcher=fetch){
 const flags=tokenFlags(token);
 if(!flags.present||flags.outerWhitespace||flags.bearerPrefix||flags.lineBreak||flags.wrappingQuotes||flags.placeholder)return {attempted:false,reason:'TOKEN_MISSING_OR_MALFORMED',requests:0};
 let response;
 try{
  response=await fetcher('https://api.x.com/2/usage/tweets?days=1',{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  // Neither successful usage/account data nor raw error text is printed or written.
  await response.body?.cancel();
  return {attempted:true,requests:1,http:response.status,interpretation:response.status===200?'TOKEN_ACCEPTED_FOR_USAGE; SEARCH_ACCESS_NOT_TESTED':response.status===401?'TOKEN_REJECTED_BY_X':response.status===403?'USAGE_ACCESS_DENIED; TOKEN_VALIDITY_NOT_CONCLUSIVE':response.status===429?'RATE_LIMITED; TOKEN_VALIDITY_NOT_CONCLUSIVE':'INCONCLUSIVE'};
 }catch{return {attempted:true,requests:1,http:0,interpretation:'TRANSPORT_OR_RESPONSE_FAILURE; NO_RETRY'};}
}
async function main(account,expected,args){
 try{
  if(args.length>1||args.length===1&&args[0]!=='--probe-usage')throw Error('INVALID_ARGUMENT');
  const {report,token}=inspect(account,expected);
  if(args[0]==='--probe-usage'){report.usageProbe=await probeUsage(token);report.providerRequests=report.usageProbe.requests;}
  console.log(JSON.stringify(report,null,2));console.log('XCLIP_AUTH_DIAGNOSTIC_COMPLETE; share JSON above; no secrets or state changes');
 }catch(e){
  const codes=new Set(['UNSAFE_INPUT_FILE','ACCOUNT_PATH_UNEXPECTED','RUNTIME_NOT_UNIQUE','UNEXPECTED_DEPLOY_PATH','BUILD_ID_MISMATCH','UNSAFE_EXPECTED_PATH','INVALID_ARGUMENT']);
  console.error('XCLIP_AUTH_DIAGNOSTIC_FAILED: '+(codes.has(e.message)?e.message:'INPUT_UNREADABLE_OR_PARSE_FAILED')+'; no raw error or secret printed');process.exitCode=1;
 }
}
module.exports={inspect,tokenFlags,probeUsage,main};

// Uses inspect/tokenFlags/probeUsage from the bundled read-only diagnostic.
function replaceBearer(text,token){
 const before=parseEnv(text),pattern=/^([ \t]*(?:export[ \t]+)?X_BEARER_TOKEN[ \t]*=[ \t]*)([^\r\n]*)(\r?$)/gm;
 const lines=[...text.matchAll(pattern)];if(lines.length!==1||!before.X_BEARER_TOKEN)throw Error('AMBIGUOUS_TOKEN_ASSIGNMENT');
 if(parseEnv(lines[0][0]).X_BEARER_TOKEN!==before.X_BEARER_TOKEN)throw Error('MULTILINE_TOKEN_ASSIGNMENT_REFUSED');
 const next=text.replace(pattern,(_,prefix,value,cr)=>{
  const shape=value.match(/^[ \t]*(?:"[^"\r\n]*"|'[^'\r\n]*'|`[^`\r\n]*`|[^ \t#]+)([ \t]*(?:#[^\r\n]*)?)$/);
  if(!shape)throw Error('TOKEN_LINE_SHAPE_UNSUPPORTED');
  return prefix+JSON.stringify(token)+shape[1]+cr;
 }),after=parseEnv(next);
 if(after.X_BEARER_TOKEN!==token||JSON.stringify(Object.keys(before).sort())!==JSON.stringify(Object.keys(after).sort())||Object.keys(before).some(k=>k!=='X_BEARER_TOKEN'&&before[k]!==after[k]))throw Error('OTHER_ENV_SETTING_CHANGED');
 return next;
}
function privateDirectory(p){const s=fs.lstatSync(p);if(!s.isDirectory()||typeof process.getuid==='function'&&(s.uid!==process.getuid()||(s.mode&0o077)!==0))throw Error('PRIVATE_DIRECTORY_UNSAFE');}
function atomicPrivate(file,text){
 regular(file);const temp=file+'.xclip-'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});fs.chmodSync(temp,0o600);fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
async function updateBearer(account,expected,newToken,{fetcher=fetch}={}){
 const flags=tokenFlags(newToken);
 if(!flags.present||flags.outerWhitespace||flags.bearerPrefix||flags.lineBreak||flags.wrappingQuotes||flags.placeholder||!/^[A-Za-z0-9._~+/%=-]{20,4096}$/.test(newToken))throw Error('NEW_TOKEN_FORMAT_INVALID');
 const {report}=inspect(account,expected,{});
 if(!Object.values(report.codeChecks).every(Boolean))throw Error('LIVE_CODE_NOT_EXPECTED_V3');
 if(!report.sourceEnvTokenMatchesRuntime)throw Error('SOURCE_RUNTIME_ENV_TOKEN_MISMATCH');
 const files=[path.join(report.source,'.env.production'),path.join(report.runtime,'.env.production')];
 const before=files.map(regular),parsed=parseEnv(before[1]);
 const newFlags=tokenFlags(newToken,parsed);if(newFlags.equalsCronSecret||newFlags.equalsApiKey)throw Error('WRONG_CREDENTIAL_TYPE');
 if(parsed.X_BEARER_TOKEN===newToken)throw Error('CURRENT_TOKEN_UNCHANGED');
 const next=before.map(text=>replaceBearer(text,newToken));
 const activeBefore=regular(path.join(account,'public_html/.htaccess')),sourceBefore=regular(path.join(report.runtime,'DEPLOY_SOURCE'));
 const probe=await probeUsage(newToken,fetcher);
 if(!probe.attempted||probe.http!==200){const code=probe.http===401?'NEW_TOKEN_REJECTED_401':probe.http===403?'NEW_TOKEN_USAGE_ACCESS_403_INCONCLUSIVE':probe.http===429?'NEW_TOKEN_USAGE_LIMIT_429_INCONCLUSIVE':'NEW_TOKEN_PROBE_FAILED';throw Error(code);}
 if(regular(path.join(account,'public_html/.htaccess'))!==activeBefore||regular(path.join(report.runtime,'DEPLOY_SOURCE'))!==sourceBefore)throw Error('ACTIVE_DEPLOYMENT_CHANGED');
 const check=inspect(account,expected,{});if(check.report.buildId!==report.buildId||!Object.values(check.report.codeChecks).every(Boolean))throw Error('ACTIVE_DEPLOYMENT_CHANGED');
 for(let i=0;i<files.length;i++)if(regular(files[i])!==before[i])throw Error('ENV_CHANGED_DURING_CHECK');
 const backupRoot=path.join(account,'.xclip-credential-backups');if(!fs.existsSync(backupRoot))fs.mkdirSync(backupRoot,{mode:0o700});privateDirectory(backupRoot);
 const backup=path.join(backupRoot,'xapi-bearer-20261012-'+crypto.randomUUID());fs.mkdirSync(backup,{mode:0o700});privateDirectory(backup);
 for(let i=0;i<files.length;i++)fs.writeFileSync(path.join(backup,i===0?'source.env.private':'runtime.env.private'),before[i],{flag:'wx',mode:0o600});
 const committed=[];let failure=null;
 try{
  for(let i=0;i<files.length;i++){if(regular(files[i])!==before[i])throw Error('ENV_CHANGED_DURING_UPDATE');atomicPrivate(files[i],next[i]);committed.push(i);}
  for(let i=0;i<files.length;i++)if(regular(files[i])!==next[i])throw Error('ENV_VERIFY_FAILED');
 }catch(e){
  failure=e;let restoreFailed=false;
  for(const i of committed.reverse())try{if(regular(files[i])!==next[i])throw Error('NEWER_ENV_PRESERVED');atomicPrivate(files[i],before[i]);}catch{restoreFailed=true;}
  if(restoreFailed){const err=Error('ENV_ROLLBACK_NEEDS_REVIEW');err.backup=backup;throw err;}throw failure;
 }
 let restartMarkerUpdated=false;
 try{
  const tmp=path.join(report.runtime,'tmp');const s=fs.lstatSync(tmp);if(!s.isDirectory()||fs.realpathSync(tmp)!==tmp)throw Error();
  const marker=path.join(tmp,'restart.txt');if(fs.existsSync(marker))regular(marker);else fs.writeFileSync(marker,'',{flag:'wx',mode:0o600});
  const at=new Date();fs.utimesSync(marker,at,at);restartMarkerUpdated=true;
 }catch{}
 return {success:true,backupDirectory:backup,validatedEndpoint:'/2/usage/tweets',http:200,providerRequests:1,restartMarkerUpdated,sourceRuntimeTokenMatches:true,searchAccessTested:false,
  patrolStateChanged:false,quotaReset:false,otherEnvSettingsChanged:false,localEnvChanged:false};
}
async function updateMain(account,expected){
 const allowed=new Set(['NEW_TOKEN_FORMAT_INVALID','LIVE_CODE_NOT_EXPECTED_V3','SOURCE_RUNTIME_ENV_TOKEN_MISMATCH','WRONG_CREDENTIAL_TYPE','CURRENT_TOKEN_UNCHANGED','AMBIGUOUS_TOKEN_ASSIGNMENT','MULTILINE_TOKEN_ASSIGNMENT_REFUSED','TOKEN_LINE_SHAPE_UNSUPPORTED','OTHER_ENV_SETTING_CHANGED','NEW_TOKEN_REJECTED_401','NEW_TOKEN_USAGE_ACCESS_403_INCONCLUSIVE','NEW_TOKEN_USAGE_LIMIT_429_INCONCLUSIVE','NEW_TOKEN_PROBE_FAILED','ACTIVE_DEPLOYMENT_CHANGED','ENV_CHANGED_DURING_CHECK','ENV_CHANGED_DURING_UPDATE','ENV_VERIFY_FAILED','PRIVATE_DIRECTORY_UNSAFE','ENV_ROLLBACK_NEEDS_REVIEW']);
 try{
  let token=fs.readFileSync(3,'utf8');if(token.endsWith('\n'))token=token.slice(0,-1);
  const result=await updateBearer(account,expected,token);token='';console.log(JSON.stringify(result,null,2));console.log('XCLIP_XAPI_BEARER_UPDATED; no posts fetched; reservations/cursors retained');
 }catch(e){console.error('XCLIP_XAPI_BEARER_UPDATE_FAILED: '+(allowed.has(e.message)?e.message:'INPUT_OR_FILE_OPERATION_FAILED')+'; no secret or raw error printed');if(e.backup)console.error('PRIVATE_BACKUP_DIRECTORY='+e.backup);process.exitCode=1;}
}
module.exports={...module.exports,replaceBearer,updateBearer,updateMain};

updateMain("/home/rbxfxmfd",{"lib/x-curated-search.ts": "90d41fadb981e46ea33bf7abee1aacc4c5422dadae9ac9f28055956d32465daf", "lib/x-curated-scan.ts": "6e9d4e962810cb3a7fecf66bd1aa2ef5e4a9a9edec52ed6625aa8e1f6a8bbaca", "lib/free-curated-scan.ts": "56c8784c00775685d5d010207d547c975c10f627fc60fb08aa64c2b351ed2c33", "scripts/scan-free-curated.cjs": "7f60776a039678011c075facbc267a2ea210460206cf6184babe001bde3bfebd", "xclip-free-curated-collector.sh": "e764170b661d83cbb2cadc288fffea83738954eada512af8c75b7f740a0023d2"});
XCLIP_UPDATE_JS
)
"$NODE" -e "$SCRIPT" 3<<<"$NEW_BEARER"
