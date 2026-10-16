const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const modules=new Map();
function load(id){if(modules.has(id))return modules.get(id).exports;const m={exports:{}};modules.set(id,m);const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const server=load('lib/video-download'),browser=load('lib/browser-direct-download');
const post={video_url:'https://video.twimg.com/video.mp4',is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS',adult_tier:'A',manual_tier:null};
const request=(query='',opts={})=>new Request('http://localhost:3004/api/video-download?postId=123'+query,opts);
(async()=>{
 let bytesCalls=0,dbReads=0;
 const savedFetch=global.fetch;global.fetch=async()=>{bytesCalls++;throw Error('No server CDN request allowed');};
 const deps={findPost:async()=>{dbReads++;return post;},fetcher:global.fetch};
 try{
  let r=await server.downloadVideo(request('&check=1'),deps);assert.equal(r.status,200);assert.deepEqual(await r.json(),{ready:true,mode:'browser-direct'});
  r=await server.downloadVideo(request('&consent=1'),deps);const data=await r.json();assert.equal(data.url,post.video_url);assert.equal(data.filename,'xclip-123.mp4');assert.equal(r.headers.get('content-disposition'),null);assert.equal(r.headers.get('cache-control'),'no-store');
  r=await server.downloadVideo(request(),deps);assert.equal(r.status,400);
  r=await server.downloadVideo(request('&consent=1',{headers:{origin:'https://evil.test'}}),deps);assert.equal(r.status,403);
  for(const changed of [{is_visible:false},{moderation_blocked:true},{review_required:true},{manual_tier:'NONE'},{video_url:'https://evil.test/v.mp4'}]){
   r=await server.downloadVideo(request('&consent=1'),{...deps,findPost:async()=>({...post,...changed})});assert.equal(r.status,404);
  }
  r=await server.downloadVideo(request('&consent=1'),{...deps,findPost:async()=>{throw Error('DB down');}});assert.equal(r.status,502);
  assert.equal(bytesCalls,0);assert.equal(dbReads,2);
 }finally{global.fetch=savedFetch;}
 let fetches=[];
 const controller=new AbortController();
 const fetcher=async(url,options)=>{fetches.push({url,options});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4','content-length':'3'}});};
 const progress=[];
 const blob=await browser.fetchDirectVideo(post.video_url,{signal:controller.signal,fetcher,onProgress:(n,t)=>progress.push([n,t])});
 assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())],[1,2,3]);assert.equal(blob.type,'video/mp4');assert.deepEqual(progress,[[3,3]]);assert.equal(fetches.length,1);
 assert.equal(fetches[0].url,post.video_url);assert.equal(fetches[0].options.mode,'cors');assert.equal(fetches[0].options.credentials,'omit');assert.equal(fetches[0].options.redirect,'error');assert.equal(fetches[0].options.referrerPolicy,'no-referrer');
 await assert.rejects(browser.fetchDirectVideo('https://evil.test/v.mp4',{signal:controller.signal,fetcher}));assert.equal(fetches.length,1);
 let failedCalls=0;
 await assert.rejects(browser.fetchDirectVideo(post.video_url,{signal:controller.signal,fetcher:async()=>{failedCalls++;throw new TypeError('CORS blocked');}}),/直接取得/);assert.equal(failedCalls,1);
 for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('x',{status:403}),new Response(new Uint8Array([1]),{status:206,headers:{'content-type':'video/mp4'}}),new Response(new Uint8Array([1]),{headers:{'content-type':'video/mp4','content-length':String(browser.DIRECT_DOWNLOAD_LIMIT+1)}}),new Response(new Uint8Array([1]),{headers:{'content-type':'video/mp4','content-length':'3'}})]){
  await assert.rejects(browser.fetchDirectVideo(post.video_url,{signal:controller.signal,fetcher:async()=>response}));
 }
 let cancelled=false;let sent=false;
 await assert.rejects(browser.fetchDirectVideo(post.video_url,{signal:controller.signal,fetcher:async()=>new Response(new ReadableStream({pull(c){if(!sent){sent=true;c.enqueue(new Uint8Array(browser.DIRECT_DOWNLOAD_LIMIT+1));}},cancel(){cancelled=true;}}),{headers:{'content-type':'video/mp4'}})}),/128MB/);assert.equal(cancelled,true);
 const aborted=new AbortController();aborted.abort();
 await assert.rejects(browser.fetchDirectVideo(post.video_url,{signal:aborted.signal,fetcher}),e=>e.name==='AbortError');assert.equal(fetches.length,1);
 const mid=new AbortController();let stopped=false;
 await assert.rejects(browser.fetchDirectVideo(post.video_url,{signal:mid.signal,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1]));},cancel(){stopped=true;}}),{headers:{'content-type':'video/mp4'}}),onProgress(){mid.abort();}}),e=>e.name==='AbortError');assert.equal(stopped,true);
 console.log('PASS DIRECT: server metadata only / zero CDN fetches; exclusion + consent; browser CDN-only CORS requests; cancellation; size limits; invalid/truncated responses; no relay or paid fallback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
