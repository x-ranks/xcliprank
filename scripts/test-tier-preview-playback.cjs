const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const component=fs.readFileSync('app/components/TierPreviewVideo.tsx','utf8'),page=fs.readFileSync('app/tier-video-preview/page.tsx','utf8');
assert(page.includes('<TierPreviewVideo id={s.id} url={s.video} poster={s.poster}/>'));
assert(component.includes('/api/video?url=${encodeURIComponent(url)}'));
assert(component.includes('preload="none"'));
const original=global.fetch,requests=[];
class Reply extends Response{static json(v,options){return new Reply(JSON.stringify(v),options);}}
const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync('app/api/video/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='next/server'?{NextResponse:Reply}:{isAllowedVideoUrl:u=>u.startsWith('https://video.twimg.com/'),cachedVideoDuration:async()=>null},m,m.exports);
(async()=>{global.fetch=async(url,options)=>{requests.push({url,options});return new Response('x',{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-0/123','content-length':'1'}});};
 const url='https://video.twimg.com/fixture.mp4?tag=12';
 const response=await m.exports.GET({nextUrl:new URL('http://localhost:3004/api/video?url='+encodeURIComponent(url)),headers:new Headers({range:'bytes=0-0'})});
 assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-0/123');assert.equal(response.headers.get('content-type'),'video/mp4');assert.equal(requests[0].url,url);assert.equal(requests[0].options.headers.Range,'bytes=0-0');assert(requests[0].options.headers['User-Agent']);await response.body.cancel();
 console.log('PASS: preview uses existing video proxy; URL preserved; seek/range206, content-range and media type forwarded; lazy playback');
})().finally(()=>{global.fetch=original;}).catch(e=>{console.error(e);process.exitCode=1;});
