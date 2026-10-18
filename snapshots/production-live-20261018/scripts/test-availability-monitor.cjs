const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),ts=require('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {scanAvailabilityStatuses}=require('../lib/availability-scan.ts'),{classifyPostResponse,isUnavailablePost}=require('../lib/post-status.ts');
const {readPostState,unavailableKeys}=require('../lib/post-status-store.ts'),{writeAuthorState}=require('../lib/author-status-store.ts'),{DAY,HOUR}=require('../lib/availability-policy.ts');
const post=id=>({x_post_id:id,author_id:'123',author_username:'test'});
const publicPost=id=>({code:200,status:{type:'status',provider:'twitter',id,text:'public',media:{videos:[{type:'video',url:'https://video.twimg.com/test.mp4'}]},author:{id:'123',screen_name:'test',protected:false}}});
const profile={code:200,message:'OK',user:{type:'profile',id:'123',screen_name:'test',protected:false}};
const missing=()=>Response.json({code:404,message:'NOT_FOUND'},{status:404});
(async()=>{
 const p=post('9999');assert.equal(classifyPostResponse(p,404,{code:404,message:'NOT_FOUND'}),'missing');assert.equal(classifyPostResponse(p,200,publicPost('9999')),'public');
 for(const [http,b] of [[503,{code:404,message:'NOT_FOUND'}],[404,{code:404}],[200,publicPost('9998')],[404,{code:404,message:'NOT_FOUND',id:'9998'}],[200,{...publicPost('9999'),status:{...publicPost('9999').status,author:{id:'456',protected:false}}}],[200,{...publicPost('9999'),status:{...publicPost('9999').status,author:{id:'123',protected:true}}}]])assert.equal(classifyPostResponse(p,http,b),b.status?.author?.protected===true?'hidden':'unknown');
 const quoted=publicPost('9999');quoted.status.quote={type:'tombstone',reason:'deleted',id:'8888'};assert.equal(classifyPostResponse(p,200,quoted),'public');
 assert.equal(classifyPostResponse(p,404,{code:404,status:{type:'tombstone',provider:'twitter',reason:'deleted',id:'9999'}}),'missing');
 assert(isUnavailablePost(p,new Set(['post:9999'])));assert(!isUnavailablePost(post('8888'),new Set(['post:9999'])));
 const previousCuratedDirectory=process.env.XCLIP_FREE_CURATED_STATE_DIR;
 const dirs=[];async function dir(){const d=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-availability-'));dirs.push(d);return d;}
 try{
  // This registry is independent of the author/post directory passed to the scanner.
  // Never inherit live manual removals during an isolated monitor test.
  process.env.XCLIP_FREE_CURATED_STATE_DIR=await dir();
  let time=100*DAY,requests=[],dbReads=0,active=0,maxActive=0;
  let rows=Array.from({length:50},(_,i)=>post(String(9999-i))),missingIds=new Set(['9999']);const directory=await dir();
  const fetcher=async(url,init)=>{
   active++;maxActive=Math.max(maxActive,active);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert(!JSON.stringify(init).includes('Bearer'));
   const u=new URL(url);assert.equal(u.origin,'https://api.fxtwitter.com');assert(!u.pathname.includes('video'));const id=u.pathname.split('/').at(-1);requests.push([u.pathname,time]);
   await new Promise(r=>setImmediate(r));active--;
   return u.pathname.startsWith('/2/profile/')?Response.json(profile):missingIds.has(id)?missing():Response.json(publicPost(id));
  };
  const loadPage=async cursor=>{dbReads++;return rows.filter(p=>!cursor||BigInt(p.x_post_id)<BigInt(cursor)).slice(0,200);};const opts={directory,now:()=>time,pause:async()=>{},fetcher};
  let stats=await scanAvailabilityStatuses(loadPage,opts);assert.equal(stats.author_checked,1);assert.equal(stats.post_checked,20);assert.equal(stats.post_hidden,0);
  let state=await readPostState(directory);assert.equal(state.cursor,'9980');assert.equal(state.entries['9999'].blocked,false);if(process.platform!=='win32')assert.equal((await fsp.stat(path.join(directory,'post-state-v1.json'))).mode&0o777,0o600);
  const before=[requests.length,dbReads];stats=await scanAvailabilityStatuses(loadPage,opts);assert(stats.skipped);assert.deepEqual([requests.length,dbReads],before);
  rows.unshift(post('10000'));time+=3*HOUR;stats=await scanAvailabilityStatuses(loadPage,opts);assert.equal(stats.author_checked,0);assert.equal(stats.post_checked,20);
  time+=3*HOUR;stats=await scanAvailabilityStatuses(loadPage,opts);assert.equal(stats.post_checked,10);assert(stats.cycle_complete);
  time+=3*HOUR;stats=await scanAvailabilityStatuses(loadPage,opts);assert.equal(stats.post_checked,0,'short cycles wait >=24h');
  time=101*DAY;stats=await scanAvailabilityStatuses(loadPage,opts);assert.equal(stats.post_hidden,1,'two separated missing observations + healthy status permit exclusion');
  assert((await unavailableKeys(directory)).has('post:9999'));assert.equal(maxActive,1);
  const groups=new Map();for(const [key,t]of requests){const last=groups.get(key);if(last!=null)assert(t-last>=DAY,key+' called too soon');groups.set(key,t);}
  time+=3*HOUR;await scanAvailabilityStatuses(loadPage,{...opts,fetcher:async()=>Response.json({code:500},{status:500})});assert((await unavailableKeys(directory)).has('post:9999'));
  time+=7*DAY;missingIds.clear();stats=await scanAvailabilityStatuses(loadPage,opts);assert.equal(stats.post_restored,1);assert(!(await unavailableKeys(directory)).has('post:9999'));
  const bounded=await dir(),many=Array.from({length:200},(_,i)=>({x_post_id:String(50000-i),author_id:String(1000+i),author_username:'user'+i}));let providerCalls=0,pauseCalls=0;
  stats=await scanAvailabilityStatuses(async()=>many,{...opts,directory:bounded,pause:async()=>{pauseCalls++;},fetcher:async url=>{
   providerCalls++;const tail=decodeURIComponent(url.split('/').at(-1));
   if(url.includes('/profile/'))return Response.json({...profile,user:{...profile.user,id:tail.slice(3)}});
   const row=many.find(p=>p.x_post_id===tail),body=publicPost(tail);body.status.author.id=row.author_id;return Response.json(body);
  }});assert.equal(stats.author_checked,12);assert.equal(stats.post_checked,20);assert.equal(providerCalls,32);assert.equal(pauseCalls,32);
  const migrated=await dir();await writeAuthorState({version:1,entries:{'id:123':{status:'suspended',checkedAt:time,confirmedAt:time,nextCheckAt:time+60000}},cooldownUntil:0},migrated);
  time+=3*HOUR;stats=await scanAvailabilityStatuses(async()=>[post('7777')],{...opts,directory:migrated});assert.equal(stats.author_checked,0);assert.equal(stats.post_checked,0);assert((await unavailableKeys(migrated)).has('id:123'));
  const outage=await dir(),two=[post('6001'),post('6000')];const all404=async url=>url.includes('/profile/')?Response.json(profile):missing();await scanAvailabilityStatuses(async()=>two,{...opts,directory:outage,fetcher:all404});
  time+=DAY;stats=await scanAvailabilityStatuses(async()=>two,{...opts,directory:outage,fetcher:all404});assert.equal(stats.post_hidden,0);assert.equal((await unavailableKeys(outage)).size,0);
  const limited=await dir();let count=0;stats=await scanAvailabilityStatuses(async()=>two,{...opts,directory:limited,fetcher:async()=>{count++;return Response.json({code:429},{status:429,headers:{'retry-after':'86400'}});}});assert(stats.stopped);assert.equal(count,1);assert.equal(stats.post_checked,0);
  time+=12*HOUR;stats=await scanAvailabilityStatuses(async()=>{throw Error('must not read DB');},{...opts,directory:limited});assert(stats.skipped);
  await fsp.writeFile(path.join(outage,'post-state-v1.json'),'corrupt');await assert.rejects(()=>unavailableKeys(outage),/POST_STATE_UNREADABLE/);await assert.rejects(()=>scanAvailabilityStatuses(async()=>two,{...opts,directory:outage}),/POST_STATE_UNREADABLE/);
  console.log('PASS LOW-VOLUME AVAILABILITY: sequential; durable batch gate before DB; 24h minimum; fair keyset rotation/new arrivals; two missing confirmations; healthy-control guard; quote/identity/privacy/5xx; 429 Retry-After; migration keeps blocks; restoration; corrupt state refused. DB/network mocked.');
 }finally{if(previousCuratedDirectory===undefined)delete process.env.XCLIP_FREE_CURATED_STATE_DIR;else process.env.XCLIP_FREE_CURATED_STATE_DIR=previousCuratedDirectory;for(const d of dirs)await fsp.rm(d,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
