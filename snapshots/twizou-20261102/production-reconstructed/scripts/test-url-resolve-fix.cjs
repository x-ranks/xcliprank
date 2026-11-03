const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const cache=new Map();
function load(id){if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);const path=require('node:path');new Function('require','module','exports',ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const pure=load('lib/download-url'),free=load('lib/download-free');
let dbError=null,stored=null,networkCalls=0,secretFail=false;
const mockedFetch=async(url,options)=>{
 networkCalls++;assert.equal(new URL(url).hostname,'api.fxtwitter.com');assert.equal(options.headers.Authorization,undefined);
 return Response.json({code:200,status:{type:'status',provider:'twitter',id:'123',text:'許可されたテスト動画',author:{protected:false},media:{videos:[{type:'video',format:'video/mp4',url:'https://video.twimg.com/test.mp4'}]}}});
};
const route={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/api/video-resolve/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>n.includes('supabase-admin')?{supabaseAdmin:()=>({from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:stored,error:dbError})})})})})}:n.endsWith('download-url-store')?{lookupPublicVideo:id=>free.fetchFreeDownloadMedia(id,mockedFetch),downloadSecret:async()=>{if(secretFail)throw Error('do not expose raw filesystem error');return 'test-secret';}}:pure,route,route.exports);
const request=()=>new Request('http://localhost:3004/api/video-resolve',{method:'POST',headers:{origin:'http://localhost:3004','content-type':'application/json'},body:JSON.stringify({url:'https://x.com/test/status/123',consent:true})});
(async()=>{
 let r=await route.exports.POST(request());assert.equal(r.status,200);const b=await r.json();assert.equal(b.source,'lookup');
 const ticket=pure.verifyDownloadTicket(b.videos[0].token,'123','test-secret');assert.equal(ticket.url,'https://video.twimg.com/test.mp4');
 // Ticket is accepted by the actual direct handler without any video HTTP request.
 const handler=load('lib/video-download');r=await handler.downloadVideo(new Request('http://localhost:3004/api/video-download?postId=123&consent=1'),{findPost:async()=>pure.postForTicket(null,b.videos[0].token,'123','test-secret')});
 assert.equal(r.status,200);assert.equal((await r.json()).mode,'browser-direct');assert.equal(networkCalls,1);
 dbError={message:'private database connection detail'};r=await route.exports.POST(request());assert.equal(r.status,503);assert.match((await r.json()).error,/DB_LOOKUP_FAILED/);assert.equal(networkCalls,1);
 dbError=null;secretFail=true;r=await route.exports.POST(request());assert.equal(r.status,503);assert.match((await r.json()).error,/DOWNLOAD_STATE_FAILED/);
 secretFail=false;stored={video_url:'https://video.twimg.com/test.mp4',is_visible:false};const before=networkCalls;r=await route.exports.POST(request());assert.equal(r.status,403);assert.equal(networkCalls,before);
 console.log('PASS URL RESOLVE FIX: POST -> free metadata -> signed ticket -> direct JSON; DB/state diagnostic; exclusion closed; no video relay or paid calls.');
})().catch(e=>{console.error(e);process.exitCode=1;});
