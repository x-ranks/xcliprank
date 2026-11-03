const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
const m={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync('lib/browser-direct-playback.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,m,m.exports);
const {directPlaybackUrl,readDirectVideoDuration}=m.exports;
(async()=>{
 for(const url of ['https://video.twimg.com/path/video.mp4?tag=1','https://a.video.twimg.com/path.mp4'])assert.equal(directPlaybackUrl(url),url);
 for(const url of [null,undefined,'/api/video?url=x','http://video.twimg.com/x.mp4','https://video.twimg.com.evil.test/x.mp4','https://evil.test/x.mp4','https://name:pass@video.twimg.com/x.mp4','https://video.twimg.com:8443/x.mp4','javascript:alert(1)'])assert.equal(directPlaybackUrl(url),undefined);
 assert.equal(await readDirectVideoDuration('https://video.twimg.com/one.mp4'),null,'SSR has no network side effect');
 const oldDoc=global.document,oldFetch=global.fetch;let fetchCalls=0,created=0,cleaned=0,seen=[];
 global.fetch=()=>{fetchCalls++;throw Error('No fetch API is allowed');};
 let mode='success';
 global.document={createElement(tag){assert.equal(tag,'video');created++;let source;const video={duration:125.1,onloadedmetadata:null,onerror:null,pause(){},removeAttribute(name){assert.equal(name,'src');source=undefined;cleaned++;},load(){if(source)queueMicrotask(()=>{if(mode==='success')video.onloadedmetadata?.();else if(mode==='error')video.onerror?.();});},set src(value){source=value;seen.push(value);},get src(){return source;}};return video;}};
 try {
  assert.equal(await readDirectVideoDuration('https://video.twimg.com/one.mp4'),125.1);
  mode='error';assert.equal(await readDirectVideoDuration('https://video.twimg.com/two.mp4'),null);
  mode='timeout';assert.equal(await readDirectVideoDuration('https://video.twimg.com/three.mp4',5),null);
  const before=created;assert.equal(await readDirectVideoDuration('https://evil.test/x.mp4'),null);assert.equal(created,before);
  assert.equal(created,3);assert.equal(cleaned,3);assert.equal(fetchCalls,0);assert.ok(seen.every(url=>new URL(url).hostname==='video.twimg.com'));
 }finally{global.document=oldDoc;global.fetch=oldFetch;}
 console.log('PASS DIRECT PLAYBACK: CDN-only URLs; SSR no request; browser metadata only; success/error/timeout cleanup; no fetch, paid API or relay fallback.');
})().catch(error=>{console.error(error);process.exitCode=1;});
