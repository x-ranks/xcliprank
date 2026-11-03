const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
const cache=new Map();
function load(id){if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const free=load('lib/download-free'),store=load('lib/download-url-store'),pure=load('lib/download-url');
const video=(name='one')=>({type:'video',id:name,format:'video/mp4',url:`https://video.twimg.com/${name}.mp4`,formats:[{container:'mp4',bitrate:100,url:'https://video.twimg.com/low.mp4'},{container:'mp4',bitrate:200,url:'https://video.twimg.com/high.mp4'},{container:'m3u8',url:'https://video.twimg.com/a.m3u8'}]});
const body=(id='123',text='許可されたテスト動画')=>({code:200,status:{type:'status',id,provider:'twitter',text,author:{protected:false},media:{videos:[video()]}}});
const stored={video_url:'https://video.twimg.com/stored.mp4',is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS',adult_tier:'A',manual_tier:null};
(async()=>{
assert.equal(free.selectFreeDownloadMedia(body(),'123')[0].url,'https://video.twimg.com/high.mp4');
const multiple=body();multiple.status.media.videos.push({...video('second'),formats:[]});assert.equal(free.selectFreeDownloadMedia(multiple,'123').length,2);
for(const mutate of [b=>b.code=404,b=>b.status.id='124',b=>b.status.id=123,b=>b.status.type='tombstone',b=>b.status.author.protected=true,b=>delete b.status.author.protected,b=>delete b.status.text,b=>b.status.withheld={country_codes:['JP']}]){const b=body();mutate(b);assert.throws(()=>free.selectFreeDownloadMedia(b,'123'),e=>e.status===404);}
assert.throws(()=>free.selectFreeDownloadMedia(body('123','児童ポルノ'),'123'),e=>e.status===403);
const raw=body();raw.status.raw_text={text:'盗撮'};assert.throws(()=>free.selectFreeDownloadMedia(raw,'123'),e=>e.status===403);
const quote=body();delete quote.status.media;quote.status.quote=body().status;assert.deepEqual(free.selectFreeDownloadMedia(quote,'123'),[]);
const publisher=body();publisher.status.media.videos[0].publisher={name:'video source'};assert.equal(free.selectFreeDownloadMedia(publisher,'123')[0].url,'https://video.twimg.com/high.mp4','publisher metadata does not exclude X-hosted attached video');
const external=body();delete external.status.media.videos;external.status.media.external={type:'video',url:'https://external.test/video.mp4'};assert.deepEqual(free.selectFreeDownloadMedia(external,'123'),[]);
const unsafePublisher=body();unsafePublisher.status.media.videos=[{...video(),publisher:{name:'video source'},url:'https://external.test/video.mp4',formats:[{container:'mp4',url:'https://external.test/video.mp4'}]}];assert.deepEqual(free.selectFreeDownloadMedia(unsafePublisher,'123'),[],'publisher does not bypass CDN checks');
for(const url of ['https://evil.test/x.mp4','http://video.twimg.com/x.mp4','https://video.twimg.com.evil.test/x.mp4','https://video.twimg.com/x.m3u8']){const b=body();b.status.media.videos=[{...video(),url,formats:[{container:'mp4',url}]}];assert.deepEqual(free.selectFreeDownloadMedia(b,'123'),[]);}
let allCalls=0;
const fetcher=async(url,o)=>{allCalls++;assert.equal(new URL(url).hostname,'api.fxtwitter.com','no paid endpoint permitted');assert.equal(o.headers.Authorization,undefined);assert.equal(o.headers.Cookie,undefined);assert.equal(o.redirect,'error');return Response.json(body(new URL(url).pathname.split('/').at(-1)));};
process.env.X_BEARER_TOKEN='must-never-be-read-or-sent';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-free-'));let now=Date.parse('2026-10-10T14:59:00Z');const opts={directory,fetcher,now:()=>now};
try{
fs.writeFileSync(path.join(directory,'lookup.json'),JSON.stringify({day:'2026-10-10',used:20,cache:{123:{expires:now+600000,media:[{mediaKey:'paid',url:'https://video.twimg.com/old-paid.mp4'}]}}}));
const concurrent=await Promise.all(Array.from({length:4},()=>store.lookupPublicVideo('123',opts)));assert.equal(allCalls,1);assert.equal(concurrent[0][0].url,'https://video.twimg.com/high.mp4','old paid cache not used');
const deps={findPost:async()=>stored,lookup:id=>store.lookupPublicVideo(id,opts),secret:async()=>'test-secret'};
let r=await pure.resolvePostUrl('https://x.com/test/status/123',deps);assert.equal(r.source,'stored');assert.equal(allCalls,1);
for(const patch of [{moderation_blocked:true},{is_visible:false},{review_required:true},{manual_tier:'X'}])await assert.rejects(pure.resolvePostUrl('https://x.com/test/status/123',{...deps,findPost:async()=>({...stored,...patch})}),e=>e.status===403);
assert.equal(allCalls,1,'DB decisions prevent all external lookup');
r=await pure.resolvePostUrl('https://x.com/test/status/123',{...deps,findPost:async()=>null});assert.equal(pure.verifyDownloadTicket(r.videos[0].token,'123','test-secret').url,'https://video.twimg.com/high.mp4');
await assert.rejects(pure.resolvePostUrl('https://x.com/test/status/123',{...deps,findPost:async()=>{throw Error('DB unavailable');}}));assert.equal(allCalls,1,'DB failure cannot bypass exclusion checks');
let failCalls=0;const failure={...opts,fetcher:async(url,o)=>{failCalls++;return new Response('down',{status:503});}};
await assert.rejects(store.lookupPublicVideo('666',failure),e=>e.status===502);await assert.rejects(store.lookupPublicVideo('666',failure));assert.equal(failCalls,2,'two free metadata paths, then cached; no paid fallback');
await assert.rejects(store.lookupPublicVideo('667',{...opts,fetcher:async()=>Response.json(body('667','児童ポルノ'))}),e=>e.status===403);
const statePath=path.join(directory,'lookup-free-v2.json');let state=JSON.parse(fs.readFileSync(statePath));assert.ok(!JSON.stringify(state).includes('児童ポルノ'));assert.ok(!JSON.stringify(state).includes('must-never'));
state.used=200;fs.writeFileSync(statePath,JSON.stringify(state));const n=allCalls;await assert.rejects(store.lookupPublicVideo('777',opts),e=>e.status===429);await store.lookupPublicVideo('123',opts);assert.equal(allCalls,n);
now+=61000;await store.lookupPublicVideo('777',opts);assert.equal(allCalls,n+1,'JST rollover resets free budget');
fs.writeFileSync(statePath,'invalid');await assert.rejects(store.lookupPublicVideo('778',opts),e=>e.status===503);assert.equal(allCalls,n+1);
assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'lookup.json'))).used,20,'paid budget untouched');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
await assert.rejects(free.fetchFreeDownloadMedia('123',async()=>new Response('<html/>',{headers:{'content-type':'text/html'}})),e=>e.status===502);
await assert.rejects(free.fetchFreeDownloadMedia('123',async()=>new Response('bad',{headers:{'content-type':'application/json'}})),e=>e.status===502);
await assert.rejects(free.fetchFreeDownloadMedia('123',async()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})),e=>e.status===502);
await assert.rejects(free.fetchFreeDownloadMedia('123',async()=>new Response(null,{status:429})),e=>e.status===429);
await assert.rejects(free.fetchFreeDownloadMedia('123',async()=>{throw new DOMException('timeout','TimeoutError');}));

const slowDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-free-slow-'));let slowCalls=0;
try {
 const opts={directory:slowDirectory,fetcher:async()=>{slowCalls++;await new Promise(r=>setTimeout(r,3200));return Response.json(body('888'));}};
 const results=await Promise.all([store.lookupPublicVideo('888',opts),store.lookupPublicVideo('888',opts)]);
 assert.equal(results.length,2);assert.equal(slowCalls,1,'slow lookup is deduplicated without old 3-second lock timeout');
} finally {fs.rmSync(slowDirectory,{recursive:true,force:true});}
const legacy=(id='123')=>{const b=body(id);return {code:200,tweet:b.status};};
assert.equal(free.selectFreeDownloadMedia(legacy(),'123',true)[0].url,'https://video.twimg.com/high.mp4');
const allOnly=body();allOnly.status.media.all=allOnly.status.media.videos;delete allOnly.status.media.videos;
assert.equal(free.selectFreeDownloadMedia(allOnly,'123').length,1,'native media.all supported');
const paths=[];
const fallback=await free.fetchFreeDownloadMedia('123',async(url,options)=>{
 paths.push(new URL(url).pathname);assert.equal(new URL(url).hostname,'api.fxtwitter.com');
 assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
 return url.includes('/2/')?new Response('unavailable',{status:503}):Response.json(legacy());
});
assert.equal(fallback[0].url,'https://video.twimg.com/high.mp4');
assert.deepEqual(paths,['/2/status/123','/status/123']);
for(const b of [body('124'),body('123','盗撮'),{...body(),status:{...body().status,author:{protected:true}}},{...body(),status:{...body().status,author:{}}}]){
 let count=0;await assert.rejects(free.fetchFreeDownloadMedia('123',async()=>{count++;return Response.json(b);}));assert.equal(count,1,'no fallback for safety/privacy/identity decisions');
}
let timeoutCalls=0;await assert.rejects(free.fetchFreeDownloadMedia('123',async()=>{timeoutCalls++;throw new DOMException('timeout','TimeoutError');}),e=>e.message.includes('FREE_TIMEOUT'));assert.equal(timeoutCalls,2);

assert.ok(!fs.readFileSync('lib/download-url-store.ts','utf8').includes('api.x.com'));assert.ok(!fs.readFileSync('lib/download-url-store.ts','utf8').includes('X_BEARER_TOKEN'));
console.log('PASS FREE DOWNLOAD: DB-first, exclusions, DB failure closed, FxTwitter v2 schema, highest MP4, multiple media, native media only, fixed CDN, response size/format, no key/cookie/paid fallback, concurrent dedup, cache, separate budget, JST rollover, corrupt state. All network/DB mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
