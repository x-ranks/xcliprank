const fs=require('fs'),fsp=require('fs/promises'),path=require('path'),os=require('os'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();let logs=[];
const stub={'lib/curated-common':{ensureCommonAuthor:async()=> 'active'},'lib/supabase-admin':{supabaseAdmin(){return {from(){return {update(){return this},eq(){return this},then(ok){return Promise.resolve({error:null}).then(ok)}}}}}},'lib/x':{recordXApiUsage:async r=>logs.push(r)},
 'lib/free-curated-publish':{publishFreeCandidates(){throw Error('REAL_PUBLISH_FORBIDDEN')}},'lib/post-status-store':{unavailableKeys:async()=>new Set()}};
function load(id){if(stub[id])return stub[id];if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const store=load('lib/free-curated-server-store'),scan=load('lib/free-curated-scan'),xstore=load('lib/x-curated-state'),search=load('lib/x-curated-search');
// Quota/pagination unit suite isolates shared-DB reconciliation; real reconciliation is covered by test-curated-common.
scan.importLegacyAuthors=async()=>{};
scan.scanFreeCurated=load('lib/x-curated-scan').scanXCurated;
const DAY=86400000,start=Date.UTC(2026,9,11,12),sid=t=>(((BigInt(t)-1288834974657n)<<22n)+1n).toString();
const author=(i,t=start)=>({...load('lib/free-curated-scan').newScheduledAuthor({id:String(100+i),username:'test'+i,name:'Test',expectedTier:'S'},'free',t),latestId:sid(t-3600000)});
function db(baseline=null){return {from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},then(ok,bad){return Promise.resolve({data:table==='authors'?[]:baseline?[{x_post_id:baseline}]:[],error:null}).then(ok,bad)}};return q}}}
const empty=()=>Response.json({meta:{result_count:0}});
function page(a,ids,next){return Response.json({data:ids.map(id=>({id,author_id:a.id,text:'video',possibly_sensitive:false,created_at:new Date(search.snowflakeTime(id)).toISOString(),attachments:{media_keys:['v'+id]},public_metrics:{like_count:2}})),
 includes:{media:ids.map(id=>({media_key:'v'+id,type:'video',duration_ms:10000,preview_image_url:'https://pbs.twimg.com/a.jpg',variants:[{content_type:'video/mp4',bit_rate:100,url:'https://video.twimg.com/'+id+'.mp4'}]}))},meta:{result_count:ids.length,...(next?{next_token:next}:{})}})}
const directories=[];
async function fixture(authors,time=start){const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-x-hybrid-'));directories.push(directory);let clock=time,calls=[],saved=[],fail=false;
 await store.writeScheduledFreeState({...store.freshFreeState(),authors},directory);
 const options={directory,database:db(),now:()=>clock,token:'MOCK_TOKEN',blocked:async()=>new Set(),pause:async()=>{},fetcher:async(url,o)=>{const u=new URL(url);assert.equal(u.origin,'https://api.x.com');assert.equal(u.pathname,'/2/tweets/search/recent');assert.equal(o.redirect,'error');assert.equal(o.headers.Authorization,'Bearer MOCK_TOKEN');assert.equal(u.searchParams.get('expansions'),'attachments.media_keys');assert.equal(u.searchParams.get('max_results'),'100');calls.push(u);return empty()},
 publish:async(a,p)=>{if(fail)throw Error('DB_FAILURE');saved.push(...p.map(v=>v.x_post_id));return {saved:p.length,promoted:0,excluded:0,duplicates:0,paid_x_requests:0}}};
 return {directory,options,calls,saved,set time(t){clock=t},get time(){return clock},set fail(v){fail=v}};}
(async()=>{try{
 const list=Array.from({length:30},(_,i)=>author(i));list[25].paused=true;list[26].initialPending=true;
 const f=await fixture(list);f.options.blocked=async()=>new Set(['id:'+list[27].id]);
 for(let batch=0;batch<3;batch++){f.time=start+batch*3*3600000;const r=await scan.scanFreeCurated(f.options);assert.equal(r.processed,8)}
 assert.equal(f.calls.length,24);f.time=start+12*3600000;assert.equal((await scan.scanFreeCurated(f.options)).skip_reason,'daily_author_limit');assert.equal(f.calls.length,24);
 const persisted=await xstore.readXState(f.directory);assert.equal(persisted.reservations.length,24);assert.equal(new Set(persisted.reservations.map(v=>v.id)).size,24);
 f.time=start+DAY;assert.equal((await scan.scanFreeCurated(f.options)).processed,8);assert.equal(xstore.activeReservations(await xstore.readXState(f.directory),f.time).length,24);
 const a=author(50),g=await fixture([a]);let step=0;const high=sid(start-60000),low=sid(start-120000);
 const s=await store.readScheduledFreeState(g.directory);s.authors[0].pendingCursor='FX_CURSOR_MUST_NOT_LEAK';s.authors[0].baselineId=a.latestId;s.authors[0].pendingLatestId=sid(start-1000);await store.writeScheduledFreeState(s,g.directory);
 g.options.fetcher=async(url)=>{const u=new URL(url);g.calls.push(u);assert.equal(u.searchParams.get('since_id'),a.latestId);assert(!url.includes('FX_CURSOR'));
   if(step===0){assert.equal(u.searchParams.get('next_token'),null);return page(a,[high],'X_NEXT')}
   assert.equal(u.searchParams.get('next_token'),'X_NEXT');assert.equal(u.searchParams.get('end_time'),g.calls[0].searchParams.get('end_time'));return page(a,[low])};
 assert.equal((await scan.scanFreeCurated(g.options)).pending,1);let xp=(await xstore.readXState(g.directory)).positions[a.id];assert.equal(xp.sinceId,a.latestId);assert.equal(xp.nextToken,'X_NEXT');
 assert.equal((await store.readScheduledFreeState(g.directory)).authors[0].latestId,a.latestId);
 step=1;g.time+=DAY;g.fail=true;assert.equal((await scan.scanFreeCurated(g.options)).failed,1);xp=(await xstore.readXState(g.directory)).positions[a.id];assert.equal(xp.sinceId,a.latestId);assert.equal(xp.nextToken,'X_NEXT');
 g.time+=DAY;g.fail=false;await scan.scanFreeCurated(g.options);xp=(await xstore.readXState(g.directory)).positions[a.id];assert.equal(xp.sinceId,high);assert.equal(xp.nextToken,null);assert.deepEqual(g.saved,[high,low]);assert.equal((await store.readScheduledFreeState(g.directory)).authors[0].pendingCursor,null);
 const old=author(60);old.latestId=sid(start-30*DAY);const h=await fixture([old]);await scan.scanFreeCurated(h.options);assert(h.calls[0].searchParams.has('start_time'));assert(!h.calls[0].searchParams.has('since_id'));assert((await xstore.readXState(h.directory)).positions[old.id].warning);
 for(const status of [401,402,403,429]){const r=await fixture([author(61),author(62)]);r.options.fetcher=async()=>new Response('',{status,headers:{'x-rate-limit-reset':String((start+DAY)/1000)}});const result=await scan.scanFreeCurated(r.options);assert.equal(result.processed,2);assert.equal(result.failed,2);assert.equal(result.stopped,false);const xs=await xstore.readXState(r.directory);assert.equal(xs.cooldownUntil,0);assert.equal(xs.reservations.length,2);assert.equal(xs.positions['161'].sinceId,author(61).latestId)}
 const j=await fixture([author(70),author(71)]);j.options.fetcher=async()=>{throw Error('NETWORK')};assert.equal((await scan.scanFreeCurated(j.options)).processed,2);assert.equal((await xstore.readXState(j.directory)).cooldownUntil,0);
 const partial=await fixture([author(72)]);partial.options.fetcher=async()=>Response.json({data:[],meta:{result_count:0},errors:[{title:'partial'}]});assert.equal((await scan.scanFreeCurated(partial.options)).failed,1);
 const bad=await fixture([author(73)]);bad.options.fetcher=async()=>Response.json({});assert.equal((await scan.scanFreeCurated(bad.options)).failed,1);
 const no=author(74);no.latestId=null;const pending=author(75);pending.initialPending=true;const k=await fixture([no,pending]);await scan.scanFreeCurated(k.options);assert.equal(k.calls.length,0);assert.match((await store.readScheduledFreeState(k.directory)).authors[0].lastError,/取得基準/);
 const fallback=await fixture([no]);fallback.options.database=db(sid(start-7200000));await scan.scanFreeCurated(fallback.options);assert.equal(fallback.calls[0].searchParams.get('since_id'),sid(start-7200000));
 const lock=await fixture([author(76)]);await fsp.mkdir(path.join(lock.directory,'operation.lock'));await assert.rejects(scan.scanFreeCurated(lock.options),e=>e.status===409);assert.equal(lock.calls.length,0);await fsp.rmdir(path.join(lock.directory,'operation.lock'));
 // Sync/registration metadata does not reset quota, move an established X position, or unpause an omitted author.
 process.env.SUPABASE_URL='https://example.supabase.co';const sync=load('lib/free-curated-sync');
 let q=await fixture([author(80)]);await scan.scanFreeCurated(q.options);const before=JSON.stringify(await xstore.readXState(q.directory));
 const incoming={id:'180',username:'test80',name:'Test',expectedTier:'S',paused:false,initialPending:true,initialBaselineId:sid(start-20000)};
 await sync.synchronizeFreeCurated({action:'sync',databaseHost:'example.supabase.co',authors:[incoming]},{directory:q.directory});assert.equal(JSON.stringify(await xstore.readXState(q.directory)),before);
 await sync.synchronizeFreeCurated({action:'publish',databaseHost:'example.supabase.co',id:'180',candidates:[],registrationComplete:true,initialBaselineId:sid(start-20000)},{directory:q.directory});assert.equal((await store.readScheduledFreeState(q.directory)).authors[0].initialPending,false);
 await sync.synchronizeFreeCurated({action:'sync',databaseHost:'example.supabase.co',authors:[]},{directory:q.directory});assert.equal((await store.readScheduledFreeState(q.directory)).authors[0].paused,false);assert.equal(JSON.stringify(await xstore.readXState(q.directory)),before);
 const xfile=path.join(q.directory,'x-api-v1.json');await fsp.writeFile(xfile,'bad');await assert.rejects(scan.scanFreeCurated(q.options),/X_API_STATE_INVALID/);assert.equal(await fsp.readFile(xfile,'utf8'),'bad');
 const parsed=sync.parseSyncAuthor(incoming);assert.equal(parsed.initialPending,true);assert.throws(()=>sync.parseSyncAuthor({...incoming,initialPending:'bad'}));
 // Check invalid author/media and partial responses without advancing the watermark.
 const pos={sinceId:sid(start-3600000),nextToken:null,endTime:new Date(start-30000).toISOString(),startTime:null,newestId:null,warning:null,checkedAt:0,savedTotal:0,rawTotal:0};
 let b=await page(author(90),[high]).json();b.data[0].author_id='999';await assert.rejects(search.searchXCurated(author(90),pos,{now:start,token:'mock',fetcher:async()=>Response.json(b)}),/照合/);
 b=await page(author(90),[high]).json();b.includes.media[0].variants[0].url='https://evil.test/a.mp4';await assert.rejects(search.searchXCurated(author(90),pos,{now:start,token:'mock',fetcher:async()=>Response.json(b)}),/再生URL/);
 console.log('PASS HYBRID: rolling-24h quota/restart; reservation before request; 24h per author; pause/unregister/initial/block guards; Fx lower-bound migration; immutable X pagination window; DB failure retains cursor; empty/partial/malformed/foreign/media checks; recent-search expiry; auth/credits/429/outage continue and count failed author; same lock; baseline fallback; sync preserves quota/position. All HTTP and DB mocked.');
 }finally{for(const d of directories){if(!path.resolve(d).startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(d).startsWith('xclip-x-hybrid-'))throw Error('UNSAFE_TEST_CLEANUP');await fsp.rm(d,{recursive:true,force:true})}}})().catch(e=>{console.error(e);process.exitCode=1});
