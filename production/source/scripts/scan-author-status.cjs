const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),sourceRequire=createRequire(path.join(root,'package.json')),ts=sourceRequire('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
async function priorityRows(){
 // Read the newest validated ranking edition; no public HTTP call or new provider request.
 const os=require('os'),fsp=fs.promises;
 const dir=path.resolve(process.env.XCLIP_RANKING_FEED_STATE_DIR || path.join(os.homedir(),'.xclip-ranking-feed'));
 let names;try{names=(await fsp.readdir(dir)).filter(n=>/^\d{13}-[a-f0-9]{12}\.json$/.test(n)).sort().reverse();}
 catch(e){if(e.code==='ENOENT')return [];throw e;}
 const {readEdition}=require('../lib/ranking-editions.ts');
 let plan=null;
 for(const name of names.slice(0,16)){
  try{plan=await readEdition(name.slice(0,-5));if(plan)break;}
  catch(e){if(e.message==='INVALID_RANKING_EDITION'||e.message==='RANKING_EDITION_EXPIRED')continue;throw e;}
 }
 if(!plan)return [];
 const ids=[...new Set([...plan.plans.daily.slice(0,100),...plan.plans.trending.slice(0,100),...plan.plans.weekly.slice(0,100)].map(p=>p.id))].slice(0,300);
 if(!ids.length)return [];
 const db=require('../lib/supabase-admin.ts').supabaseAdmin();
 const {data,error}=await db.from('posts').select('x_post_id,author_id,author_username').in('x_post_id',ids)
  .eq('collection_source','curated').eq('is_visible',true).eq('moderation_blocked',false).eq('review_required',false)
  .not('video_url','is',null)
  .or('adult_tier.in.(S,A+,A,B+,B,C),manual_tier.in.(S,A+,A,B+,B,C)')
  .or('manual_tier.is.null,manual_tier.in.(S,A+,A,B+,B,C)').limit(300);
 if(error||!Array.isArray(data))throw Error('AVAILABILITY_PRIORITY_DB_READ_FAILED');
 const rows=new Map(data.map(p=>[String(p.x_post_id),p])),groups=new Map();
 for(const [group,items]of [['daily',plan.plans.daily],['trending',plan.plans.trending],['weekly',plan.plans.weekly]])for(const post of items.slice(0,100))if(!groups.has(post.id))groups.set(post.id,group);
 return ids.map(id=>rows.has(id)?{...rows.get(id),monitorPriority:groups.get(id)}:null).filter(Boolean);
}
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
 }, {loadPriority: priorityRows});
 console.log(JSON.stringify(stats));
}
main().catch(()=>{console.error('AVAILABILITY_MONITOR_FAILED; no paid fallback; inspect state/DB/connectivity');process.exitCode=1;});
