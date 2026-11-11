'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),ts=require('typescript'),vm=require('vm'),os=require('os');
const root=p.resolve(__dirname,'..'),{NextRequest}=require('next/server');
function load(file,resolve=require,change=x=>x){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(change(fs.readFileSync(p.join(root,file),'utf8')),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
async function ranking(){
 if(!fs.readFileSync(p.join(root,'app/api/rankings/route.ts'),'utf8').includes('ELIGIBILITY_FIELDS'))return {localProductionProxyPreserved:true};
 const snapshot=Math.floor(Date.now()/300000)*300000,edition=snapshot+'-aaaaaaaaaaaa';let blocked=new Set(),manual=[],queries=[],failure=false;
 const rows=Array.from({length:500},(_,i)=>({id:'db-'+i,x_post_id:String(10000+i),author_id:i%40===0?'456':'123',author_username:i%40===0?'reference':'fixture',author_name:'Fixture',video_url:'https://video.twimg.com/'+i+'.mp4',preview_image_url:'https://pbs.twimg.com/'+i+'.jpg',adult_tier:'A',manual_tier:null,content_category:i===174?null:'PASS',text:i===174?'reject':'',manual_review_note:i===175?'content-filter review; verdict=false_positive':null,is_visible:true,moderation_blocked:false,review_required:false,score:i,views:i+1,likes:i,bookmarks:0,reposts:0,replies:0,created_at:'2026-10-20T00:00:00Z',provider_payload:'x'.repeat(20000)}));
 const refs=rows.filter(r=>r.author_id==='456').map(r=>({post_id:r.x_post_id,source_author_id:'456',selected_author_id:'123'}));
 const plan={version:1,edition,snapshot,plans:{trending:rows.map((r,i)=>({id:r.x_post_id,...(i%50===49?{ranking_supplemented:true}:{})})),daily:[],weekly:[],weeklyBase:[]},metadata:{generatedAt:'2026-10-28T00:00:00Z',filtered:{},liquidity:{},since:'2026-10-20T00:00:00Z'}};
 function from(table){let data=table==='authors'?[{x_author_id:'123',is_curated:true,curated_status:'active'}]:rows,selected='*';const q={select(s){selected=s;return q;},eq(k,v){data=data.filter(r=>r[k]===v);return q;},not(k,op,v){data=data.filter(r=>r[k]!==v);return q;},or(){return q;},order(){return q;},in(k,ids){data=data.filter(r=>ids.includes(r[k]));return q;},async range(a,b){if(failure)throw Error('FIXTURE_DB_ERROR');const r=data.slice(a,b+1).map(r=>selected==='*'?{...r}:Object.fromEntries(selected.split(',').filter(k=>k in r).map(k=>[k,r[k]])));queries.push({select:selected,rows:r.length,bytes:Buffer.byteLength(JSON.stringify(r))});return {data:r,error:null};},then(a,b){return Promise.resolve({data,error:null}).then(a,b);}};return q;}
 const resolver=n=>{
 if(n==='next/server')return require(n);
 if(n.endsWith('supabase-admin'))return {supabaseAdmin:()=>({from})};
 if(n.endsWith('post-status-store'))return {unavailableKeys:async()=>new Set(blocked)};
 if(n.endsWith('post-status'))return {isUnavailablePost:(r,b)=>b.has('post:'+r.x_post_id)||b.has('id:'+r.author_id)};
 if(n.endsWith('curated-video-references'))return {readCuratedReferences:async(db,ids)=>refs.filter(r=>!ids||ids.includes(r.post_id)),eligibleCuratedReferences:async(db,r)=>r,referencePermitsPost:(row,r)=>r.some(x=>x.post_id===row.x_post_id&&x.source_author_id===row.author_id)};
 if(n.endsWith('ranking-liquidity'))return {liquidityClock:()=>({snapshot})};
 if(n.endsWith('ranking-editions'))return {editionId:()=>edition,validateEditionId:()=>{},readEdition:async()=>plan};
 if(n.endsWith('ranking-pagination'))return load('lib/ranking-pagination.ts');
 if(n.endsWith('newest-feed'))return {NEWEST_TOTAL:500,NEWEST_PAGE_SIZE:50,NEWEST_AUTHOR_LIMIT:3};
 if(n.endsWith('ranking-update'))return load('lib/ranking-update.ts');
 if(n.endsWith('content-filter'))return {classifyContent:text=>({category:text==='reject'?'PROMO':'PASS'})};
 if(n.endsWith('manual-ranking'))return {readManualState:async()=>({entries:manual}),applyManualPlacements:(data,entries)=>{const result=[...data];for(const row of entries)result.splice(row.positions.trending-1,0,{...row,x_post_id:'manual:'+row.id});return result.slice(0,500);}};
 if(n.endsWith('public-ranking-history'))return {rememberRanking:async r=>r};
 return {};
 };
 const full=load('app/api/rankings/route.ts',resolver,s=>s.replace('.select(options.ids?.every(id => options.summaryIds?.has(id)) ? ELIGIBILITY_FIELDS : "*")','.select("*")'));
 const narrow=load('app/api/rankings/route.ts',resolver);
 async function request(route,page){const r=await route.GET(new NextRequest('http://fixture/api/rankings?range=trending'+(page===null?'':'&page='+page)));return {status:r.status,body:await r.json(),timing:r.headers.get('server-timing')};}
 let fullBytes=0,narrowBytes=0;
 for(let page=1;page<=10;page++){
  queries=[];const expected=await request(full,page);fullBytes+=queries.reduce((n,q)=>n+q.bytes,0);
  queries=[];const actual=await request(narrow,page);narrowBytes+=queries.reduce((n,q)=>n+q.bytes,0);
  assert.equal(actual.status,200);assert.deepEqual(actual.body,expected.body,'Page '+page+' ranks, holes, counts and fields must match full hydration');
  assert(queries.filter(q=>q.select==='*').reduce((n,q)=>n+q.rows,0)<=200,'At most one owned and one reference display batch (100 IDs each)');assert(actual.timing.includes('history;dur=')&&actual.timing.includes('ranking;dur='));
 }
 assert(narrowBytes<fullBytes*0.4,'Synthetic large metadata no longer crosses DB for off-page rows');
 rows[10].moderation_blocked=true;rows[20].is_visible=false;rows[30].review_required=true;rows[49].manual_tier='B';rows[105].manual_tier='D';blocked.add('post:10110');
 for(const page of [1,2,3,10])assert.deepEqual((await request(narrow,page)).body,(await request(full,page)).body,'Live exclusions/downgrades on same edition');
 // Changing the reference media cannot be rescued by a cached row.
 refs.splice(0,refs.length);assert.deepEqual((await request(narrow,1)).body,(await request(full,1)).body);
 manual=[{id:'fixture',url:'https://media.example.com/test.mp4',mediaUrl:'https://media.example.com/test.mp4',title:'Manual',positions:{trending:2,daily:null,weekly:null},updatedAt:'2026-10-20T00:00:00Z'}];
 queries=[];assert.deepEqual((await request(narrow,2)).body,(await request(full,2)).body,'Manual placements retain full hydration');assert(queries.every(q=>q.select==='*'));
 manual=[];queries=[];const unpaged=await request(narrow,null);assert.equal(unpaged.status,200);assert(queries.every(q=>q.select==='*'),'Unpaged API remains full contract');
 failure=true;assert.equal((await request(narrow,1)).status,503);failure=false;assert.equal((await request(narrow,1)).status,200,'Failed queries are retried, never cached');
 return {tenPagesDifferential:true,currentExclusions:true,manualFullHydration:true,unpagedApiPreserved:true,syntheticFullDbBytes:fullBytes,syntheticNarrowDbBytes:narrowBytes,notProductionSpeedMeasurement:true};
}
async function catalog(){
 const Module=require('module');Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
 const {createPublicCatalog}=require(p.join(root,'lib/public-catalog-store.ts')),core=require(p.join(root,'lib/public-video-core.ts'));
 const dir=fs.mkdtempSync(p.join(os.tmpdir(),'twizou-speed-v3-')),file=p.join(dir,'catalog.json'),store=createPublicCatalog(dir),id='12345',value=core.blankCatalog();value.records[id]=core.blankRecord(id);value.records[id].firstRankedAt='2026-10-20T00:00:00Z';fs.writeFileSync(file,JSON.stringify(value));
 const original=fs.promises.readFile;let reads=0;fs.promises.readFile=async function(f,...args){if(String(f)===file)reads++;return original.call(this,f,...args);};
 try{
  const first=await store.read();first.records[id].saves=999;first.labels.push({id:'bad',name:'bad',active:true});
  const second=await createPublicCatalog(dir).read();assert.equal(second.records[id].saves,0);assert.equal(second.labels.length,0);assert.equal(reads,1,'Validated snapshot shared by file identity, with defensive copies');
  value.revision=1;fs.writeFileSync(p.join(dir,'replacement'),JSON.stringify(value));fs.renameSync(p.join(dir,'replacement'),file);assert.equal((await store.read()).revision,1);assert.equal(reads,2,'Atomic external update invalidates cache');
  const c=await store.ranked(['67890'],'2026-10-20T00:00:00Z');assert(c.records['67890'].firstRankedAt);assert.equal((await createPublicCatalog(dir).read()).revision,2,'Own mutation invalidates snapshot');
  fs.writeFileSync(file,'{"version":99}');await assert.rejects(store.read(),/PUBLIC_CATALOG_UNREADABLE/);fs.unlinkSync(file);assert.equal((await store.read()).revision,0,'Deleted ledger is not served from cache');
 }finally{fs.promises.readFile=original;if(p.dirname(dir)!==p.resolve(os.tmpdir())||!p.basename(dir).startsWith('twizou-speed-v3-'))throw Error('UNSAFE_CLEANUP');fs.rmSync(dir,{recursive:true,force:true});}
 return {cloneIsolation:true,externalAtomicInvalidation:true,mutationInvalidation:true,corruptAndMissingFresh:true};
}
async function main(){
 const layout=fs.readFileSync(p.join(root,'app/layout.tsx'),'utf8'),script=layout.match(/__html: `([^`]+)`/)[1];
 for(const value of [null,'no','1','yes','invalid']){const attrs={};vm.runInNewContext(script,{localStorage:{getItem:key=>{assert.equal(key,'xcliprank_age_confirmed_v1');return value;}},document:{documentElement:{setAttribute:(k,v)=>attrs[k]=v}}});assert.deepEqual(attrs,value==='yes'?{'data-age-confirmed':'yes'}:{});}
 vm.runInNewContext(script,{localStorage:{getItem(){throw Error('denied');}},document:{documentElement:{setAttribute(){throw Error('AGE_BYPASS');}}}});
 const age=fs.readFileSync(p.join(root,'app/components/AgeGate.tsx'),'utf8');assert(age.includes('18歳以上ですか？')&&age.includes('removeAttribute("data-age-confirmed")'));
 for(const file of ['app/page.tsx','app/components/DedicatedRankingPage.tsx','app/rising/page.tsx']){const text=fs.readFileSync(p.join(root,file),'utf8');assert(!/<Link(?![^>]*prefetch=)/.test(text),file+' must explicitly avoid automatic prefetch');}
 const client=fs.readFileSync(p.join(root,'app/components/RankingClient.tsx'),'utf8');assert(client.includes('width={392}')&&client.includes('loading={index < 3 ? "eager" : "lazy"}')&&client.includes('fetchPriority={index === 0 ? "high" : "auto"}'));
 const result={ageBootstrapFailClosed:true,explicitNoPrefetch:true,...await ranking(),catalog:await catalog()};
 console.log('PASS SPEED V3 '+JSON.stringify(result));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
