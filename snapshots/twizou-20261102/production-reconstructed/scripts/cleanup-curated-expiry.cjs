// Free DB housekeeping only. Does not import the collector or the X client.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const env=fs.readFileSync(process.env.XCLIP_EXPIRY_ENV||path.join(root,'.env.production'),'utf8');
const value=n=>env.split(/\r?\n/).find(x=>x.startsWith(n+'='))?.slice(n.length+1).trim().replace(/^['"]|['"]$/g,'');
const url=value('SUPABASE_URL')||value('NEXT_PUBLIC_SUPABASE_URL');
const key=value('SUPABASE_SECRET_KEY')||value('SUPABASE_SERVICE_ROLE_KEY');
if(!url||!key)throw new Error('DB_ENV_MISSING');
const {createClient}=require('@supabase/supabase-js');
const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const m={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(root,'lib/curated-search-expiry.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const {planCuratedSearchExpiry,persistCuratedSearchExpiry}=m.exports;
(async()=>{
 const totals={checked:0,clamped:0,restarted:0,unchanged:0,failed:0};
 const now=Date.now();
 for(let offset=0;;offset+=200){
  const r=await db.from('authors').select('x_author_id,username,curated_pending_search,curated_search_expiry').eq('is_curated',true).eq('curated_status','active').not('curated_pending_search','is',null).order('x_author_id').range(offset,offset+199);
  if(r.error)throw new Error('EXPIRY_AUTHOR_READ_FAILED: '+r.error.message);
  for(const author of r.data||[]){
   totals.checked++;
   try{
    const plan=planCuratedSearchExpiry(author.curated_pending_search,author.curated_search_expiry,now);
    if(!plan.event){totals.unchanged++;continue;}
    await persistCuratedSearchExpiry(db,author,plan);
    if(plan.event.action==='clamp')totals.clamped++;else totals.restarted++;
    console.log('EXPIRY_STATE_UPDATED',JSON.stringify({author:author.username,...plan.event}));
   }catch(e){totals.failed++;console.error('EXPIRY_STATE_NOT_CHANGED',JSON.stringify({author:author.username,error:e.message}));}
  }
  if((r.data?.length||0)<200)break;
 }
 console.log('EXPIRY_CLEANUP',JSON.stringify(totals));
 console.log('NO_X_API_COLLECTION_RUN; SAVED_POSTS_AND_SUCCESS_CURSORS_UNCHANGED');
 if(totals.failed)process.exitCode=1;
})().catch(e=>{console.error(e.message);console.error('NO_X_API_COLLECTION_RUN');process.exitCode=1;});
