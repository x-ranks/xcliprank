const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const cache=new Map();
function load(id){if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
const free=load('lib/download-free'),refresh=load('lib/playback-refresh'),stream=load('lib/browser-stream-playback');
const id='123',mp4='https://video.twimg.com/amplify_video/777/vid/large.mp4',hls='https://video.twimg.com/amplify_video/777/pl/master.m3u8';
const fixture=()=>({code:200,status:{type:'status',id,provider:'twitter',text:'許可されたテスト動画',author:{protected:false},media:{videos:[{type:'video',format:'video/mp4',url:mp4,formats:[{container:'mp4',url:mp4,bitrate:100},{container:'m3u8',url:hls}]}]}}});
const post={video_url:mp4,is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS',adult_tier:'A',manual_tier:null};
(async()=>{
 assert.deepEqual(free.selectFreeDownloadMedia(fixture(),id),[{mediaKey:'free-0',url:mp4}],'saving response unchanged');
 assert.deepEqual(free.selectFreePlaybackMedia(fixture(),id),[{mediaKey:'free-0',url:mp4,hlsUrl:hls}]);
 for(const raw of ['https://evil.test/x.m3u8','http://video.twimg.com/x.m3u8','https://video.twimg.com.evil.test/x.m3u8',mp4])assert.equal(stream.streamingPlaylistUrl(raw),undefined);
 for(const raw of ['https://evil.test/x.ts','/api/video','https://user:pass@video.twimg.com/x.ts'])assert.throws(()=>stream.directStreamRequest(raw,{}));
 const req=stream.directStreamRequest(hls,{credentials:'include',redirect:'follow',referrerPolicy:'unsafe-url',headers:{Range:'bytes=0-9'}});
 assert.equal(req.credentials,'omit');assert.equal(req.redirect,'error');assert.equal(req.referrerPolicy,'no-referrer');assert.equal(req.headers.get('Range'),'bytes=0-9');
 const bad=fixture();bad.status.media.videos[0].formats[1].url='https://evil.test/a.m3u8';assert.equal(free.selectFreePlaybackMedia(bad,id)[0].hlsUrl,undefined);
 const privatePost=fixture();privatePost.status.author.protected=true;assert.throws(()=>free.selectFreePlaybackMedia(privatePost,id));
 const quoted=fixture();quoted.status.quote={media:{videos:quoted.status.media.videos}};quoted.status.media.videos=[];assert.equal(free.selectFreePlaybackMedia(quoted,id).length,0);
 let externalCalls=0;
 const selected=await refresh.refreshPlaybackSources(id,{findPost:async()=>post,lookup:async()=>{externalCalls++;return [{mediaKey:'a',url:mp4,hlsUrl:hls}];}});assert.deepEqual(selected,{url:mp4,hlsUrl:hls});
 await assert.rejects(refresh.refreshPlaybackSources(id,{findPost:async()=>({...post,is_visible:false}),lookup:async()=>{externalCalls++;return [];}}));assert.equal(externalCalls,1,'exclude before any external metadata request');
 await assert.rejects(refresh.refreshPlaybackSources(id,{findPost:async()=>post,lookup:async()=>[{mediaKey:'wrong',url:'https://video.twimg.com/amplify_video/888/vid/x.mp4',hlsUrl:hls},{mediaKey:'other',url:'https://video.twimg.com/amplify_video/999/vid/x.mp4'}]}));
 let calls=[];
 const media=await free.fetchFreePlaybackMedia(id,async(url,opts)=>{calls.push(url);assert.equal(opts.headers.Authorization,undefined);return Response.json(fixture());});assert.equal(media[0].hlsUrl,hls);assert.ok(calls.every(u=>new URL(u).hostname==='api.fxtwitter.com'));
 let destroyed=0,attached=0,loaded=0,ready=0,errors=0,instance;
 class Engine{
  static Events={ERROR:'error',MEDIA_ATTACHED:'attached'};static isSupported(){return true;}
  constructor(config){this.config=config;this.events={};instance=this;}
  on(event,fn){this.events[event]=fn;}
  attachMedia(video){attached++;this.events.attached();}
  loadSource(url){loaded++;assert.equal(url,hls);}
  destroy(){destroyed++;}
 }
 const listeners={};const video={error:null,addEventListener:(e,f)=>listeners[e]=f,removeEventListener:(e,f)=>{if(listeners[e]===f)delete listeners[e];},pause(){},removeAttribute(){},load(){},canPlayType(){return ''}};
 const ctrl=new AbortController();const cleanup=await stream.attachDirectStream(video,hls,{signal:ctrl.signal,onReady:()=>ready++,onError:()=>errors++},async()=>({default:Engine,FetchLoader:class{}}));
 assert.equal(attached,1);assert.equal(loaded,1);assert.equal(instance.config.maxBufferLength,30);assert.equal(instance.config.backBufferLength,10);assert.equal(instance.config.maxBufferSize,32*1024*1024);
 assert.equal((await instance.config.fetchSetup({url:mp4},{})).referrerPolicy,'no-referrer');await assert.rejects(instance.config.fetchSetup({url:'https://evil.test/key'},{}));
 // A >128MiB movie is a playlist of segments, not one full-file Blob request.
 listeners.loadeddata();assert.equal(ready,1);assert.equal(errors,0);
 ctrl.abort();assert.equal(destroyed,1);cleanup();assert.equal(destroyed,1);assert.deepEqual(listeners,{});
 const fatalCtrl=new AbortController();await stream.attachDirectStream(video,hls,{signal:fatalCtrl.signal,onReady:()=>{},onError:()=>errors++},async()=>({default:Engine,FetchLoader:class{}}));instance.events.error('error',{fatal:true,details:'manifestLoadError'});assert.equal(errors,1);assert.equal(destroyed,2);fatalCtrl.abort();
 const aborted=new AbortController();aborted.abort();await assert.rejects(stream.attachDirectStream(video,hls,{signal:aborted.signal,onReady(){},onError(){}},async()=>{throw Error('must not load');}),e=>e.name==='AbortError');
 let finishImport;const delayed=new AbortController();const pending=stream.attachDirectStream(video,hls,{signal:delayed.signal,onReady(){},onError(){}},()=>new Promise(resolve=>finishImport=resolve));delayed.abort();finishImport({default:Engine,FetchLoader:class{}});await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(attached,2);
 console.log('PASS STREAM: free native-media playlist; MP4 save response retained; CDN-only fetch with no credentials/referrer/redirects; exclusions before lookup; bounded buffer configuration; ready/fatal/abort/late-import cleanup. Large-file streaming is simulated, not an actual browser test.');
})().catch(e=>{console.error(e);process.exitCode=1;});
