'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}

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
let record={...core.blankRecord(video.id),firstRankedAt:'2026-10-18T00:00:00Z'},reads=0,missing=false,tagName='ラベルA';
const Link=({children,href,prefetch,...props})=>React.createElement('a',{href,...props},children);
const bridge={readPublicDetail:async()=>{reads++;return missing?null:{video,metadata:core.videoMetadata(video,record),labels:[{id:'a',name:'ラベルA',active:true}],sameAuthor:[{...video,id:'1850123456789012346'}],related:[{...video,id:'1850123456789012347'}]};},readPublicIndex:async()=>({posts:[{id:video.id,modifiedAt:record.firstRankedAt}],accounts:[{key:'fixture'}],tags:[{id:'a',name:'ラベルA',count:3,index:true}]}),readPublicAccount:async()=>({name:video.authorName,key:'fixture',canonicalKey:'fixture',index:true,videos:[video,{...video,id:'1850123456789012346'}]}),readPublicTag:async()=>({label:{name:tagName,id:'a',active:true},videos:[video],index:false}),readPublicLabels:async()=>[{id:'a',name:'ラベルA',count:3,index:true},{id:'b',name:'ラベルB',count:2,index:true}]};
const cards=load('app/components/PublicVideoCards.tsx',resolve).default;
function resolve(n){if(n.endsWith('PublicPostEngagement'))return props=>React.createElement('span',{'data-tracked-post':props.postId,'data-source-page':props.sourcePage??'direct'});if(n.endsWith('StructuredData'))return props=>React.createElement('script',{type:'application/ld+json',dangerouslySetInnerHTML:{__html:JSON.stringify(props.data)}});if(/(?:PublicPostLink|PublicListRestore|PublicPostClose)$/.test(n))return mobileComponent(n.split('/').at(-1));if(n.endsWith('public-return-navigation'))return load('lib/public-return-navigation.ts');if(n.endsWith('ranking-pagination'))return load('lib/ranking-pagination.ts');if(n.endsWith('public-list-pages'))return load('lib/public-list-pages.ts');if(n.endsWith('indexability'))return load('lib/indexability.ts');if(n==='react/jsx-runtime')return require('react/jsx-runtime');if(n==='next/link')return Link;if(n==='next/navigation')return{notFound(){throw Error('NOT_FOUND');},permanentRedirect(){throw Error('REDIRECT');}};if(n.endsWith('public-video-core'))return core;if(n.endsWith('public-video-server'))return bridge;if(n.endsWith('/seo'))return{SITE_URL:core.PUBLIC_SITE,SITE_NAME:'twizou'};if(n.endsWith('PublicVideoCards'))return cards;if(n.endsWith('DirectPlaybackVideo'))return ({postId,...props})=>React.createElement('video',props);if(n.endsWith('VideoDownloadButton'))return props=>React.createElement('button',{'data-post':props.postId},'動画を保存');throw Error('UNEXPECTED_IMPORT '+n);}
async function main(){
 const p=load('app/p/[id]/page.tsx',resolve),props={params:Promise.resolve({id:video.id})};let m=await p.generateMetadata(props);assert.equal(m.robots.index,true);assert.equal(m.alternates.canonical,core.PUBLIC_SITE+'/p/'+video.id);assert(m.title.absolute.includes('投稿者A')&&m.title.absolute.includes('本文です')&&m.title.absolute.includes('twizou'));
 const html=renderToStaticMarkup(await p.default(props));for(const value of ['動画を保存','https://x.com/i/status/'+video.id,'/accounts/fixture','同じ投稿者の他動画','関連動画','この動画に付けられたタグ','class="public-post-player"','/p/1850123456789012346','/p/1850123456789012347','/tags/'+encodeURIComponent('ラベルA'),'/tags/'+encodeURIComponent('ラベルB')])assert(html.includes(value),value);assert(html.includes('data-tracked-post="'+video.id+'"'));assert(html.includes('data-source-page="direct"'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>alert'));assert(!html.includes('自動推定のラベルです。'));assert(!html.includes('初回保存'));assert(!html.includes('保存数（'));assert(!html.includes('このサイト経由の保存操作は、現在記録されていません。'));video.views=123;video.likes=4;video.bookmarks=2;const metrics=renderToStaticMarkup(await p.default(props));assert(metrics.includes('X側の観測値'));assert(metrics.includes('表示 123回'));assert(metrics.includes('ブックマーク 2件'));assert(metrics.includes('サイト経由の保存操作とは別'));delete video.views;delete video.likes;delete video.bookmarks;
 record={...record,saves:2,firstSavedAt:'2026-10-18T01:02:03Z'};const saved=renderToStaticMarkup(await p.default(props));assert(saved.includes('初回保存'));assert(saved.includes('2026-10-18T01:02:03Z'));assert(saved.includes('2件'));
 record=core.blankRecord(video.id);assert.equal((await p.generateMetadata(props)).robots.index,true);video.text='';record.firstRankedAt='2026-10-18T00:00:00Z';assert.equal((await p.generateMetadata(props)).robots.index,false);
 const summary=renderToStaticMarkup(await p.default(props));assert(summary.includes('この動画のタグはラベルAです。'));assert(!summary.includes('この投稿の本文は登録されていません。'));
 video.createdAt='2026-10-05T00:00:00Z';const labelled=core.videoMetadata(video,record,[{id:'a',name:'ラベルA',active:true}]);assert(labelled.title.includes('ラベルA'));assert(labelled.description.includes('ラベルA'));assert(labelled.description.includes('2026'));video.createdAt=null;
 video.posterUrl='https://pbs.twimg.com/a.jpg';const cardHtml=renderToStaticMarkup(React.createElement(cards,{videos:[video]}));assert(cardHtml.includes('width="392" height="220"'));video.posterUrl=null;
 missing=true;await assert.rejects(p.default(props),/NOT_FOUND/);assert.deepEqual(await p.generateMetadata(props),{});const before=reads;await assert.rejects(p.default({params:Promise.resolve({id:'../invalid'})}),/NOT_FOUND/);assert.equal(reads,before);
 const sitemap=await load('app/sitemap.ts',resolve).default();assert(sitemap.some(r=>r.url===core.PUBLIC_SITE+'/p/'+video.id));assert.equal(sitemap.length,10);
 for(const [file,params]of [['app/accounts/[key]/page.tsx',{key:'fixture'}],['app/tags/[name]/page.tsx',{name:'ラベルA'}]]){const page=load(file,resolve),meta=await page.generateMetadata({params:Promise.resolve(params)});assert.equal(meta.robots.index,file.includes('/accounts/'));assert(meta.alternates.canonical.startsWith(core.PUBLIC_SITE));const pageHtml=renderToStaticMarkup(await page.default({params:Promise.resolve(params)}));assert(pageHtml.includes('/p/'+video.id));if(file.includes('/tags/'))assert(pageHtml.includes('from=%2Ftags%2F'));}
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
 const ranking=fs.readFileSync(path.join(root,'app/components/RankingClient.tsx'),'utf8');assert(ranking.includes('<RankingCardOpen post={p}')); assert(html.includes('class="public-post-close"'));assert(html.includes('aria-label="動画を閉じて元の一覧へ戻る"'));assert(html.includes('/p/1850123456789012346?from='));
 console.log('PASS PUBLIC PAGES: real async page rendering/metadata, encoded Japanese tag routes without self-redirect, unique title and self canonical, save first, original/author/same-author/label-related links, escaped body, absent metrics hidden, noindex thin/no-history, invalid404, conservative sitemap and noindex author/tag navigation; no network/effects.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});



