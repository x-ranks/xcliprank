const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url'),fs=require('node:fs'),ts=require('typescript');
(async()=>{
 const oldSelf=global.self,oldFetch=global.fetch;global.self=globalThis;
 try{
  const {default:Hls,FetchLoader}=await import(pathToFileURL(path.resolve('lib/vendor/hls.mjs')).href);
  assert.equal(Hls.version,'1.7.3');assert.ok(Hls.DefaultConfig.audioStreamController,'full build supports X separate audio');
  const m={exports:{}};const code=ts.transpileModule(fs.readFileSync('lib/browser-stream-playback.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',code)(()=>({directPlaybackUrl:url=>typeof url==='string'&&/^https:\/\/video\.twimg\.com\//.test(url)?url:undefined}),m,m.exports);
  const config={...Hls.DefaultConfig,fetchSetup:async(context,init)=>m.exports.directStreamRequest(context.url,init)};
  let network=0;
  global.fetch=async request=>{network++;assert.equal(request.credentials,'omit');assert.equal(request.referrerPolicy,'no-referrer');assert.equal(request.redirect,'error');return new Response('#EXTM3U\n#EXT-X-ENDLIST\n');};
  const policy={...Hls.DefaultConfig.manifestLoadPolicy.default,errorRetry:null,timeoutRetry:null};
  function request(url){let loader;return new Promise((resolve,reject)=>{loader=new FetchLoader(config);loader.load({url,type:'manifest',responseType:'text'}, {loadPolicy:policy,timeout:2000,maxRetry:0,retryDelay:0,maxRetryDelay:0}, {onSuccess:r=>{loader.destroy();resolve(r);},onError:e=>{loader.destroy();reject(Error(e.text));},onTimeout:()=>{loader.destroy();reject(Error('timeout'));}});});}
  const response=await request('https://video.twimg.com/pl/master.m3u8');assert.match(response.data,/#EXTM3U/);assert.equal(network,1);
  await assert.rejects(request('https://evil.test/segment.ts'));assert.equal(network,1,'actual vendored FetchLoader rejects non-CDN requests before network');
  console.log('PASS VENDORED HLS: full build includes alternate audio; real FetchLoader invokes guarded no-referrer/credential-free fetch; outside-CDN request never sent. HTTP mocked; no browser playback claim.');
 }finally{global.self=oldSelf;global.fetch=oldFetch;}
})().catch(error=>{console.error(error);process.exitCode=1;});
