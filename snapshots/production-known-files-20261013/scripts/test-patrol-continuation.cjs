const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
let usage=[];
const stubs={'lib/supabase-admin':{supabaseAdmin(){throw Error('REAL_DB_FORBIDDEN')}},
 'lib/free-curated-publish':{publishFreeCandidates(){throw Error('REAL_PUBLISH_FORBIDDEN')}},
 'lib/x':{recordXApiUsage:async row=>usage.push(row)},'lib/post-status-store':{unavailableKeys:async()=>new Set()}};
function load(id){if(stubs[id])return stubs[id];if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);
const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const store=load('lib/free-curated-server-store'),scan=load('lib/free-curated-scan'),xs=load('lib/x-curated-state');
scan.importLegacyAuthors=async()=>{};
scan.scanFreeCurated=load('lib/x-curated-scan').scanXCurated;
const DAY=86400000,START=Date.UTC(2026,9,12,0),sid=t=>(((BigInt(t)-1288834974657n)<<22n)+1n).toString();
const author=i=>({...scan.newScheduledAuthor({id:String(1000+i),username:'mock'+i,name:'Mock',expectedTier:'S'},'free',START),latestId:sid(START-3600000)});
const dirs=[];
async function fixture(authors){const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-patrol-'));dirs.push(directory);
let now=START,calls=0;await store.writeScheduledFreeState({...store.freshFreeState(),authors},directory);
const options={directory,database:{from(){throw Error('BASELINE_LOOKUP_NOT_EXPECTED')}},now:()=>now,token:'MOCK_ONLY',pause:async()=>{},blocked:async()=>new Set(),
 fetcher:async()=>{calls++;return new Response('',{status:401})},publish:async()=>({saved:0,promoted:0})};
return {directory,options,get calls(){return calls},set time(v){now=v}};}
(async()=>{try{
 const all=await fixture(Array.from({length:95},(_,i)=>author(i)));
 for(let i=0;i<3;i++){all.time=START+i*3*3600000;const r=await scan.scanFreeCurated(all.options);assert.equal(r.processed,8);assert.equal(r.failed,8);assert.equal(r.stopped,false);assert.equal(r.skip_reason,'author_errors_continued');}
 assert.equal(all.calls,24);let x=await xs.readXState(all.directory);assert.equal(x.reservations.length,24);assert.equal(new Set(x.reservations.map(r=>r.id)).size,24);
 all.time=START+12*3600000;assert.equal((await scan.scanFreeCurated(all.options)).skip_reason,'daily_author_limit');assert.equal(all.calls,24);
 // Re-loading the modules does not release failed reservations. At 24h rotate to previously unvisited authors.
 cache.delete('lib/x-curated-scan');all.time=START+DAY;const r=await scan.scanFreeCurated(all.options);assert.equal(r.processed,8);
 x=await xs.readXState(all.directory);assert(x.reservations.some(r=>r.id==='1024'));assert.equal(x.positions['1000'].sinceId,author(0).latestId);
 const cooldown=await fixture([author(200),author(201)]);let state=await store.readScheduledFreeState(cooldown.directory);state.cooldownUntil=START+10*DAY;await store.writeScheduledFreeState(state,cooldown.directory);
 x=xs.freshXState();x.cooldownUntil=START+10*DAY;await xs.writeXState(x,cooldown.directory);
 assert.equal((await scan.scanFreeCurated(cooldown.options)).processed,2);assert.equal((await xs.readXState(cooldown.directory)).cooldownUntil,0);
 const no=author(300);no.latestId=null;const b=await fixture([no,author(301)]);
 b.options.database={from(){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},then(ok){return Promise.resolve({data:null,error:{message:'MOCK_DB_FAILURE'}}).then(ok)}};return q}};
 const br=await scan.scanFreeCurated(b.options);assert.equal(br.processed,2);assert.equal(br.failed,2);assert.equal(b.calls,1);assert.equal((await xs.readXState(b.directory)).reservations.length,2);
 const missing=await fixture([author(400),author(401)]);missing.options.token='';const mr=await scan.scanFreeCurated(missing.options);assert.equal(mr.processed,2);assert.equal(mr.failed,2);assert.equal(mr.paid_x_requests,0);assert.equal(missing.calls,0);
 const future=author(500);future.latestId=sid(START+DAY);const ff=await fixture([future,author(501)]);assert.equal((await scan.scanFreeCurated(ff.options)).processed,2);assert.equal(ff.calls,1);assert.equal((await xs.readXState(ff.directory)).reservations.length,2);
 // Success after an error still publishes and advances only the successful author's position.
 const mixed=await fixture([author(600),author(601)]);let n=0,saves=0;const newest=sid(START-60000);
 mixed.options.fetcher=async()=>{if(n++===0)return new Response('',{status:403});return Response.json({data:[{id:newest,author_id:'1601',text:'mock',possibly_sensitive:false,created_at:new Date(START-60000).toISOString(),attachments:{media_keys:['v']}}],includes:{media:[{media_key:'v',type:'video',variants:[{content_type:'video/mp4',url:'https://video.twimg.com/mock.mp4'}]}]},meta:{result_count:1}})};
 mixed.options.publish=async()=>{saves++;return {saved:1,promoted:0}};const mix=await scan.scanFreeCurated(mixed.options);assert.equal(mix.failed,1);assert.equal(mix.saved,1);assert.equal(saves,1);
 x=await xs.readXState(mixed.directory);assert.equal(x.positions['1600'].sinceId,author(600).latestId);assert.equal(x.positions['1601'].sinceId,newest);
 // Reservation durability failure must halt before a request; no unsafe continuation with lost quota.
 const invalid=await fixture([author(700)]);await fsp.writeFile(path.join(invalid.directory,'x-api-v1.json'),'corrupt');await assert.rejects(scan.scanFreeCurated(invalid.options),/X_API_STATE_INVALID/);assert.equal(invalid.calls,0);
 console.log('PASS PATROL CONTINUATION: all errors count toward rolling 24; 8 per batch; fair restart/rotation; legacy cooldown ignored; baseline DB failure continues; auth missing counts without HTTP; future baseline; mixed failure/success; failed watermark preserved; corrupt quota prevents requests. All HTTP/DB mocked.');
}finally{for(const d of dirs){if(!d.startsWith(os.tmpdir()+path.sep)||!path.basename(d).startsWith('xclip-patrol-'))throw Error('UNSAFE_FIXTURE_PATH');await fsp.rm(d,{recursive:true,force:true})}}})().catch(e=>{console.error(e);process.exitCode=1});
