const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const cache=new Map();
function load(id){if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const free=load('lib/download-free'),refresh=load('lib/playback-refresh'),browser=load('lib/browser-direct-playback');
const id='123',url='https://video.twimg.com/amplify_video/777/vid/large.mp4';
const fixture=()=>({code:200,status:{type:'status',id,provider:'twitter',text:'Test permitted video',author:{protected:false},media:{videos:[{type:'video',format:'video/mp4',url,duration:434.936}]}}});
const post={video_url:url,is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS',adult_tier:'A',manual_tier:null};
(async()=>{
 assert.equal(free.selectFreePlaybackMedia(fixture(),id)[0].durationSeconds,434.936);
 assert.deepEqual(free.selectFreeDownloadMedia(fixture(),id),[{mediaKey:'free-0',url}]);
 for(const value of [undefined,null,'125',0,-1,Infinity,NaN,86401]){const b=fixture();b.status.media.videos[0].duration=value;assert.equal(free.selectFreePlaybackMedia(b,id)[0].durationSeconds,undefined);}
 const multi=fixture();multi.status.media.videos.unshift({type:'video',format:'video/mp4',url:'https://video.twimg.com/amplify_video/888/vid/x.mp4',duration:12});
 const sources=await refresh.refreshPlaybackSources(id,{findPost:async()=>post,lookup:async()=>free.selectFreePlaybackMedia(multi,id)});assert.equal(sources.durationSeconds,434.936);
 let lookedUp=0;await assert.rejects(refresh.refreshPlaybackSources(id,{findPost:async()=>({...post,is_visible:false}),lookup:async()=>{lookedUp++;return [];}}));assert.equal(lookedUp,0);
 let urls=[];const response=async(u,opts)=>{urls.push(u);assert.equal(opts.credentials,'same-origin');return Response.json({url,mode:'browser-direct',durationSeconds:434.936});};
 assert.equal(await browser.readPostVideoDuration(id,new AbortController().signal,response),434.936);assert.deepEqual(urls,['/api/video-playback-url?postId=123']);
 let invalidCalls=0;assert.equal(await browser.readPostVideoDuration('bad',new AbortController().signal,()=>{invalidCalls++;}),null);assert.equal(invalidCalls,0);
 for(const body of [{url,mode:'browser-direct',durationSeconds:'434'}, {url,mode:'wrong',durationSeconds:434}, {url:'https://evil.test/x.mp4',mode:'browser-direct',durationSeconds:434}])assert.equal(await browser.readPostVideoDuration(id,new AbortController().signal,async()=>Response.json(body)),null);
 let finished;const controller=new AbortController();const pending=browser.readPostVideoDuration(id,controller.signal,()=>new Promise(r=>finished=r));controller.abort();finished(Response.json({url,mode:'browser-direct',durationSeconds:434}));assert.equal(await pending,null);
 assert.equal(await browser.readPostVideoDuration(id,new AbortController().signal,async()=>new Response('excluded',{status:404})),null);
 console.log('PASS DURATION METADATA: validated duration, correct multi-media match, exclusion, JSON only, no relay/paid fallback, invalid and aborted responses.');
})().catch(e=>{console.error(e);process.exitCode=1;});
