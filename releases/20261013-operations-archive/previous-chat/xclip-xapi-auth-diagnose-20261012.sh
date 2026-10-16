#!/usr/bin/env bash
set -Eeuo pipefail
NODE=/home/rbxfxmfd/.local/node/node-v22.23.2-linux-x64/bin/node
[[ -x "$NODE" ]] || { echo 'XCLIP_AUTH_DIAGNOSTIC_FAILED: EXPECTED_NODE_MISSING'; exit 1; }
exec "$NODE" - "$@" <<'XCLIP_AUTH_JS'
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

main("/home/rbxfxmfd",{"lib/x-curated-search.ts": "90d41fadb981e46ea33bf7abee1aacc4c5422dadae9ac9f28055956d32465daf", "lib/x-curated-scan.ts": "6e9d4e962810cb3a7fecf66bd1aa2ef5e4a9a9edec52ed6625aa8e1f6a8bbaca", "lib/free-curated-scan.ts": "56c8784c00775685d5d010207d547c975c10f627fc60fb08aa64c2b351ed2c33", "scripts/scan-free-curated.cjs": "7f60776a039678011c075facbc267a2ea210460206cf6184babe001bde3bfebd", "xclip-free-curated-collector.sh": "e764170b661d83cbb2cadc288fffea83738954eada512af8c75b7f740a0023d2"},process.argv.slice(2));
XCLIP_AUTH_JS
