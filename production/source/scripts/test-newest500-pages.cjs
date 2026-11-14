const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),deps=process.env.XCLIP_TEST_DEPENDENCY_ROOT||root,ts=require(deps+'/node_modules/typescript');
const React=require(deps+'/node_modules/react'),{renderToStaticMarkup}=require(deps+'/node_modules/react-dom/server');
function load(file,resolve=require){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}

// Render the actual new client children with React SSR; keep this test's parent hook harness.
const mobileCache = new Map();
function mobileResolve(n) {
 if(n==='react'||n==='react/jsx-runtime')return require(n);
 if(/(?:PublicPostLink|PublicListRestore|PublicPostClose)$/.test(n))return mobileComponent(n.split('/').at(-1));if(n.endsWith('public-return-navigation'))return load('lib/public-return-navigation.ts');if(n.endsWith('ranking-pagination'))return load('lib/ranking-pagination.ts');
 if(n==='next/link')return Link;
 if(n==='next/navigation')return {useRouter:()=>({replace:()=>{throw Error('SSR_NAVIGATION_FORBIDDEN');}})};
 if(n.endsWith('public-return-navigation'))return load('lib/public-return-navigation.ts');
 throw Error('UNEXPECTED_MOBILE_IMPORT '+n);
}
function mobileComponent(name) {if(!mobileCache.has(name))mobileCache.set(name,load('app/components/'+name+'.tsx',mobileResolve).default);return mobileCache.get(name);}

const pagination=load('lib/ranking-pagination.ts');
const update=load('lib/ranking-update.ts');
const posts=Array.from({length:50},(_,i)=>({x_post_id:String(10000+i),ranking_position:51+i,author_username:'fixture',author_name:'fixture',x_url:'https://x.com/fixture/status/'+(10000+i),preview_image_url:null,video_url:null,created_at:'2026-10-13T00:00:00Z',views:1,likes:0,replies:0,reposts:0,adult_tier:'A'}));
const edition='1791894900000-aaaaaaaaaaaa';let status=200;const requests=[];
const pageData={status:200,posts,edition,update:update.readRankingUpdate({rankingUpdatedAt:'2026-10-14T09:35:00.000Z',edition}),pagination:{page:2,pageSize:50,totalPosts:500,totalPages:10,edition,previousHref:pagination.newestPageHref(1,edition),nextHref:pagination.newestPageHref(3,edition)}};
global.fetch=()=>{throw Error('SSR_MUST_NOT_CALL_PROVIDER');};
const Link=({href,children,prefetch,...props})=>React.createElement('a',{href,...props},children);
const Client=load('app/components/RankingClient.tsx',n=>{

 if(/(?:PublicPostLink|PublicListRestore|PublicPostClose)$/.test(n))return mobileComponent(n.split(String.fromCharCode(47)).at(-1));
 if(n.endsWith("ranking-pagination"))return pagination;
 if(n.endsWith("share-video"))return {shareVideoHref:()=>null};
 if(n==='react'||n==='react/jsx-runtime')return require(deps+'/node_modules/'+n);
 if(n==='next/link')return Link;
 if(n.endsWith('useSuspendedAuthors'))return ()=>[];
 if(n.endsWith('post-status'))return {isUnavailablePost:()=>false};
 if(n.endsWith('ranking-update'))return update;if(n.endsWith('ranking-display'))return load('lib/ranking-display.ts');
 if(n.endsWith('browser-direct-playback'))return {directPlaybackUrl:x=>x};
 if(n.endsWith('engagement-client'))return {trackEngagement:()=>{throw Error('SSR_EFFECT_EXECUTED');}};
 if(/DirectPlaybackVideo|ExternalVideo|VideoDownloadButton|VideoDurationBadge/.test(n))return ()=>null;
 throw Error('Unexpected client import '+n);
}).default;
const seo=load('lib/seo.ts');
const structured=load('app/components/StructuredData.tsx',n=>n==='react/jsx-runtime'?require(deps+'/node_modules/'+n):require(n)).default;
function resolve(n){if(n.endsWith("SiteBrand"))return load("app/components/SiteBrand.tsx",resolve).default;
 if(n==='react/jsx-runtime')return require(deps+'/node_modules/'+n);
 if(n==='next/link')return Link;
 if(n==='next/navigation')return {notFound:()=>{throw Error('NOT_FOUND');},redirect:p=>{throw Error('REDIRECT '+p);}};
 if(n.endsWith('RankingClient'))return Client;
 if(n.endsWith('StructuredData'))return structured;
 if(n.endsWith('SiteFooter'))return ()=>null; // unchanged server-only component not included in source receipt
 if(n.endsWith('NewSinceVisit'))return ()=>null; // client-only personalisation, no effect on SSR cards or links
 if(n.endsWith('ranking-pagination'))return pagination;if(n.endsWith('ranking-display'))return load('lib/ranking-display.ts');
 if(n.endsWith('initial-ranking'))return {loadRankingPage:async(...args)=>{requests.push(args);return {...pageData,status};}};
 if(n.endsWith('/seo'))return seo;
 if(n.endsWith('DedicatedRankingPage'))return load('app/components/DedicatedRankingPage.tsx',resolve).default;
 throw Error('Unexpected page import '+n);
}
function assertCanonicalRankingLinks(html){
 const hrefs=[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
 for(const href of ["/","/ranking/daily","/ranking/weekly"]) assert(hrefs.includes(href),href);
 assert(!hrefs.some(href=>href.startsWith("/ranking/")&&href.includes("edition=")));
}
(async()=>{
 const home=load('app/page.tsx',resolve);
 const firstMetadata=await home.generateMetadata({searchParams:Promise.resolve({})});assert(firstMetadata.title.absolute.startsWith('twizou｜Twitter動画ランキング'));
 const meta=await home.generateMetadata({searchParams:Promise.resolve({page:'2',edition})});assert.equal(meta.alternates.canonical,'https://twizou.net/?page=2');
 const {resolveAlternates}=require(deps+'/node_modules/next/dist/lib/metadata/resolvers/resolve-basics.js');
 // Exercise the installed framework, not only our pre-resolution metadata value.
 for(let page=1;page<=10;page++){
  const generated=await home.generateMetadata({searchParams:Promise.resolve({page:String(page),edition})});
  assert.equal(generated.metadataBase,null);
  const resolved=await resolveAlternates(generated.alternates,generated.metadataBase,'/',{trailingSlash:false});
  assert.equal(resolved.canonical.url,'https://twizou.net'+pagination.newestPageHref(page));
  assert.equal(new URL(resolved.canonical.url).searchParams.has('edition'),false);
 }
 const oldResult=await resolveAlternates({canonical:'/?page=2'},new URL('https://twizou.net'),'/',{trailingSlash:false});
 if(oldResult.canonical.url!=='https://twizou.net/?page=2')assert.equal(new URL(oldResult.canonical.url).search,'','root-query regression reproduced');
 const html=renderToStaticMarkup(await home.default({searchParams:Promise.resolve({page:'2',edition})}));
 assert.equal((html.match(/class="video-card"/g)||[]).length,50);
 assert(html.includes('新着動画を紹介！'));assert(html.includes('class="site-brand-band"'));assert(html.includes('aria-label="twizouのトップページ（急上昇）へ"'));
 assert(html.includes('一覧更新：'));assert(html.includes('2026/10/14 18:35'));assert(html.includes('dateTime="2026-10-14T09:35:00.000Z"'));assert(html.includes('<a href="/">最新の一覧を表示</a>'));
 assert(html.includes('さらに表示（次の50件）'));assert(html.includes('page=3&amp;edition='+edition));
 assert(html.includes('position":51'));assert(html.includes('numberOfItems":50'));assert(html.includes('#51'));
 assertCanonicalRankingLinks(html);
 assert(html.includes('href="/?edition='+edition+'"'),'previous page keeps its edition');
 assert(!html.includes('href="/ranking/daily?edition='));
 assert(!html.includes('href="/ranking/weekly?edition='));
 assert.deepEqual(requests[0],['trending',2,edition]);
 await assert.rejects(home.default({searchParams:Promise.resolve({page:'11'})}),/NOT_FOUND/);
 status=410;await assert.rejects(home.default({searchParams:Promise.resolve({page:'2',edition})}),/REDIRECT \//);
 status=503;await assert.rejects(home.default({searchParams:Promise.resolve({})}),/NEWEST_RANKING_LOAD_FAILED/);
 status=200;
 for(const range of ['daily','weekly']){
  const page=load('app/ranking/'+range+'/page.tsx',resolve);
  const rendered=renderToStaticMarkup(await page.default({searchParams:Promise.resolve({edition})}));
  assertCanonicalRankingLinks(rendered);assert(!/href="[^"]*[?&]edition=/.test(rendered));assert(rendered.includes('2026/10/14 18:35'));assert(rendered.includes('<a href="/ranking/'+range+'">最新の一覧を表示</a>'));assert.equal(requests.at(-1)[0],range);assert.equal(requests.at(-1)[2],edition);
 }
 console.log('PASS NEWEST500 SSR: actual Home/RankingClient/dedicated pages;50 cards; crawlable next/prev; canonical pages1-10 through actual Next resolver; matching ItemList51-100; clean tab links with pinned pagination; invalid404/expired reset/error refusal; unchanged missing components stubbed; no HTTP or effects.');
})().catch(e=>{console.error(e);process.exitCode=1;});
