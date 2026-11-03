'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),hasMetadata=fs.existsSync(path.join(root,'lib/video-duration.ts'));
const componentPath=path.join(root,'app/components/TierPreviewVideo.tsx');const component=fs.existsSync(componentPath)?fs.readFileSync(componentPath,'utf8'):null;
if(component){assert(component.includes('directPlaybackUrl(url)'));assert(!component.includes('/api/video?'));assert(component.includes('preload="none"'));}

if(component){
 const React=require('react'),render=require('react-dom/server').renderToStaticMarkup;const helper={exports:{}};
 new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,'lib/browser-direct-playback.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,helper,helper.exports);
 const c={exports:{}};new Function('require','module','exports',ts.transpileModule(component,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(n=>n.endsWith('browser-direct-playback')?helper.exports:require(n),c,c.exports);
 const html=render(React.createElement(c.exports.default,{id:1,url:'https://video.twimg.com/fixture.mp4?tag=12'}));assert(html.includes('src="https://video.twimg.com/fixture.mp4?tag=12"'));assert(!html.includes('/api/video?'));assert(html.includes('preload="none"'));
 const invalid=render(React.createElement(c.exports.default,{id:1,url:'https://evil.invalid/x.mp4'}));assert(!invalid.includes('src="https://evil'));
}
const oldFetch=global.fetch;let metadataCalls=0;const m={exports:{}};
const code=ts.transpileModule(fs.readFileSync(path.join(root,'app/api/video/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','module','exports',code)(n=>{if(n.endsWith('video-duration'))return{isAllowedVideoUrl:u=>/^https:\/\/video[.]twimg[.]com\//.test(u),cachedVideoDuration:async()=>{metadataCalls++;return 83;}};throw Error('UNEXPECTED_IMPORT '+n);},m,m.exports);
(async()=>{global.fetch=async()=>{throw Error('VIDEO_BYTES_MUST_NOT_BE_REQUESTED');};
for(const suffix of ['', '?url='+encodeURIComponent('https://video.twimg.com/fixture.mp4'), '?url='+encodeURIComponent('https://video.twimg.com/fixture.mp4')+'&metadata=0']){const r=await m.exports.GET(new Request('http://localhost:3004/api/video'+suffix,{headers:{Range:'bytes=0-0'}}));assert.equal(r.status,410);assert.equal((await r.json()).error,'VIDEO_RELAY_DISABLED');assert.equal(r.headers.get('cache-control'),'no-store');}assert.equal(metadataCalls,0);assert.equal((await m.exports.HEAD()).status,410);
if(hasMetadata){let r=await m.exports.GET(new Request('http://localhost:3004/api/video?metadata=1&url='+encodeURIComponent('https://video.twimg.com/fixture.mp4')));assert.equal(r.status,200);assert.deepEqual(await r.json(),{durationSeconds:83});assert.equal(metadataCalls,1);r=await m.exports.GET(new Request('http://localhost:3004/api/video?metadata=1&url=http://127.0.0.1/private'));assert.equal(r.status,400);assert.equal(metadataCalls,1);}
for(const rel of ["app/combined-ranking-preview/page.tsx","app/content-filter-review/page.tsx","app/visual-filter-preview/page.tsx","app/ranking-admin/page.tsx","app/review/page.tsx","app/teacher-authors/page.tsx","app/preference-model/page.tsx"]){const text=fs.readFileSync(path.join(root,rel),'utf8');assert(!text.includes('/api/video?'),rel);assert(text.includes('directPlaybackUrl'),rel);}
console.log('PASS NO VIDEO RELAY: GET and Range and HEAD return 410 without upstream request; management callers use CDN-only direct URLs; duration JSON preserved where supported. Mocked only.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.fetch=oldFetch;});
