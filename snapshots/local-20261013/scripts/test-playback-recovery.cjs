const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const cache=new Map();
function load(rel){
 const p=path.resolve(rel);if(cache.has(p))return cache.get(p).exports;
 const m={exports:{}};cache.set(p,m);
 const js=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','module','exports',js)(name=>name.startsWith('.')?load(path.resolve(path.dirname(p),name+'.ts')):require(name),m,m.exports);
 return m.exports;
}
const {recoverDirectPlayback}=load('lib/browser-playback-recovery.ts');
const {refreshPlaybackUrl}=load('lib/playback-refresh.ts');
const video='https://video.twimg.com/ext_tw_video/123456789012345/pu/vid/a.mp4';
const fresh='https://video.twimg.com/ext_tw_video/123456789012345/pu/vid/b.mp4';
const mp4=()=>new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4','content-length':'3'}});
(async()=>{
 let requests=[];const signal=new AbortController().signal;
 const first=await recoverDirectPlayback(video,'2104946128420503759',signal,async(url,options)=>{requests.push(url);assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.mode,'cors');assert.equal(options.credentials,'omit');return mp4();});
 assert.equal(first.size,3);assert.deepEqual(requests,[video]);
 requests=[];
 const second=await recoverDirectPlayback(video,'2104946128420503759',signal,async(url)=>{
  requests.push(url);if(url===video)throw Error('CDN failure');
  if(url.startsWith('/api/video-playback-url?'))return Response.json({url:fresh});
  assert.equal(url,fresh);return mp4();
 });assert.equal(second.size,3);assert.equal(requests.length,3);
 assert.ok(requests.every(u=>u.startsWith('https://video.twimg.com/')||u.startsWith('/api/video-playback-url?')));
 await assert.rejects(()=>recoverDirectPlayback(video,'21',signal,async(url)=>url.startsWith('https:')?Promise.reject(Error('failure')):Response.json({error:'FREE_TIMEOUT'},{status:502})),/FREE_TIMEOUT.*HTTP 502/);
 let calls=0;
 await assert.rejects(()=>recoverDirectPlayback(video,'21',signal,async()=>{calls++;return new Response(new Uint8Array([1]),{headers:{'content-type':'video/mp4','content-length':String(129*1024*1024)}});}),/128MB/);assert.equal(calls,1);
 const cancel=new AbortController();cancel.abort();calls=0;
 await assert.rejects(()=>recoverDirectPlayback(video,'21',cancel.signal,async()=>{calls++;return mp4();}),/Aborted/);assert.equal(calls,0);
 let lookups=0;const eligible={video_url:video,is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS',adult_tier:'A',manual_tier:null};
 const deps={findPost:async()=>eligible,lookup:async()=>{lookups++;return [{url:'https://video.twimg.com/ext_tw_video/999/pu/vid/x.mp4'},{url:fresh}];}};
 assert.equal(await refreshPlaybackUrl('2104946128420503759',deps),fresh);assert.equal(lookups,1);
 await assert.rejects(()=>refreshPlaybackUrl('2104946128420503759',{...deps,findPost:async()=>({...eligible,moderation_blocked:true})}),/PLAYBACK_EXCLUDED/);assert.equal(lookups,1);
 await assert.rejects(()=>refreshPlaybackUrl('bad',deps),/PLAYBACK_INVALID_ID/);assert.equal(lookups,1);
 await assert.rejects(()=>refreshPlaybackUrl('2104946128420503759',{...deps,lookup:async()=>[{url:'https://evil.test/x.mp4'}]}),/PLAYBACK_NO_MATCH/);
 console.log('PASS PLAYBACK RECOVERY: client-only no-referrer CORS video fetch; free JSON refresh; no relay/paid endpoint; 128MiB bound; cancellation; exclusions and matching media.');
})().catch(error=>{console.error(error);process.exitCode=1;});
