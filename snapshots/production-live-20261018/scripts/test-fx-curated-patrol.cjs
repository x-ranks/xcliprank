const fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
const stubs={'lib/supabase-admin':{supabaseAdmin(){throw Error('REAL_DB_FORBIDDEN')}},
 'lib/free-curated-publish':{publishFreeCandidates(){throw Error('REAL_PUBLISH_FORBIDDEN')},emptyPublicationOutcomes:()=>({unavailable:0,contentOrReview:0,tier:0,knownPostOrMedia:0,batchDuplicate:0,insertRace:0})},
 'lib/x':{recordXApiUsage(){throw Error('X_API_USAGE_FORBIDDEN')}},'lib/post-status-store':{unavailableKeys(){throw Error('REAL_STATE_FORBIDDEN')}}};
function load(id){if(stubs[id])return stubs[id];if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const store=load('lib/free-curated-server-store'),scan=load('lib/free-curated-scan'),xs=load('lib/x-curated-state'),fxs=load('lib/fx-curated-state');
scan.importLegacyAuthors=async()=>{};
const DAY=86400000,START=Date.UTC(2026,9,11,0),sid=t=>(((BigInt(t)-1288834974657n)<<22n)+1n).toString();
const author=i=>({...scan.newScheduledAuthor({id:String(1000+i),username:'mock'+i,name:'Mock',expectedTier:'S'},'free',START),latestId:sid(START-3600000)});
const post=(a,id)=>({type:'status',provider:'twitter',id,text:'mock video',author:{id:a.id,screen_name:a.username,protected:false},
 created_timestamp:Number((BigInt(id)>>22n)+1288834974657n)/1000,possibly_sensitive:false,
 media:{videos:[{type:'video',format:'video/mp4',url:'https://video.twimg.com/'+id+'.mp4'}]}});
const page=(a,ids,cursor=null)=>Response.json({code:200,results:ids.map(id=>post(a,id)),cursor:{bottom:cursor}});
const dirs=[];
async function fixture(authors){const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-fx-patrol-'));dirs.push(directory);
 let time=START;const calls=[],saved=[];await store.writeScheduledFreeState({...store.freshFreeState(),authors},directory);
 const options={directory,database:{from(){throw Error('UNEXPECTED_DB_READ')}},now:()=>time,pause:async()=>{},blocked:async()=>new Set(),
  fetcher:async(url,o)=>{const u=new URL(url);assert.equal(u.origin,'https://api.fxtwitter.com');assert.match(decodeURIComponent(u.pathname),/^\/2\/profile\/id:\d+\/statuses$/);
   assert.equal(u.searchParams.get('count'),'100');assert(!o.headers.Authorization);assert.equal(o.credentials,'omit');assert.equal(o.redirect,'error');calls.push(u);return new Response('',{status:429});},
  publish:async(a,posts)=>{saved.push(...posts.map(p=>p.x_post_id));return {saved:posts.length,promoted:0,excluded:0,duplicates:0,paid_x_requests:0}}};
 return {directory,options,calls,saved,set time(t){time=t},get time(){return time}};
}
const run=f=>scan.scanFreeCurated(f.options);
(async()=>{try{
 const all=await fixture(Array.from({length:95},(_,i)=>author(i)));
 for(let i=0;i<3;i++){all.time=START+i*3*3600000;const r=await run(all);assert.equal(r.provider,'fxtwitter');assert.equal(r.processed,8);assert.equal(r.failed,8);assert.equal(r.paid_x_requests,0);assert.equal(r.stopped,false);}
 assert.equal(all.calls.length,24);all.time=START+12*3600000;assert.equal((await run(all)).skip_reason,'daily_author_limit');assert.equal(all.calls.length,24);
 assert.equal((await xs.readXState(all.directory)).requests,0);assert.equal((await fxs.readFxState(all.directory)).attempts,24);
 cache.delete('lib/fx-curated-scan');all.time=START+DAY;assert.equal((await run(all)).processed,8);
 assert((await xs.readXState(all.directory)).reservations.some(r=>r.id==='1024'));
 // Existing X reservations, lower-bound window, and cumulative paid metrics survive provider switching.
 const a=author(200),migration=await fixture([a]);let x=xs.freshXState();x.requests=7;x.rawPosts=11;x.cooldownUntil=START+DAY;
 const lower=sid(START-2*3600000),high=sid(START-60000),xp={sinceId:lower,nextToken:'X_MUST_NOT_LEAK',endTime:new Date(START).toISOString(),startTime:null,newestId:high,warning:'old coverage',checkedAt:START,savedTotal:1,rawTotal:11};
 x.positions[a.id]=xp;x.reservations=Array.from({length:23},(_,i)=>({id:String(9000+i),at:START}));await xs.writeXState(x,migration.directory);
 migration.options.fetcher=async(url,o)=>{assert(!url.includes('X_MUST_NOT_LEAK'));assert(!o.headers.Authorization);migration.calls.push(new URL(url));return page(a,[high,a.latestId,lower]);};
 let r=await run(migration);assert.equal(r.saved,2);assert.deepEqual(migration.saved,[high,a.latestId]);x=await xs.readXState(migration.directory);
 assert.equal(x.reservations.length,24);assert.deepEqual(x.positions[a.id],xp);assert.equal(x.requests,7);assert.equal(x.rawPosts,11);assert.equal(x.cooldownUntil,START+DAY);
 assert.equal((await fxs.readFxState(migration.directory)).positions[a.id].sinceId,high);
 // Legacy Fx continuation starts at its LOWER bound, never its old feed cursor/newest pending ID.
 const la=author(205),legacy=await fixture([la]);let ls=await store.readScheduledFreeState(legacy.directory);ls.authors[0].pendingCursor='OLD_MEDIA_CURSOR';ls.authors[0].baselineId=lower;ls.authors[0].pendingLatestId=high;await store.writeScheduledFreeState(ls,legacy.directory);
 legacy.options.fetcher=async(url)=>{assert(!url.includes('OLD_MEDIA_CURSOR'));assert(!new URL(url).searchParams.has('cursor'));return page(la,[high,la.latestId,lower]);};assert.equal((await run(legacy)).saved,2);assert.equal((await fxs.readFxState(legacy.directory)).positions[la.id].sinceId,high);
 // A prior failed X attempt still blocks that same author for the full rolling day.
 const reserved=await fixture([author(210)]);x=xs.freshXState();x.reservations=[{id:'1210',at:START}];await xs.writeXState(x,reserved.directory);
 assert.equal((await run(reserved)).processed,0);assert.equal(reserved.calls.length,0);
 // Snapshot upper bound + pinned old post + durable paging; publication failure cannot skip the page.
 const b=author(220),paged=await fixture([b]),newer=sid(START-30000),middle=sid(START-120000),old=sid(START-2*3600000),above=sid(START+60000);
 let step=0,fail=false;paged.options.fetcher=async(url)=>{const u=new URL(url);paged.calls.push(u);
  if(step===0){assert(!u.searchParams.has('cursor'));return page(b,[old,newer],'FX_NEXT');}
  assert.equal(u.searchParams.get('cursor'),'FX_NEXT');return page(b,[above,middle,old]);};
 paged.options.publish=async(a,p)=>{if(fail)throw Error('MOCK_DB_FAILURE');paged.saved.push(...p.map(v=>v.x_post_id));return {saved:p.length,promoted:0}};
 const ceiling=t=>(((BigInt(t)-1288834974657n)<<22n)+4194303n).toString();
 assert.equal((await run(paged)).pending,1);let fp=(await fxs.readFxState(paged.directory)).positions[b.id];assert.equal(fp.sinceId,b.latestId);assert.equal(fp.upperId,ceiling(START));
 step=1;fail=true;paged.time+=DAY;assert.equal((await run(paged)).failed,1);assert.deepEqual((await fxs.readFxState(paged.directory)).positions[b.id],fp);
 fail=false;paged.time+=DAY;assert.equal((await run(paged)).saved,1);assert.deepEqual(paged.saved,[newer,middle]);fp=(await fxs.readFxState(paged.directory)).positions[b.id];assert.equal(fp.sinceId,newer);assert.equal(fp.cursor,null);assert.equal(fp.newestId,undefined);
 // New posts arriving outside the frozen window remain eligible for the next pass.
 paged.time+=DAY;paged.options.fetcher=async()=>page(b,[above,newer]);assert.equal((await run(paged)).saved,1);assert.equal(paged.saved.at(-1),above);
 // Baseline completion stops old pagination; a pinned old item on a mixed page did not stop the prior page.
 const boundary=await fixture([author(230)]);boundary.options.fetcher=async()=>page(author(230),[old],'UNNEEDED_OLDER_PAGE');assert.equal((await run(boundary)).pending,0);assert.equal(boundary.saved.length,0);
 // X has:videos -is:retweet includes an author's video replies; keep that scheduled behavior.
 const ra=author(235),reply=await fixture([ra]);reply.options.fetcher=async()=>Response.json({code:200,results:[{...post(ra,high),replying_to:'other',reposted_by:null}]});assert.equal((await run(reply)).saved,1);
 const parser=load('lib/fxtwitter-curated');assert.equal(parser.parseFreeMediaPage({code:200,results:[{...post(ra,high),replying_to:'other'}]},ra).posts.length,0);assert.equal(parser.parseFreeMediaPage({code:200,results:[{...post(ra,high),reposted_by:{id:'999'}}]},ra,true).posts.length,0);
 // Unknown or conflicting response, empty response preserve the watermark.
 for(const kind of ['empty','foreign','conflict','missingtype','missingprovider','missingauthor','wrongrepost','nonjson','timeout']){
  const a=author(240),f=await fixture([a]);f.options.fetcher=async()=>{
   if(kind==='timeout')throw Error('network');if(kind==='nonjson')return new Response('<html>blocked</html>');
   if(kind==='empty')return page(a,[]);if(kind==='foreign')return page(author(999),[high]);
   const p=post(a,high);
   if(kind==='missingtype')delete p.type;if(kind==='missingprovider')delete p.provider;if(kind==='missingauthor')delete p.author;
   if(kind==='wrongrepost')p.reposted_by={id:'99999'};
   return Response.json({code:200,results:kind==='conflict'?[p,{...p,text:'conflicting duplicate'}]:[p]});};
  assert.equal((await run(f)).failed,1,kind);assert.equal((await fxs.readFxState(f.directory)).positions[a.id].sinceId,a.latestId,kind);assert.equal(f.saved.length,0);
 }
 // A normal page can contain a pinned duplicate and a foreign post reposted by this author.
 const ma=author(245),mp=await fixture([ma]);
 const own=post(ma,high),rp={...post(author(999),sid(START+60000)),reposted_by:{id:ma.id,name:ma.name,screen_name:ma.username}};
 mp.options.fetcher=async()=>Response.json({code:200,results:[own,own,rp]});
 assert.equal((await run(mp)).saved,1);assert.deepEqual(mp.saved,[high]);
 assert.equal((await fxs.readFxState(mp.directory)).positions[ma.id].sinceId,high); // No foreign ID advancement.
 // Linked foreign conversation posts cannot end an old-only page or contribute their IDs/media to publication.
 const ca=author(244),conversation=await fixture([ca]);let contextNext=false;
 const parent={...post(author(999),above)},ownOld={...post(ca,old),replying_to:{status:above}};
 conversation.options.fetcher=async url=>{if(!contextNext)return Response.json({code:200,results:[parent,ownOld],cursor:{bottom:'CONTEXT_NEXT'}});
  assert.equal(new URL(url).searchParams.get('cursor'),'CONTEXT_NEXT');return page(ca,[high]);};
 assert.equal((await run(conversation)).pending,1);assert.equal(conversation.saved.length,0);
 contextNext=true;conversation.time+=DAY;assert.equal((await run(conversation)).saved,1);assert.deepEqual(conversation.saved,[high]);
 assert.equal((await fxs.readFxState(conversation.directory)).positions[ca.id].sinceId,high);
 // Repost-only/mixed-old pages with a cursor must continue; no premature old-boundary completion.
 for(const mixedOld of [false,true]){
  const a=author(mixedOld?247:246),f=await fixture([a]);let continuation=false;
  const repost={...post(author(999),above),reposted_by:{id:a.id}};
  f.options.fetcher=async url=>{if(!continuation)return Response.json({code:200,results:mixedOld?[post(a,old),repost]:[repost],cursor:{bottom:'MIX_NEXT'}});
   assert.equal(new URL(url).searchParams.get('cursor'),'MIX_NEXT');return page(a,[high,old]);};
  assert.equal((await run(f)).pending,1);let pos=(await fxs.readFxState(f.directory)).positions[a.id];
  assert.equal(pos.sinceId,a.latestId);assert.equal(pos.upperId,ceiling(START));
  // The first page had no newer own ID; the continuation must still be eligible within its frozen window.
  continuation=true;f.time+=DAY;assert.equal((await run(f)).saved,1);assert.deepEqual(f.saved,[high]);
  assert.equal((await fxs.readFxState(f.directory)).positions[a.id].sinceId,high);
 }
 const cycle=await fixture([author(250)]);cycle.options.fetcher=async()=>page(author(250),[high],'SAME');assert.equal((await run(cycle)).pending,1);cycle.time+=DAY;
 assert.equal((await run(cycle)).failed,1);assert.equal((await fxs.readFxState(cycle.directory)).positions['1250'].sinceId,author(250).latestId);
 // DB baseline failure, provider failure and successful publication continue within the same batch.
 const no=author(260);no.latestId=null;const mixed=await fixture([no,author(261),author(262)]);
 mixed.options.database={from(){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},then(ok){return Promise.resolve({error:{message:'MOCK_DB_FAILURE'}}).then(ok)}};return q}};
 let n=0;mixed.options.fetcher=async()=>{if(n++===0)return new Response('',{status:429});return page(author(262),[high]);};
 r=await run(mixed);assert.equal(r.processed,3);assert.equal(r.failed,2);assert.equal(r.saved,1);assert.equal((await xs.readXState(mixed.directory)).reservations.length,3);
 // Pause, incomplete import, unavailable/manual removal and 24h eligibility guards remain in force.
 const guards=await fixture([author(270),author(271),author(272),author(273),author(274)]);
 let s=await store.readScheduledFreeState(guards.directory);s.authors[0].paused=true;s.authors[1].initialPending=true;s.authors[2].nextCheckAt=START+DAY;s.cooldownUntil=START+10*DAY;await store.writeScheduledFreeState(s,guards.directory);
 guards.options.blocked=async()=>new Set(['id:1273']);assert.equal((await run(guards)).processed,1);
 // Same operation.lock prevents a simultaneous scheduled run or sync from issuing a second request.
 const locked=await fixture([author(280)]);locked.options.fetcher=async()=>{await assert.rejects(run(locked),e=>e.status===409);return page(author(280),[high]);};assert.equal((await run(locked)).saved,1);
 for(const name of ['x-api-v1.json','fx-patrol-v1.json']){const f=await fixture([author(290)]);await fsp.writeFile(path.join(f.directory,name),'corrupt');await assert.rejects(run(f),/STATE_INVALID/);assert.equal(f.calls.length,0);}
 const durable=await fixture([author(300)]),original=xs.writeXState;xs.writeXState=async()=>{throw Error('MOCK_DURABILITY_FAILURE')};
 await assert.rejects(run(durable),/DURABILITY_FAILURE/);assert.equal(durable.calls.length,0);xs.writeXState=original;
 // Upgrade an in-progress position from yesterday's release (no newestId) without losing the already seen maximum.
 const ua=author(310),upgrade=await fixture([ua]);let prior=fxs.freshFxState();
 prior.positions[ua.id]={sinceId:ua.latestId,cursor:'xclip-statuses-v1:OLD_PENDING',upperId:high,seenCursorHashes:[fxs.fxCursorHash('xclip-statuses-v1:OLD_PENDING')],checkedAt:START-DAY};
 await fxs.writeFxState(prior,upgrade.directory);upgrade.options.fetcher=async url=>{assert.equal(new URL(url).searchParams.get('cursor'),'OLD_PENDING');return page(ua,[middle,old]);};
 assert.equal((await run(upgrade)).saved,1);assert.equal((await fxs.readFxState(upgrade.directory)).positions[ua.id].sinceId,high);
 // Random five uses the same operation lock, quota and publication path; no partial sample or premature retry.
 const verify=await fixture(Array.from({length:12},(_,i)=>author(320+i)));verify.options.verification='random-five';
 verify.options.fetcher=async url=>{const u=new URL(url);verify.calls.push(u);assert.equal(u.searchParams.get('with_replies'),'1');
  const id=decodeURIComponent(u.pathname).match(/id:(\d+)/)[1];return page(author(Number(id)-1000),[high]);};
 r=await run(verify);assert.equal(r.processed,5);assert.equal(r.saved,5);assert.equal(r.verification.result,'PASSED');
 assert.equal(new Set(r.verification.authors.map(a=>a.username)).size,5);assert(r.verification.authors.every(a=>a.success));
 assert.equal((await xs.readXState(verify.directory)).reservations.length,5);
 const reservedIds=(await xs.readXState(verify.directory)).reservations.map(v=>v.id);
 verify.time+=3*3600000;r=await run(verify);assert.equal(r.processed,5);assert.equal(r.verification.result,'PASSED');
 assert((await xs.readXState(verify.directory)).reservations.slice(5).every(v=>!reservedIds.includes(v.id)));
 const limited=await fixture(Array.from({length:8},(_,i)=>author(340+i)));limited.options.verification='random-five';
 x=xs.freshXState();x.reservations=Array.from({length:20},(_,i)=>({id:String(9000+i),at:START}));await xs.writeXState(x,limited.directory);
 r=await run(limited);assert.equal(r.verification.result,'WAITING');assert.equal(r.processed,0);assert.equal(limited.calls.length,0);assert.equal((await xs.readXState(limited.directory)).reservations.length,20);
 const partial=await fixture([author(360),author(361)]);partial.options.verification='random-five';r=await run(partial);assert.equal(r.verification.result,'WAITING');assert.equal(partial.calls.length,0);
 const failedFive=await fixture(Array.from({length:5},(_,i)=>author(370+i)));failedFive.options.verification='random-five';
 r=await run(failedFive);assert.equal(r.processed,5);assert.equal(r.failed,5);assert.equal(r.verification.result,'FAILED');assert.equal((await xs.readXState(failedFive.directory)).reservations.length,5);
 const noneNew=await fixture(Array.from({length:5},(_,i)=>author(380+i)));noneNew.options.verification='random-five';
 noneNew.options.fetcher=async url=>{const id=decodeURIComponent(new URL(url).pathname).match(/id:(\d+)/)[1];return page(author(Number(id)-1000),[old]);};
 r=await run(noneNew);assert.equal(r.saved,0);assert.equal(r.failed,0);assert.equal(r.verification.result,'PASSED');
 const wait=await fixture(Array.from({length:5},(_,i)=>author(400+i)));wait.options.verification='random-five';
 let waitState=await store.readScheduledFreeState(wait.directory);waitState.nextBatchAt=START+3600000;await store.writeScheduledFreeState(waitState,wait.directory);
 r=await run(wait);assert.equal(r.skip_reason,'interval');assert.equal(r.verification.result,'WAITING');assert.equal(wait.calls.length,0);
 const unfinished=author(410);unfinished.latestId=null;unfinished.baselineId=old;const notReady=await fixture([unfinished,...Array.from({length:4},(_,i)=>author(411+i))]);notReady.options.verification='random-five';
 r=await run(notReady);assert.equal(r.verification.result,'WAITING');assert.equal(notReady.calls.length,0);
 const invalidNewest=await fixture([author(390)]);prior=fxs.freshFxState();prior.positions['1390']={sinceId:high,cursor:null,upperId:null,seenCursorHashes:[],checkedAt:0,newestId:high};
 await fxs.writeFxState(prior,invalidNewest.directory);await assert.rejects(run(invalidNewest),/STATE_INVALID/);assert.equal(invalidNewest.calls.length,0);
 console.log('PASS FX PATROL: fixed Fx only/no credentials/no X; shared24 incl failures/batch8/24h/fairness; lower-bound and old pending upgrade; mixed repost/identical duplicate; unknown/conflicting refusal with counts; snapshot/repost-only pagination/DB retry; random five exact sample/same lock/quota/no-new success/wait/failure; pause/removal/import guards; corrupt/durability refusal. All HTTP and DB mocked.');
 }finally{for(const d of dirs){if(!d.startsWith(os.tmpdir()+path.sep)||!path.basename(d).startsWith('xclip-fx-patrol-'))throw Error('UNSAFE_FIXTURE_PATH');await fsp.rm(d,{recursive:true,force:true});}}
})().catch(e=>{console.error(e);process.exitCode=1});
