const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript');
const cache=new Map();
function load(id){if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const pure=load('lib/download-url'),store=load('lib/download-url-store');
const post={video_url:'https://video.twimg.com/one.mp4',is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS',adult_tier:'A',manual_tier:null};
const body=(id='123',text='許可されたテスト動画')=>({data:{id,text,attachments:{media_keys:['a','b']}},includes:{media:[{media_key:'a',type:'video',variants:[{content_type:'video/mp4',bit_rate:100,url:'https://video.twimg.com/low.mp4'},{content_type:'video/mp4',bit_rate:200,url:'https://video.twimg.com/high.mp4'},{content_type:'application/x-mpegURL',url:'https://video.twimg.com/playlist.m3u8'}]},{media_key:'b',type:'video',variants:[{content_type:'video/mp4',url:'https://video.twimg.com/second.mp4'}]}]}});
(async()=>{
for(const url of ['https://x.com/test/status/123?s=20','https://twitter.com/test/status/123/video/1','https://x.com/i/web/status/123','https://x.com/i/status/123'])assert.equal(pure.parsePostUrl(url),'123');
for(const url of ['https://x.com/test','https://x.com.evil.test/test/status/123','https://user@x.com/test/status/123','https://x.com:444/test/status/123','http://x.com/test/status/123','https://t.co/abc','https://x.com/test/status/123/../../abc',{},'x'.repeat(3000)])assert.equal(pure.parsePostUrl(url),null);
let calls=0;const deps={findPost:async()=>post,lookup:async()=>{calls++;return pure.selectDownloadMedia(body(),'123');},secret:async()=>'test-secret'};
let result=await pure.resolvePostUrl('https://x.com/a/status/123',deps);assert.equal(result.source,'stored');assert.equal(calls,0);
await assert.rejects(pure.resolvePostUrl('https://x.com/a/status/123',{...deps,findPost:async()=>({...post,moderation_blocked:true})}),e=>e.status===403);assert.equal(calls,0);
result=await pure.resolvePostUrl('https://x.com/a/status/123',{...deps,findPost:async()=>null});assert.equal(result.videos.length,2);assert.equal(calls,1);
assert.equal(pure.verifyDownloadTicket(result.videos[0].token,'123','test-secret').url,'https://video.twimg.com/high.mp4');
assert.equal(pure.verifyDownloadTicket(result.videos[0].token+'x','123','test-secret'),null);assert.equal(pure.verifyDownloadTicket(result.videos[0].token,'124','test-secret'),null);
assert.equal(pure.verifyDownloadTicket(pure.signDownloadTicket('123',post.video_url,'secret',1000),'123','secret',601001),null);
assert.equal(pure.postForTicket({...post,manual_tier:'X'},result.videos[0].token,'123','test-secret'),null);
assert.equal(pure.postForTicket(null,result.videos[0].token,'123','test-secret').video_url,'https://video.twimg.com/high.mp4');
const empty=body();empty.includes.media.forEach(m=>m.variants=[{content_type:'video/mp4',url:'https://evil.test/video.mp4'}]);assert.deepEqual(pure.selectDownloadMedia(empty,'123'),[]);
const withheld=body();withheld.data.withheld={country_codes:['JP']};assert.throws(()=>pure.selectDownloadMedia(withheld,'123'));
const m={exports:{}};const code=ts.transpileModule(fs.readFileSync('app/api/video-resolve/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;let dbReads=0;
new Function('require','module','exports',code)(n=>n.includes('supabase-admin')?{supabaseAdmin:()=>{dbReads++;return{from(){return{select(){return{eq(){return{maybeSingle:async()=>({data:post,error:null})};}};}};}};}}:n.endsWith('download-url-store')?{lookupPublicVideo:async()=>{throw Error('Must not call API');},downloadSecret:async()=>''}:pure,m,m.exports);
const req=(data,origin)=>new Request('https://xcliprank.com/api/video-resolve',{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:typeof data==='string'?data:JSON.stringify(data)});
let r=await m.exports.POST(req({url:'https://x.com/test/status/123',consent:true},'https://xcliprank.com'));assert.equal(r.status,200);assert.equal((await r.json()).source,'stored');
r=await m.exports.POST(req({url:'https://x.com/test/status/123',consent:true},'https://evil.test'));assert.equal(r.status,403);
r=await m.exports.POST(req({url:'https://x.com/test/status/123',consent:false}));assert.equal(r.status,400);
r=await m.exports.POST(req('bad JSON'));assert.equal(r.status,400);assert.equal(dbReads,1);
r=await m.exports.POST(new Request('http://xcliprank.com/api/video-resolve',{method:'POST',headers:{origin:'https://xcliprank.com'},body:JSON.stringify({url:'https://x.com/test/status/123',consent:true})}));assert.equal(r.status,200,'Passenger internal HTTP retains public HTTPS origin');
r=await m.exports.POST(req('x'.repeat(5000)));assert.equal(r.status,400);assert.equal(dbReads,2);
const route={exports:{}};let selected=null;const mediaFetch=global.fetch;let mediaRequests=0;
const downloadHelper=load('lib/video-download');
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/api/video-download/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>n.includes('supabase-admin')?{supabaseAdmin:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:selected,error:null})})})})})}:n.endsWith('download-url-store')?{downloadSecret:async()=>'test-secret'}:n.endsWith('video-download')?downloadHelper:pure,route,route.exports);
try{
 global.fetch=async(url)=>{mediaRequests++;assert.equal(url,'https://video.twimg.com/high.mp4');return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4'}});};
 const endpoint='https://xcliprank.com/api/video-download?postId=123&consent=1&token='+encodeURIComponent(result.videos[0].token);
 r=await route.exports.GET(new Request(endpoint));assert.equal(r.status,200);const direct=await r.json();assert.equal(direct.url,'https://video.twimg.com/high.mp4');assert.equal(direct.mode,'browser-direct');assert.equal(r.headers.get('content-disposition'),null);
 selected={...post,moderation_blocked:true};r=await route.exports.GET(new Request(endpoint));assert.equal(r.status,404);assert.equal(mediaRequests,0);
 selected=null;r=await route.exports.GET(new Request(endpoint+'tampered'));assert.equal(r.status,404);assert.equal(mediaRequests,0);
}finally{global.fetch=mediaFetch;}
console.log('PASS URL feature: strict URLs; DB-first/no-cost lookup; blocked post cannot bypass; highest MP4 + multiple media; signed tickets/expiry/tampering; cross-origin + consent; free provider tested separately. All X/DB calls mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
