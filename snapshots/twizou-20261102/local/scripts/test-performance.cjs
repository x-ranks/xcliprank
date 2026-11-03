'use strict';
const fs=require('node:fs'),p=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{PassThrough}=require('node:stream'),{renderToPipeableStream,renderToStaticMarkup}=require('react-dom/server');
const root=p.resolve(__dirname,'..'),cache=new Map();
function load(file,resolve){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(p.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve??(n=>n.startsWith('.')?local(p.posix.normalize(p.posix.join(p.posix.dirname(file),n))+'.ts'):require(n)),m,m.exports);return m.exports;}
function local(file){if(!cache.has(file))cache.set(file,load(file));return cache.get(file);}
const core=local('lib/public-video-core.ts'),{createPublicVideoService}=local('lib/public-video-service.ts');
const id='2061469959365280142',video={id,authorId:'123',handle:'fixture',authorName:'テスト投稿者',text:'検証用の本文 #テスト',posterUrl:'https://pbs.twimg.com/fixture.jpg',videoUrl:'https://video.twimg.com/fixture.mp4',createdAt:'2026-10-20T00:00:00Z',sourceHash:'a'.repeat(64),eligible:true};
const label={id:'test',name:'テスト',active:true};
const Link=({href,prefetch,children,...props})=>React.createElement('a',{href,...props},children);
function gate(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function main(){
 let catalogReads=0,postReads=0,authorReads=0,candidateReads=0,indexReads=0;
 const catalog=core.blankCatalog();catalog.labels=[label];catalog.records[id]={...core.blankRecord(id),sourceHash:video.sourceHash,labelIds:['test'],basis:'manual'};
 const deps={catalog:{read:async()=>{catalogReads++;return catalog;}},posts:async ids=>{postReads++;return ids.includes(id)?[video]:[];},authorVideos:async()=>{authorReads++;return [];},candidates:async()=>{candidateReads++;return [];},indexVideos:async()=>{indexReads++;return [video];},secret:async()=>'fixture'};
 const service=createPublicVideoService(deps,{readOnlyRender:true});const detail=await service.detailCore(id);
 assert(detail);assert.equal(detail.metadata.canonical,core.PUBLIC_SITE+'/p/'+id);
 assert.deepEqual({catalogReads,postReads,authorReads,candidateReads,indexReads},{catalogReads:1,postReads:1,authorReads:0,candidateReads:0,indexReads:0},'core and metadata do not query author/related/global index');
 await Promise.all([service.detailRelated(detail),service.activeLabels()]);assert.equal(catalogReads,1,'one catalogue read shared only within this render');
 const nextRequest=createPublicVideoService(deps,{readOnlyRender:true});await nextRequest.detailCore(id);assert.equal(catalogReads,2,'a new request reads fresh catalogue state');
 const admin=createPublicVideoService(deps);await admin.status();await admin.status();assert.equal(catalogReads,4,'admin revision reads remain fresh');
 const before=postReads;assert.equal(await service.detailCore('../bad'),null);assert.equal(postReads,before);video.eligible=false;assert.equal(await nextRequest.detailCore(id),null);video.eligible=true;
 const labelsGate=gate(),relatedGate=gate();let labelsCalls=0,relatedCalls=0;
 let bridge={readPublicDetailCore:async()=>detail,readPublicLabels:async()=>{labelsCalls++;return labelsGate.promise;},readPublicRelated:async()=>{relatedCalls++;return relatedGate.promise;}};
 function resolve(n){
  if(n==='react'||n==='react/jsx-runtime')return require(n);
  if(n==='next/link')return Link;if(n==='next/navigation')return {notFound(){throw Error('NOT_FOUND');}};
  if(n.endsWith('public-video-server'))return bridge;
  if(n.endsWith('DirectPlaybackVideo'))return ({postId,recoverEnabled,...props})=>React.createElement('video',props);
  if(n.endsWith('VideoDownloadButton'))return ()=>React.createElement('button',{},'動画を保存');
  if(n.endsWith('PublicPostLink'))return ({id,returnTo,nativeNavigation,ariaLabel,children,...props})=>React.createElement('a',{...props,href:'/p/'+id,'aria-label':ariaLabel},children);
  if(/(?:PublicListRestore|PublicPostClose|PublicPostEngagement)$/.test(n))return ()=>null;
  if(n.startsWith('.')&&n.includes('/components/'))return load('app/components/'+n.split('/').at(-1)+'.tsx',resolve).default;
  if(n.startsWith('.')&&n.includes('/lib/'))return local('lib/'+n.split('/').at(-1)+'.ts');
  throw Error('UNEXPECTED_PERFORMANCE_IMPORT '+n);
 }
 const page=load('app/p/[id]/page.tsx',resolve),props={params:Promise.resolve({id})};
 const metadata=await page.generateMetadata(props);assert.equal(metadata.robots.index,true);assert.equal(labelsCalls,0);assert.equal(relatedCalls,0);
 const tree=await page.default(props);assert.equal(labelsCalls,0);assert.equal(relatedCalls,0);
 let shell='';const full=await new Promise((done,fail)=>{
  const out=new PassThrough();let html='';out.on('data',chunk=>html+=chunk);out.on('end',()=>done(html));
  const stream=renderToPipeableStream(tree,{onShellReady(){stream.pipe(out);setImmediate(()=>{
   try{shell=html;assert(shell.includes('<video'));assert(shell.includes('テスト投稿者の動画'));assert(shell.includes('検証用の本文'));assert(shell.includes('VideoObject'));assert(shell.includes('BreadcrumbList'));assert(shell.includes('この動画を報告する'));assert(!shell.includes('/p/2061469959365280143'));
    labelsGate.resolve([{...label,count:3,index:true}]);relatedGate.resolve({sameAuthor:[{...video,id:'2061469959365280143'}],related:[],recommended:[]});
   }catch(error){stream.abort();fail(error);}
  });},onError:fail});
 });
 assert(full.includes('/p/2061469959365280143'));assert(full.includes('/tags/'+encodeURIComponent('テスト')));assert(full.includes('同じ投稿者の他動画'));assert.equal(labelsCalls,0,'Detail does not scan the global tag inventory');assert.equal(relatedCalls,1);
 bridge.readPublicRelated=async()=>{throw Error('fixture unavailable');};
 const degraded=await new Promise(async(done,fail)=>{const out=new PassThrough();let html='';out.on('data',c=>html+=c);out.on('end',()=>done(html));const stream=renderToPipeableStream(await page.default(props),{onAllReady(){stream.pipe(out);},onError:fail});});
 assert(degraded.includes('<video'));assert(degraded.includes('ほかの動画は'));assert(degraded.includes('href="/browse"'));
 bridge.readPublicDetailCore=async()=>null;await assert.rejects(page.default(props),/NOT_FOUND/);
 // Render the actual reels tree using synthetic state; effects/network are disabled.
 const posts=Array.from({length:120},(_,i)=>({author_id:'123',x_post_id:String(10000+i),author_name:'Fixture '+i,author_username:'fixture',preview_image_url:'https://pbs.twimg.com/poster-'+i+'.jpg',video_url:'https://video.twimg.com/video-'+i+'.mp4',x_url:'https://x.com/i/status/'+(10000+i),views:1,likes:0,reposts:0,replies:0,adult_tier:'A'}));
 function reels(reduced){let state=0;const values=fs.readFileSync(p.join(root,'app/reels/ReelsFeed.tsx'),'utf8').includes('const [durations,')?[{},posts,60,reduced,true,true,false,'',new Set(),0]:[posts,60,reduced,true,true,false,'',new Set(),0];const fakeReact={...React,useState(){const value=values[state++];return[value,()=>{}];},useRef:value=>({current:value}),useEffect(){},useCallback:fn=>fn};
  const feed=load('app/reels/ReelsFeed.tsx',n=>n==='react'?fakeReact:n==='react/jsx-runtime'?require(n):n.endsWith('useSuspendedAuthors')?()=>[]:n==='next/link'?Link:n.endsWith('VideoDownloadButton')?()=>null:n.endsWith('DirectPlaybackVideo')?({postId,recoverEnabled,...props})=>React.createElement('video',props):n.endsWith('PublicPostLink')?()=>null:n.startsWith('../../lib/')?local('lib/'+n.split('/').at(-1)+'.ts'):require(n)).default;
  return renderToStaticMarkup(React.createElement(feed));
 }
 const normal=reels(false),reduced=reels(true);assert.equal((normal.match(/<video /g)||[]).length,2);assert.equal((reduced.match(/<video /g)||[]).length,1);
 assert.equal((normal.match(/background-image:/g)||[]).length,3);assert.equal((reduced.match(/background-image:/g)||[]).length,2);assert(!normal.includes('video-59.mp4'));assert(normal.includes('video-60.mp4')&&normal.includes('video-61.mp4'));assert(!normal.includes('poster-119.jpg'));assert(!reduced.includes('video-61.mp4'));
 const snapshotRoot=fs.mkdtempSync(p.join(require('os').tmpdir(),'twizou-performance-snapshot-'));
 try {
  const clock=Date.now(),bucket=Math.floor(clock/(4*60*60*1000));
  const ranked=[0,1,2].map(i=>({x_post_id:String(30000+i),...(i===1?{has_video:true}:{video_url:'https://video.twimg.com/rising-'+i+'.mp4'}),siteOpens:1,siteSaves:0,risingScore:1}));
  fs.writeFileSync(p.join(snapshotRoot,'rising-ranking-v2.json'),JSON.stringify({version:1,bucket,updatedAt:new Date(clock).toISOString(),value:{posts:ranked,windowDays:7}}));
  let inspected;
  const rising=load('lib/rising-ranking.ts',n=>n==='server-only'?{}:n.endsWith('public-video-production')?{productionPublicBackend:()=>({service:{inspect:async ids=>{inspected=ids;return [{id:'30000',eligible:true,videoUrl:ranked[0].video_url,posterUrl:null,authorName:'A',handle:'a'},{id:'30001',eligible:true,videoUrl:'https://video.twimg.com/current.mp4',posterUrl:'https://pbs.twimg.com/current.jpg',authorName:'B',handle:'b'},{id:'30002',eligible:true,videoUrl:'https://video.twimg.com/changed.mp4',posterUrl:null,authorName:'C',handle:'c'}];}}})}:n.endsWith('public-save-secret')?{publicCatalogDirectory:()=>snapshotRoot}:n.endsWith('supabase-admin')?{supabaseAdmin(){throw Error('fresh snapshot must not aggregate');}}:n.endsWith('initial-ranking')?{loadRankingPage(){throw Error('fresh snapshot must not collect candidates');}}:n.startsWith('.')?local('lib/'+n.split('/').at(-1)+'.ts'):require(n));
  const visible=await rising.loadRisingRanking();assert.deepEqual(inspected,['30000','30001','30002']);assert.deepEqual(visible.posts.map(row=>row.x_post_id),['30000','30001'],'compact snapshot rows use fresh eligible media; changed URLs remain excluded');assert.equal(visible.posts[1].video_url,'https://video.twimg.com/current.mp4');assert.equal(visible.posts[1].preview_image_url,'https://pbs.twimg.com/current.jpg');
 } finally {if(p.dirname(snapshotRoot)!==require('os').tmpdir()||!p.basename(snapshotRoot).startsWith('twizou-performance-snapshot-'))throw Error('UNSAFE_FIXTURE_CLEANUP');fs.rmSync(snapshotRoot,{recursive:true,force:true});}
 const policy=local('lib/reel-load-policy.ts');assert(policy.reducedMediaData({saveData:true}));assert(policy.reducedMediaData({effectiveType:'2g'}));assert(!policy.reducedMediaData({effectiveType:'4g'}));
 const cards=load('app/components/PublicVideoCards.tsx',resolve).default;const cardsHtml=renderToStaticMarkup(React.createElement(cards,{videos:Array.from({length:10},(_,i)=>({...video,id:String(20000+i)})),priorityCount:4}));
 assert.equal((cardsHtml.match(/loading="eager"/g)||[]).length,4);assert.equal((cardsHtml.match(/loading="lazy"/g)||[]).length,6);assert.equal((cardsHtml.match(/fetchPriority="high"/gi)||[]).length,2,'React adds one preload hint plus one high-priority image');
 const relatedHtml=renderToStaticMarkup(React.createElement(cards,{videos:[video]}));assert(relatedHtml.includes('loading="lazy"'));
 // Production API and local bridge both expose the same fast detail contracts.
 if(!fs.readFileSync(p.join(root,'lib/public-video-server.ts'),'utf8').includes('Local-management bridge')){
  const api=load('app/api/public-video/route.ts',n=>n.endsWith('public-video-production')?{productionPublicBackend:()=>({service:createPublicVideoService(deps,{readOnlyRender:true})})}:n.endsWith('manual-ranking/route')?{GET:async()=>Response.json({})}:require(n));
  for(const type of ['detail-core','related']){const response=await api.GET(new Request(core.PUBLIC_SITE+'/api/public-video?type='+type+'&value='+id));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert((await response.json()).ok);}
 }
 console.log('PASS PERFORMANCE: core before deferred metadata/author/global scans; request-only read dedup; actual streamed SSR shell/player/schema before related/tag gates; related failure isolated; exclusions; 120-slide reels render 2/1 videos and at most 5/3 posters; four eager list cards, related stays lazy; API contracts; no network, media or analytics writes.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
