const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),deps=process.env.XCLIP_TEST_DEPENDENCY_ROOT||root,ts=require(deps+'/node_modules/typescript');
const React=require(deps+'/node_modules/react'),{renderToStaticMarkup}=require(deps+'/node_modules/react-dom/server');
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
const pagination=load('lib/ranking-pagination.ts');
const update=load('lib/ranking-update.ts');
const posts=Array.from({length:50},(_,i)=>({x_post_id:String(10000+i),ranking_position:51+i,author_username:'fixture',author_name:'fixture',x_url:'https://x.com/fixture/status/'+(10000+i),preview_image_url:null,video_url:null,created_at:'2026-10-13T00:00:00Z',views:1,likes:0,replies:0,reposts:0,adult_tier:'A'}));
const edition='1791894900000-aaaaaaaaaaaa';let status=200;const requests=[];
const pageData={status:200,posts,edition,update:update.readRankingUpdate({rankingUpdatedAt:'2026-10-14T09:35:00.000Z',edition}),pagination:{page:2,pageSize:50,totalPosts:500,totalPages:10,edition,previousHref:pagination.newestPageHref(1,edition),nextHref:pagination.newestPageHref(3,edition)}};
global.fetch=()=>{throw Error('SSR_MUST_NOT_CALL_PROVIDER');};
const Link=({href,children,...props})=>React.createElement('a',{href,...props},children);
const Client=load('app/components/RankingClient.tsx',n=>{
 if(n==='react'||n==='react/jsx-runtime')return require(deps+'/node_modules/'+n);
 if(n.endsWith('useSuspendedAuthors'))return ()=>[];
 if(n.endsWith('post-status'))return {isUnavailablePost:()=>false};
 if(n.endsWith('ranking-update'))return update;
 if(n.endsWith('browser-direct-playback'))return {directPlaybackUrl:x=>x};
 if(n.endsWith('engagement-client'))return {trackEngagement:()=>{throw Error('SSR_EFFECT_EXECUTED');}};
 if(/DirectPlaybackVideo|VideoDownloadButton|VideoDurationBadge/.test(n))return ()=>null;
 throw Error('Unexpected client import '+n);
}).default;
const seo=load('lib/seo.ts');
const structured=load('app/components/StructuredData.tsx',n=>n==='react/jsx-runtime'?require(deps+'/node_modules/'+n):require(n)).default;
function resolve(n){
 if(n==='react/jsx-runtime')return require(deps+'/node_modules/'+n);
 if(n==='next/link')return Link;
 if(n==='next/navigation')return {notFound:()=>{throw Error('NOT_FOUND');},redirect:p=>{throw Error('REDIRECT '+p);}};
 if(n.endsWith('RankingClient'))return Client;
 if(n.endsWith('StructuredData'))return structured;
 if(n.endsWith('SiteFooter'))return ()=>null; // unchanged server-only component not included in source receipt
 if(n.endsWith('ranking-pagination'))return pagination;
 if(n.endsWith('initial-ranking'))return {loadRankingPage:async(...args)=>{requests.push(args);return {...pageData,status};}};
 if(n.endsWith('/seo'))return seo;
 if(n.endsWith('DedicatedRankingPage'))return load('app/components/DedicatedRankingPage.tsx',resolve).default;
 throw Error('Unexpected page import '+n);
}
(async()=>{
 const home=load('app/page.tsx',resolve);
 const meta=await home.generateMetadata({searchParams:Promise.resolve({page:'2',edition})});assert.equal(meta.alternates.canonical,'https://xcliprank.com/?page=2');
 const {resolveAlternates}=require(deps+'/node_modules/next/dist/lib/metadata/resolvers/resolve-basics.js');
 // Exercise the installed framework, not only our pre-resolution metadata value.
 for(let page=1;page<=10;page++){
  const generated=await home.generateMetadata({searchParams:Promise.resolve({page:String(page),edition})});
  assert.equal(generated.metadataBase,null);
  const resolved=await resolveAlternates(generated.alternates,generated.metadataBase,'/',{trailingSlash:false});
  assert.equal(resolved.canonical.url,'https://xcliprank.com'+pagination.newestPageHref(page));
  assert.equal(new URL(resolved.canonical.url).searchParams.has('edition'),false);
 }
 const oldResult=await resolveAlternates({canonical:'/?page=2'},new URL('https://xcliprank.com'),'/',{trailingSlash:false});
 if(oldResult.canonical.url!=='https://xcliprank.com/?page=2')assert.equal(new URL(oldResult.canonical.url).search,'','root-query regression reproduced');
 const html=renderToStaticMarkup(await home.default({searchParams:Promise.resolve({page:'2',edition})}));
 assert.equal((html.match(/class="video-card"/g)||[]).length,50);
 assert(html.includes('一覧更新：'));assert(html.includes('2026/10/14 18:35'));assert(html.includes('dateTime="2026-10-14T09:35:00.000Z"'));assert(html.includes('<a href="/">最新の一覧を表示</a>'));
 assert(html.includes('さらに表示（次の50件）'));assert(html.includes('page=3&amp;edition='+edition));
 assert(html.includes('position":51'));assert(html.includes('numberOfItems":50'));assert(html.includes('#51'));
 assert(html.includes('/ranking/daily?edition='+edition));assert(html.includes('/ranking/weekly?edition='+edition));
 assert.deepEqual(requests[0],['trending',2,edition]);
 await assert.rejects(home.default({searchParams:Promise.resolve({page:'11'})}),/NOT_FOUND/);
 status=410;await assert.rejects(home.default({searchParams:Promise.resolve({page:'2',edition})}),/REDIRECT \//);
 status=503;await assert.rejects(home.default({searchParams:Promise.resolve({})}),/NEWEST_RANKING_LOAD_FAILED/);
 status=200;
 for(const range of ['daily','weekly']){
  const page=load('app/ranking/'+range+'/page.tsx',resolve);
  const rendered=renderToStaticMarkup(await page.default({searchParams:Promise.resolve({edition})}));
  assert(rendered.includes('/?edition='+edition));assert(rendered.includes('2026/10/14 18:35'));assert(rendered.includes('<a href="/ranking/'+range+'">最新の一覧を表示</a>'));assert.equal(requests.at(-1)[0],range);assert.equal(requests.at(-1)[2],edition);
 }
 console.log('PASS NEWEST500 SSR: actual Home/RankingClient/dedicated pages;50 cards; crawlable next/prev; canonical pages1-10 through actual Next resolver; matching ItemList51-100; edition kept across tabs; invalid404/expired reset/error refusal; unchanged missing components stubbed; no HTTP or effects.');
})().catch(e=>{console.error(e);process.exitCode=1;});
