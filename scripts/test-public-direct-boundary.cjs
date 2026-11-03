'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map(),oldFetch=global.fetch;
function load(rel){if(cache.has(rel))return cache.get(rel).exports;const m={exports:{}};cache.set(rel,m);new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,rel+'.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(rel),n))):require(n),m,m.exports);return m.exports;}
async function main(){
 for(const rel of ['app/p/[id]/page.tsx','app/components/RankingClient.tsx','app/reels/ReelsFeed.tsx']){const s=fs.readFileSync(path.join(root,rel),'utf8');assert(s.includes('DirectPlaybackVideo'),rel);assert(!s.includes('/api/video?'),rel);}
 for(const rel of ['app/components/PublicVideoCards.tsx','app/rising/page.tsx'])assert(!fs.readFileSync(path.join(root,rel),'utf8').includes('/api/video?'),rel);
 const player=fs.readFileSync(path.join(root,'app/components/DirectPlaybackVideo.tsx'),'utf8');assert(!player.includes('/api/video?'));assert(!player.includes('tier-preview-playback'));assert(player.includes('fetchDirectVideo'));assert(player.includes('attachDirectStream'));
 const direct=load('lib/browser-direct-download'),stream=load('lib/browser-stream-playback');const clientRequests=[];
 const fetcher=async(url,init)=>{clientRequests.push({url:String(url),method:init?.method??'GET'});if(String(url).startsWith('/api/video-playback-url?'))return Response.json({mode:'browser-direct',url:'https://video.twimg.com/public.mp4',hlsUrl:'https://video.twimg.com/master.m3u8'});assert.equal(new URL(String(url)).hostname,'video.twimg.com');return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'video/mp4','content-length':'3'}});};
 const c=new AbortController(),sources=await stream.getStreamingSources('123',c.signal,fetcher);assert.equal(sources.url,'https://video.twimg.com/public.mp4');assert.equal(sources.hlsUrl,'https://video.twimg.com/master.m3u8');const blob=await direct.fetchDirectVideo(sources.url,{signal:c.signal,fetcher});assert.equal(blob.size,3);assert.deepEqual(clientRequests.map(r=>r.url),['/api/video-playback-url?postId=123','https://video.twimg.com/public.mp4']);
 for(const url of ['https://video.twimg.com/master.m3u8','https://video.twimg.com/segment.ts','https://video.twimg.com/key']){const r=stream.directStreamRequest(url,{});assert.equal(new URL(r.url).hostname,'video.twimg.com');assert.equal(r.credentials,'omit');assert.equal(r.redirect,'error');}
 assert.throws(()=>stream.directStreamRequest('https://twizou.net/api/video?url=x',{}));
 // Execute the real public playback-URL handler with a stub for metadata lookup.
 const routeText=fs.readFileSync(path.join(root,'app/api/video-playback-url/route.ts'),'utf8'),route={exports:{}};let reads=0,forbidden=0;
 global.fetch=async()=>{forbidden++;throw Error('SERVER_VIDEO_FETCH_FORBIDDEN');};
 new Function('require','module','exports',ts.transpileModule(routeText,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{
 if(n.endsWith('supabase-admin'))return{supabaseAdmin:()=>{throw Error('stub refresh handles DB metadata');}};
 if(n.endsWith('download-free'))return{fetchFreePlaybackMedia:async()=>{throw Error('stub refresh handles metadata');}};
 if(n.endsWith('download-url'))return{DownloadError:class extends Error{constructor(status,message){super(message);this.status=status;}}};
 if(n.endsWith('playback-refresh'))return{refreshPlaybackSources:async()=>{reads++;return sources;}};
 throw Error('UNEXPECTED_IMPORT '+n);
 },route,route.exports);
 const response=await route.exports.GET(new Request('https://twizou.net/api/video-playback-url?postId=123'));assert.equal(response.status,200);assert(response.headers.get('content-type').includes('application/json'));assert.deepEqual(await response.json(),{...sources,mode:'browser-direct'});assert.equal(reads,1);assert.equal(forbidden,0);
 console.log('PASS PUBLIC DIRECT BOUNDARY: detail/ranking/reels entries, direct MP4 recovery, CDN-only playlist/segment/key request guards, actual playback-info handler JSON and no server video fetch. Static/mocked evidence, not a live-server network capture.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{global.fetch=oldFetch;});
