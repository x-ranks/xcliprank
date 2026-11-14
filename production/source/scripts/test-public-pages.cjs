'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
const {PassThrough}=require('node:stream'),{renderToPipeableStream}=require('react-dom/server');
function renderPage(tree){return new Promise((resolve,reject)=>{const out=new PassThrough();let html='';out.on('data',chunk=>html+=chunk);out.on('end',()=>resolve(html.replace(/<!--[^]*?-->/g,'')));const stream=renderToPipeableStream(tree,{onAllReady(){stream.pipe(out);},onError:reject});});}
function load(file,resolve=require){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}

// Render the actual new client children with React SSR; keep this test's parent hook harness.
const mobileCache = new Map();
function mobileResolve(n) {
 if(n==='react'||n==='react/jsx-runtime')return require(n);
 if(n==='next/link')return Link;
 if(n==='next/navigation')return {useRouter:()=>({replace:()=>{throw Error('SSR_NAVIGATION_FORBIDDEN');}})};
 if(n.endsWith('public-return-navigation'))return load('lib/public-return-navigation.ts');
 throw Error('UNEXPECTED_MOBILE_IMPORT '+n);
}
function mobileComponent(name) {if(!mobileCache.has(name))mobileCache.set(name,load('app/components/'+name+'.tsx',mobileResolve).default);return mobileCache.get(name);}

const core=load('lib/public-video-core.ts',n=>n.endsWith('indexability')?load('lib/indexability.ts'):require(n)),video={id:'1850123456789012345',authorId:'111',handle:'fixture',authorName:'投稿者A',text:'本文です <script>alert(1)</script>',posterUrl:null,videoUrl:'https://video.twimg.com/fixture.mp4',createdAt:null,sourceHash:'a'.repeat(64),eligible:true};
let record={...core.blankRecord(video.id),firstRankedAt:'2026-10-18T00:00:00Z'},reads=0,missing=false,tagName='ラベルA',relatedAvailable=true;
const Link=({children,href,prefetch,...props})=>React.createElement('a',{href,...props},children);
const bridge={readPublicMonths:async()=>[],readPublicPopular:async()=>null,readPublicRankDays:async()=>[],readPublicDetail:async()=>{reads++;return missing?null:{video,metadata:core.videoMetadata(video,record),labels:[{id:'a',name:'ラベルA',active:true}],sameAuthor:[{...video,id:'1850123456789012346'}],related:relatedAvailable?[{...video,id:'1850123456789012347'}]:[],recommended:relatedAvailable?[]:[{...video,id:'1850123456789012348'}]};},readPublicIndex:async()=>({posts:[{id:video.id,modifiedAt:record.firstRankedAt}],accounts:[{key:'fixture'}],tags:[{id:'a',name:'ラベルA',count:3,index:true}]}),readPublicAccount:async()=>({name:video.authorName,key:'fixture',canonicalKey:'fixture',index:true,videos:[video,{...video,id:'1850123456789012346'}]}),readPublicTag:async()=>({label:{name:tagName,id:'a',active:true},videos:[video],index:false}),readPublicLabels:async()=>[{id:'a',name:'ラベルA',count:3,index:true},{id:'b',name:'ラベルB',count:2,index:true}]};
bridge.readPublicDetailCore=bridge.readPublicDetail;bridge.readPublicRelated=bridge.readPublicDetail;
const share=load('lib/share-video.ts',n=>n.endsWith('public-video-core')?core:require(n));
const cards=load('app/components/PublicVideoCards.tsx',resolve).default;
function resolve(n){if(n==='react')return React;if(n.endsWith('public-video-schema'))return load('lib/public-video-schema.ts',resolve);if(n.endsWith('video-technical'))return load('lib/video-technical.ts',resolve);if(n.endsWith('video-duration-format'))return load('lib/video-duration-format.ts',resolve);if(n.endsWith('PublicPostText'))return load('app/components/PublicPostText.tsx',resolve).default;if(n.endsWith('initial-ranking'))return{loadRankingPage:async()=>({status:200,pagination:{totalPages:1}})};if(n.endsWith("SiteBrand"))return load("app/components/SiteBrand.tsx",resolve).default;if(n.endsWith('PublicPostEngagement'))return props=>React.createElement('span',{'data-tracked-post':props.postId,'data-source-page':props.sourcePage??'direct'});if(n.endsWith('StructuredData'))return props=>React.createElement('script',{type:'application/ld+json',dangerouslySetInnerHTML:{__html:JSON.stringify(props.data)}});if(/(?:PublicPostLink|PublicListRestore|PublicPostClose)$/.test(n))return mobileComponent(n.split('/').at(-1));if(n.endsWith('public-return-navigation'))return load('lib/public-return-navigation.ts');if(n.endsWith('ranking-pagination'))return load('lib/ranking-pagination.ts');if(n.endsWith('public-list-pages'))return load('lib/public-list-pages.ts');if(n.endsWith('indexability'))return load('lib/indexability.ts');if(n.endsWith('month-pages'))return load('lib/month-pages.ts');if(n.endsWith('share-video'))return share;if(n==='react/jsx-runtime')return require('react/jsx-runtime');if(n==='next/link')return Link;if(n==='next/navigation')return{notFound(){throw Error('NOT_FOUND');},permanentRedirect(){throw Error('REDIRECT');}};if(n.endsWith('public-video-core'))return core;if(n.endsWith('public-video-server'))return bridge;if(n.endsWith('/seo'))return{SITE_URL:core.PUBLIC_SITE,SITE_NAME:'twizou'};if(n.endsWith('PublicVideoCards'))return cards;if(n.endsWith('DirectPlaybackVideo'))return ({postId,...props})=>React.createElement('video',props);if(n.endsWith('PostActionBar'))return load('app/components/PostActionBar.tsx',resolve).default;if(n.endsWith('PopularRankingPage'))return load('app/components/PopularRankingPage.tsx',resolve);if(n.endsWith('SiteFooter'))return {__esModule:true,default:()=>null};if(n.endsWith('rank-history-pages'))return load('lib/rank-history-pages.ts',null);if(n.endsWith('VideoDownloadButton'))return props=>React.createElement('button',{'data-post':props.postId},'動画を保存');throw Error('UNEXPECTED_IMPORT '+n);}
async function main(){
 const tagHub=load('app/tags/page.tsx',resolve),hubMeta=await tagHub.generateMetadata();assert.equal(hubMeta.title,'タグ一覧');assert.equal(hubMeta.alternates.canonical,'/tags');assert.equal(hubMeta.robots.follow,true);const hubHtml=renderToStaticMarkup(await tagHub.default());assert(hubHtml.includes('タグ一覧'));assert(hubHtml.includes('/tags/'+encodeURIComponent('ラベルA')));assert(!hubHtml.includes('ラベル一覧'));
 const p=load('app/p/[id]/page.tsx',resolve),props={params:Promise.resolve({id:video.id})};let m=await p.generateMetadata(props);assert.equal(m.robots.index,true);assert.equal(m.alternates.canonical,core.PUBLIC_SITE+'/p/'+video.id);assert(m.title.absolute.includes('投稿者A')&&m.title.absolute.includes('本文です')&&m.title.absolute.includes('twizou'));
 const html=await renderPage(await p.default(props));for(const value of ['動画を保存','この動画を報告する','/removal-request?post='+video.id,'https://x.com/i/status/'+video.id,'/accounts/fixture','同じ投稿者の他動画','関連動画','この動画に付けられたタグ','class="public-post-player"','/p/1850123456789012346','/p/1850123456789012347','/tags/'+encodeURIComponent('ラベルA'),'/tags'])assert(html.includes(value),value);assert(html.includes('https://twitter.com/intent/tweet?'));assert(html.includes('data-tracked-post="'+video.id+'"'));assert(html.includes('data-source-page="direct"'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>alert'));assert(!html.includes('自動推定のラベルです。'));assert(!html.includes('初回保存'));assert(!html.includes('保存数（'));assert(!html.includes('このサイト経由の保存操作は、現在記録されていません。'));video.views=123;video.likes=4;video.bookmarks=2;const metrics=await renderPage(await p.default(props));assert(metrics.includes('X表示'));assert(metrics.includes('123回'));assert(metrics.includes('Xブックマーク'));assert(metrics.includes('2件'));assert(!metrics.includes('サイト経由の保存操作とは別'));assert(!metrics.includes('端末内への保存完了'));assert(metrics.includes('aria-label="twizouのトップページ（急上昇）へ"'));assert(metrics.includes('href="/rising"'));delete video.views;delete video.likes;delete video.bookmarks;
 relatedAvailable=false;const recommendedHtml=await renderPage(await p.default(props));assert(recommendedHtml.includes('おすすめの人気動画'));assert(recommendedHtml.includes('/p/1850123456789012348'));relatedAvailable=true;
 record={...record,saves:2,firstSavedAt:'2026-10-18T01:02:03Z'};const saved=await renderPage(await p.default(props));assert(saved.includes('サイト内の保存操作'));assert(!saved.includes('初回保存'));assert(!saved.includes('2026-10-18T01:02:03Z'));assert(saved.includes('2件'));
 record=core.blankRecord(video.id);assert.equal((await p.generateMetadata(props)).robots.index,true);video.text='';record.firstRankedAt='2026-10-18T00:00:00Z';assert.equal((await p.generateMetadata(props)).robots.index,false);
 const summary=await renderPage(await p.default(props));assert(summary.includes('この動画に付けられたタグ'));assert(!summary.includes('この動画のタグはラベルAです。'));assert(!summary.includes('この投稿の本文は登録されていません。'));
 video.createdAt='2026-10-05T00:00:00Z';const labelled=core.videoMetadata(video,record,[{id:'a',name:'ラベルA',active:true}]);assert(labelled.title.includes('ラベルA'));assert(labelled.description.includes('ラベルA'));assert(labelled.description.includes('2026'));video.createdAt=null;
 video.posterUrl='https://pbs.twimg.com/a.jpg';const cardHtml=renderToStaticMarkup(React.createElement(cards,{videos:[video]}));assert(cardHtml.includes('width="392" height="220"'));video.posterUrl=null;
 missing=true;await assert.rejects(p.default(props),/NOT_FOUND/);assert.deepEqual(await p.generateMetadata(props),{});const before=reads;await assert.rejects(p.default({params:Promise.resolve({id:'../invalid'})}),/NOT_FOUND/);assert.equal(reads,before);
 const sitemap=await load('app/sitemap.ts',resolve).default();assert(sitemap.some(r=>r.url===core.PUBLIC_SITE+'/p/'+video.id));assert(sitemap.some(r=>r.url===core.PUBLIC_SITE+'/rising'));assert.equal(sitemap.length,13);
 for(const [file,params]of [['app/accounts/[key]/page.tsx',{key:'fixture'}],['app/tags/[name]/page.tsx',{name:'ラベルA'}]]){const page=load(file,resolve),meta=await page.generateMetadata({params:Promise.resolve(params)});assert.equal(meta.robots.index,file.includes('/accounts/'));assert(meta.alternates.canonical.startsWith(core.PUBLIC_SITE));const pageHtml=renderToStaticMarkup(await page.default({params:Promise.resolve(params)}));assert(pageHtml.includes('/p/'+video.id));assert(!/href="\/p\/[^" ]+\?from=/.test(pageHtml),'Hub cards must expose clean detail links');}
 // Monthly ranking pages: hub, month page metadata/body/JSON-LD, unknown month 404.
 {const monthD={month:'2026-10',total:12,authorCount:3,topAuthors:[{key:'fixture',name:'投稿者A',count:8},{key:'b',name:'B',count:4}],tags:[{id:'a',name:'ラベルA',count:5},{id:'z',name:'非公開タグ',count:2}],byViews:true,measured:12,viewsTotal:7800,ranked:[video],prev:null,next:'2026-11',index:true};
  bridge.readPublicMonth=async m=>m==='2026-10'?monthD:null;bridge.readPublicMonths=async()=>[{month:'2026-11',count:11},{month:'2026-10',count:12}];
  const hub=load('app/months/page.tsx',resolve),hubM=await hub.generateMetadata();assert.equal(hubM.alternates.canonical,'/months');assert.equal(hubM.robots.index,true);
  const hubH=renderToStaticMarkup(await hub.default());assert(hubH.includes('href="/months/2026-10"')&&hubH.includes('2026年10月')&&hubH.includes('12件'));
  const mp=load('app/months/[month]/page.tsx',resolve),mm=await mp.generateMetadata({params:Promise.resolve({month:'2026-10'})});
  assert.equal(mm.robots.index,true);assert(mm.title.absolute.includes('2026年10月のTwitter動画人気ランキング'));assert.equal(mm.alternates.canonical,core.PUBLIC_SITE+'/months/2026-10');
  const mh=await renderPage(await mp.default({params:Promise.resolve({month:'2026-10'})}));
  assert(mh.includes('<h1>2026年10月のTwitter動画人気ランキング</h1>')&&mh.includes('7,800回')&&mh.includes('650回')&&mh.includes('href="/months/2026-11"')&&mh.includes('/p/'+video.id)&&mh.includes('application/ld+json'));
  assert(mh.includes('ラベルA 5件')&&!mh.includes('非公開タグ'),'only indexable tags are linked');
  await assert.rejects(()=>mp.default({params:Promise.resolve({month:'2020-01'})}));
  assert.deepEqual(await mp.generateMetadata({params:Promise.resolve({month:'2020-01'})}),{});
  const sm=await load('app/sitemap.ts',resolve).default();assert(sm.some(r=>r.url===core.PUBLIC_SITE+'/months')&&sm.some(r=>r.url===core.PUBLIC_SITE+'/months/2026-10'));}
 // Popular-video ranking hubs (30 days / all time): metadata, body, JSON-LD, sitemap, unknown range 404.
 {const pd=range=>({range,total:40,authorCount:6,measured:38,viewsTotal:380000,average:10000,median:7000,ranked:[video,{...video,id:'1850123456789012399'}],topAuthors:[{key:'fixture',name:'投稿者A',count:9,views:90000},{key:'b',name:'B',count:4,views:40000}],months:range==='all'?[{month:'2026-11',count:11,views:111000},{month:'2026-10',count:12,views:120000}]:[],firstAt:'2026-10-02T00:00:00Z',latestAt:'2026-11-10T00:00:00Z',index:true,modifiedAt:'2026-11-10T00:00:00Z'});
  bridge.readPublicPopular=async r=>r==='30days'||r==='all'?pd(r):null;
  for(const [r,h1,tabLabel] of [['30days','直近30日のTwitter動画人気ランキング','30日'],['all','全期間のTwitter動画人気ランキング','全期間']]){
   const pg=load('app/ranking/'+r+'/page.tsx',resolve),meta=await pg.generateMetadata();
   assert(meta.title.absolute.includes(h1)&&meta.title.absolute.includes('Xの表示回数順'));assert.equal(meta.alternates.canonical,core.PUBLIC_SITE+'/ranking/'+r);assert.equal(meta.robots.index,true);
   const html=await renderPage(await pg.default());
   assert(html.includes('<h1>'+h1+'</h1>')&&html.includes('380,000回')&&html.includes('10,000回')&&html.includes('7,000回')&&html.includes('/p/'+video.id)&&html.includes('1位')&&html.includes('2位')&&html.includes('application/ld+json'),r+' body');
   assert(html.includes('合計90,000回')&&html.includes('href="/accounts/fixture"'),r+' top authors by views');
   assert(html.includes('aria-current="page"')&&html.includes('>'+tabLabel+'<'),r+' ranking switcher');
   assert.equal(html.includes('href="/months/2026-10"'),r==='all',r+' month breakdown only on the all-time page');}
  const sm2=await load('app/sitemap.ts',resolve).default();assert(sm2.some(x=>x.url===core.PUBLIC_SITE+'/ranking/30days')&&sm2.some(x=>x.url===core.PUBLIC_SITE+'/ranking/all'),'sitemap lists both hubs');
  bridge.readPublicPopular=async()=>({...pd('all'),index:false});const smThin=await load('app/sitemap.ts',resolve).default();assert(!smThin.some(x=>x.url.includes('/ranking/all')),'thin hub is not in the sitemap');
  bridge.readPublicPopular=async()=>null;}
 // Ranking archive: hub and one recorded day (original ranks, data block, prev/next, JSON-LD, noindex for an unfinished day, 404 for unknown days).
 {const rd={day:'2026-11-12',recorded:12,entries:[{rank:1,video},{rank:3,video:{...video,id:'1850123456789012398'}}],authorCount:1,measured:2,viewsTotal:24000,topAuthors:[{key:'fixture',name:'投稿者A',count:2,best:1}],newEntries:4,prev:'2026-11-11',next:'2026-11-13',index:true};
  bridge.readPublicRankDays=async()=>[{day:'2026-11-13',count:12},{day:'2026-11-12',count:12}];bridge.readPublicRankDay=async d=>d==='2026-11-12'?rd:d==='2026-11-13'?{...rd,day:'2026-11-13',index:false,next:null}:null;
  const hub=load('app/ranking/history/page.tsx',resolve),hm=await hub.generateMetadata();assert.equal(hm.alternates.canonical,'/ranking/history');assert.equal(hm.robots.index,true);
  const hh=await renderPage(await hub.default());assert(hh.includes('href="/ranking/history/2026-11-12"')&&hh.includes('2026年11月12日のランキング')&&hh.includes('<h2>2026年11月</h2>'));
  const dp=load('app/ranking/history/[date]/page.tsx',resolve),dm=await dp.generateMetadata({params:Promise.resolve({date:'2026-11-12'})});
  assert(dm.title.absolute.includes('2026年11月12日のTwitter動画24時間ランキング'));assert.equal(dm.alternates.canonical,core.PUBLIC_SITE+'/ranking/history/2026-11-12');assert.equal(dm.robots.index,true);
  assert.equal((await dp.generateMetadata({params:Promise.resolve({date:'2026-11-13'})})).robots.index,false);
  const dh=await renderPage(await dp.default({params:Promise.resolve({date:'2026-11-12'})}));
  assert(dh.includes('<h1>2026年11月12日のTwitter動画24時間ランキング</h1>')&&dh.includes('1位')&&dh.includes('3位')&&!dh.includes('2位')&&dh.includes('24,000回')&&dh.includes('2本・最高1位')&&dh.includes('href="/ranking/history/2026-11-11"')&&dh.includes('href="/ranking/history/2026-11-13"')&&dh.includes('見られなくなった動画10件')&&dh.includes('application/ld+json'),'archive day body');
  await assert.rejects(()=>dp.default({params:Promise.resolve({date:'2020-01-01'})}));
  const sm3=await load('app/sitemap.ts',resolve).default();assert(sm3.some(x=>x.url===core.PUBLIC_SITE+'/ranking/history/2026-11-12')&&sm3.some(x=>x.url===core.PUBLIC_SITE+'/ranking/history'),'finished days are in the sitemap');
  bridge.readPublicRankDays=async()=>[];}
 const tagPage=load('app/tags/[name]/page.tsx',resolve);
 for(const label of ['オナニー','個人撮影']){
  tagName=label;
  for(const name of [label,encodeURIComponent(label),encodeURIComponent(label).toLowerCase()]){
   const props={params:Promise.resolve({name})};
   assert.equal((await tagPage.generateMetadata(props)).alternates.canonical,core.PUBLIC_SITE+'/tags/'+encodeURIComponent(label));
   assert(renderToStaticMarkup(await tagPage.default(props)).includes('/p/'+video.id));
  }
  await assert.rejects(tagPage.default({params:Promise.resolve({name:'different'})}),/REDIRECT/);
 }
 const ranking=fs.readFileSync(path.join(root,'app/components/RankingClient.tsx'),'utf8');assert(ranking.includes('<RankingCardOpen post={p}')); assert(html.includes('class="public-post-close"'));assert(html.includes('aria-label="動画を閉じて元の一覧へ戻る"'));assert(html.includes('/p/1850123456789012346'));
 console.log('PASS PUBLIC PAGES: real async page rendering/metadata, encoded Japanese tag routes without self-redirect, unique title and self canonical, save first, original/author/same-author/label-related links, escaped body, absent metrics hidden, noindex thin/no-history, invalid404, conservative sitemap and noindex author/tag navigation; no network/effects.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});



