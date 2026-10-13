#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ACCOUNT=/home/rbxfxmfd
NODE="$ACCOUNT/.local/node/node-v22.23.2-linux-x64/bin/node"
export PATH="$(dirname "$NODE"):$PATH"
[[ "$#" == 0 ]] || { echo "XCLIP_FX_FIVE_NOW_INVALID_ARGUMENT"; exit 2; }
if ! LOCATIONS_TEXT=$(ACCOUNT="$ACCOUNT" "$NODE" <<'JS'
const fs=require('fs'),path=require('path'),a=process.env.ACCOUNT;
const ht=fs.readFileSync(path.join(a,'public_html/.htaccess'),'utf8');
const roots=[...ht.matchAll(/^\s*PassengerAppRoot\s+"([^"]+)"\s*$/gm)];
if(roots.length!==1||!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/runtime$/.test(roots[0][1]))throw Error('UNEXPECTED_RUNTIME');
const runtime=roots[0][1],source=fs.readFileSync(path.join(runtime,'DEPLOY_SOURCE'),'utf8').trim();
if(!/^\/home\/rbxfxmfd\/xclip-[^\r\n]+\/source$/.test(source)||
 fs.readFileSync(path.join(source,'.next/BUILD_ID'),'utf8').trim()!==fs.readFileSync(path.join(runtime,'.next/BUILD_ID'),'utf8').trim())throw Error('MONITOR_SOURCE_MISMATCH');
console.log(runtime);console.log(source);
JS
); then
 echo 'FREE_CURATED_COLLECTOR_RUNTIME_LOOKUP_FAILED; no scan started'
 exit 1
fi
readarray -t LOCATIONS <<< "$LOCATIONS_TEXT"
unset LOCATIONS_TEXT
[[ "${#LOCATIONS[@]}" == 2 ]] || { echo 'FREE_CURATED_COLLECTOR_RUNTIME_NOT_FOUND'; exit 1; }
RUNTIME="${LOCATIONS[0]}"
SOURCE="${LOCATIONS[1]}"
[[ -f "$SOURCE/scripts/scan-free-curated.cjs" ]] || { echo 'FREE_CURATED_COLLECTOR_NOT_SUPPORTED_BY_RUNTIME'; exit 1; }
cd "$SOURCE"
exec "$NODE" --env-file="$RUNTIME/.env.production" - <<'FX_RESULT_JS'
const fs=require('node:fs'),path=require('node:path');
function regular(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>2*1024*1024||(typeof process.getuid==='function'&&s.uid!==process.getuid()))throw Error('UNSAFE_INPUT_FILE');return fs.readFileSync(file,'utf8');}
const count=n=>Number.isSafeInteger(n)&&n>=0?n:null;
function canonicalId(value){
 if(typeof value==='string'&&/^\d{2,20}$/.test(value))return value;
 if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=10)return String(value);
 return null; // Never guess a rounded ID from an unsafe JSON number.
}
const idType=v=>typeof v==='string'?'string':typeof v==='number'?(Number.isSafeInteger(v)?'safe_integer':'unsafe_number'):'missing_or_other';
async function reportResult(state,manual,database){
 if(!manual||manual.version!==1||manual.release!=='fx-five-now-20261013-v1'||manual.completed!==5||manual.attempted!==5||
   !['PASSED','FAILED'].includes(manual.result)||!Array.isArray(manual.authors)||manual.authors.length!==5||
   !Number.isSafeInteger(manual.startedAt)||!Number.isSafeInteger(manual.finishedAt)||manual.finishedAt<manual.startedAt||
   manual.authors.some(a=>!a||typeof a.username!=='string'||!/^[a-z0-9_]{1,15}$/i.test(a.username)||
     !Number.isSafeInteger(a.at)||a.at<manual.startedAt||a.at>manual.finishedAt||!['success','no_new','error','empty'].includes(a.outcome)||
     !(a.saved===null||count(a.saved)!==null)))throw Error('MANUAL_RESULT_NOT_COMPLETE_OR_INVALID');
 if(state?.version!==1||!Array.isArray(state.authors)||state.authors.length>100||state.authors.some(a=>!a||typeof a!=='object'))throw Error('STATE_INVALID');
 const summaries=[],candidateIds=new Set(),authorIds=new Set();
 for(const row of manual.authors){
  const matches=state.authors.filter(a=>typeof a.username==='string'&&a.username.toLowerCase()===row.username.toLowerCase());
  const timestampMatches=state.authors.filter(a=>a.checkedAt===row.at).length;
  const a=matches.length===1?matches[0]:null,id=a?canonicalId(a.id):null;
  const resolution=matches.length===0?'NAME_NOT_IN_CURRENT_STATE':matches.length>1?'AMBIGUOUS_USERNAME':!id?'INVALID_OR_UNSAFE_AUTHOR_ID':'MATCHED';
  const metrics=a?.metrics;
  const matched=!!(id&&a.checkedAt===row.at&&metrics&&Number.isSafeInteger(metrics.lastSuccessAt)&&
    metrics.lastSuccessAt>=row.at&&metrics.lastSuccessAt<=manual.finishedAt&&
    metrics.lastOutcome===row.outcome&&metrics.lastSaved===row.saved&&count(metrics.lastSaved)!==null&&Array.isArray(metrics.recentVideos)&&row.outcome!=='error');
  const sample=matched&&Array.isArray(metrics.recentVideos)?metrics.recentVideos.map(v=>v?.id):[];
  const sampleValid=sample.length<=10&&sample.every(id=>typeof id==='string'&&/^\d{2,20}$/.test(id))&&new Set(sample).size===sample.length;
  const ids=matched&&sampleValid?sample:[];
  for(const candidate of ids)candidateIds.add(candidate);if(id)authorIds.add(id);
  summaries.push({id,ids,username:row.username,recordedOutcome:row.outcome,savedInRun:count(row.saved),
    stateResolution:resolution,stateNameMatches:matches.length,stateIdType:a?idType(a.id):null,sameAttemptTimestampMatches:timestampMatches,
    metricsMatchThisRun:matched,sampleValid,newCandidatesInRun:matched?count(metrics.lastNew):null,
    sampleComplete:matched&&sampleValid&&count(metrics.lastNew)!==null&&metrics.lastNew===ids.length});
 }
 let queries=0,authors=[],posts=[],authorQueryOk=false,postQueryOk=false;const readErrors=[];
 if(authorIds.size){
  queries++;try{const result=await database.from('authors').select('*').in('x_author_id',[...authorIds]);
   if(result.error||!Array.isArray(result.data))throw Error();authors=result.data;authorQueryOk=true;
  }catch{readErrors.push('READONLY_AUTHOR_QUERY_FAILED');}
 }
 const ids=[...candidateIds];
 if(ids.length){
  queries++;try{const result=await database.from('posts').select('x_post_id,author_id,is_visible,moderation_blocked,review_required,manual_tier,manual_category').in('x_post_id',ids);
   if(result.error||!Array.isArray(result.data))throw Error();posts=result.data;postQueryOk=true;
  }catch{readErrors.push('READONLY_POST_QUERY_FAILED');}
 }
 const rows=summaries.map(s=>{
  const known=posts.filter(p=>p&&s.ids.includes(String(p.x_post_id))),author=authors.find(a=>a&&String(a.x_author_id)===s.id);
  const queryReady=s.sampleComplete&&(s.ids.length===0||postQueryOk);
  return {username:s.username,recordedOutcome:s.recordedOutcome,savedInRun:s.savedInRun,
    stateResolution:s.stateResolution,stateNameMatches:s.stateNameMatches,stateIdType:s.stateIdType,sameAttemptTimestampMatches:s.sameAttemptTimestampMatches,
    metricsMatchThisRun:s.metricsMatchThisRun,newCandidatesInRun:s.newCandidatesInRun,sampleCount:s.ids.length,sampleComplete:s.sampleComplete,
    dbSampleChecked:queryReady,existingSamePostInDb:queryReady?known.length:null,
    visibleSamePostInDb:queryReady?known.filter(p=>p.is_visible===true).length:null,
    hiddenSamePostInDb:queryReady?known.filter(p=>p.is_visible===false).length:null,
    moderationOrReviewFlagged:queryReady?known.filter(p=>p.moderation_blocked===true||p.review_required===true).length:null,
    manuallyClassified:queryReady?known.filter(p=>p.manual_tier!=null||p.manual_category!=null).length:null,
    differentAuthorForSamePost:queryReady?known.filter(p=>String(p.author_id)!==s.id).length:null,
    sampleIdsAbsentFromDb:queryReady?s.ids.length-known.length:null,
    authorReviewRequired:authorQueryOk&&typeof author?.review_required==='boolean'?author.review_required:null,
    interpretation:s.recordedOutcome==='error'?'ORIGINAL_COLLECTION_FAILED; no success sample used':s.stateResolution!=='MATCHED'?'IDENTITY_UNRESOLVED; other authors continue':!s.sampleComplete?'STALE_OR_INCOMPLETE_SAMPLE; no zero-count inference':!queryReady?'DB_QUERY_UNAVAILABLE; no zero-count inference':s.ids.length===0?'NO_NEW_CANDIDATES_IN_THIS_PAGE':known.length===s.ids.length?'ALL_SAMPLED_POST_IDS_ALREADY_IN_DB; original decision path not recorded':'MISSING_IDS_MAY_BE_MEDIA_DUPLICATES_OR_EXCLUSIONS; original decision path not recorded'};
 });
 const unresolved=rows.filter(r=>r.stateResolution!=='MATCHED').length;
 const successfulSamplesComplete=rows.filter(r=>r.recordedOutcome!=='error').every(r=>r.dbSampleChecked);
 return {diagnostic:'fx-five-result-readonly-20261013-v2',diagnosticStatus:!unresolved&&successfulSamplesComplete&&!readErrors.length?'COMPLETE':'PARTIAL',
   manualResult:manual.result,runAtUtc:new Date(manual.startedAt).toISOString(),totalStateAuthors:state.authors.length,unresolvedAuthors:unresolved,
   successfulCandidateSamplesComplete:successfulSamplesComplete,sampledCandidateIds:ids.length,providerRequests:0,databaseReadQueries:queries,databaseWrites:0,stateChanges:false,
   readErrors,authors:rows,identityLimitation:'Original one-off receipt stored usernames/timestamps but no immutable author IDs; unresolved rows are not guessed',
   foreignRowsExplanation:'NOT_RECORDED; cannot identify reply/conversation context from counts alone',
   limitations:'Current DB status and this-run candidate samples only; no saved provider text/media; no ranking/site-display proof'};
}
async function main(source,account,createDatabase){
 try{
  const directory=process.env.XCLIP_FREE_CURATED_STATE_DIR||path.join(account,'.xclip-free-curated');
  if(!path.isAbsolute(directory)||!path.relative(account,directory)||path.relative(account,directory).startsWith('..')||path.isAbsolute(path.relative(account,directory))||fs.realpathSync(directory)!==directory)throw Error('UNSAFE_STATE_DIRECTORY');
  const stateFile=path.join(directory,'state-v1.json'),manualFile=path.join(directory,'fx-manual-five-now-20261013-v1.json');
  const before=regular(stateFile),manual=regular(manualFile);
  let db;const database={from(...args){return(db??=createDatabase(source)).from(...args);}};
  const report=await reportResult(JSON.parse(before),JSON.parse(manual),database);
  report.snapshotChangedDuringQuery=regular(stateFile)!==before||regular(manualFile)!==manual;
  if(report.snapshotChangedDuringQuery){report.diagnosticStatus='PARTIAL';report.readErrors.push('STATE_CHANGED_DURING_QUERY');}
  console.log(JSON.stringify(report,null,2));
  console.log(report.diagnosticStatus==='COMPLETE'?'XCLIP_FX_FIVE_RESULT_READONLY_COMPLETE; no provider requests or writes':'XCLIP_FX_FIVE_RESULT_READONLY_PARTIAL; unresolved rows labelled; no provider requests or writes');
 }catch(e){const allowed=new Set(['UNSAFE_INPUT_FILE','UNSAFE_STATE_DIRECTORY','MANUAL_RESULT_NOT_COMPLETE_OR_INVALID','STATE_INVALID']);
  console.error('XCLIP_FX_FIVE_RESULT_DIAGNOSTIC_FAILED: '+(allowed.has(e.message)?e.message:'INPUT_OR_DATABASE_UNAVAILABLE')+'; no raw errors/secrets printed');process.exitCode=1;}
}
module.exports={reportResult,main,canonicalId};

// ENTRYPOINT
const crypto=require('node:crypto'),{createRequire}=require('node:module');
const expected={"lib/fx-curated-scan.ts": "252ab29ce5ece0c17761e6fe09dcb574758fc91e45acd21570ee8050dcc5cb84", "lib/fx-curated-state.ts": "a969d227e69596700a5b9660f5a7b38c32fde575593ae2c07efe74e9c7f95d00", "lib/fxtwitter-curated.ts": "41a0ebaac09b2995bd5a5d0da84f53f14ca8c8eb5a1b4f2517131655e9e9460e", "lib/free-curated-publish.ts": "2246b0546df14004a95e9acfe3ef2b6904ea4dc3dd0a93c6f105c2afb4d738f4", "scripts/scan-free-curated.cjs": "00e9c212ab5059dd95f39988289c1fd9c4e2d3c38f4b189ab9f99a44090ede85"};
try{
 const source=process.cwd();for(const[n,h]of Object.entries(expected)){
  const b=Buffer.from(regular(path.join(source,n))),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
  if(hash(b)!==h&&hash(b.toString('utf8').replace(/\r\n/g,'\n'))!==h)throw Error('CODE_MISMATCH');
 }
 main(source,'/home/rbxfxmfd',root=>{
  const {createClient}=createRequire(path.join(root,'package.json'))('@supabase/supabase-js');
  const url=process.env.SUPABASE_URL??process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SECRET_KEY??process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw Error('DB_ENV_MISSING');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 });
}catch{console.error('XCLIP_FX_FIVE_RESULT_DIAGNOSTIC_FAILED: CODE_OR_ENV_MISMATCH; no raw errors/secrets printed');process.exitCode=1;}
FX_RESULT_JS
