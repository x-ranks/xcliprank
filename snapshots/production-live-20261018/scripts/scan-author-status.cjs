const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),sourceRequire=createRequire(path.join(root,'package.json')),ts=sourceRequire('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
async function main(){
 // Instantiate the DB client lazily: skipped duplicate/cooldown runs have zero DB calls.
 const stats=await require('../lib/availability-scan.ts').scanAvailabilityStatuses(async cursor=>{
  const db=require('../lib/supabase-admin.ts').supabaseAdmin();
  let query=db.from('posts').select('x_post_id,author_id,author_username')
   .eq('collection_source','curated').eq('is_visible',true).eq('moderation_blocked',false).eq('review_required',false)
   .not('video_url','is',null)
   .or('adult_tier.in.(S,A+,A,B+,B,C),manual_tier.in.(S,A+,A,B+,B,C)')
   .or('manual_tier.is.null,manual_tier.in.(S,A+,A,B+,B,C)');
  if(cursor)query=query.lt('x_post_id',cursor);
  const {data,error}=await query.order('x_post_id',{ascending:false}).limit(200);
  if(error||!Array.isArray(data))throw Error('AVAILABILITY_MONITOR_DB_READ_FAILED');return data;
 });
 console.log(JSON.stringify(stats));
}
main().catch(()=>{console.error('AVAILABILITY_MONITOR_FAILED; no paid fallback; inspect state/DB/connectivity');process.exitCode=1;});
