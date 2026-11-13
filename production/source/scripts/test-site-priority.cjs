'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
const {PassThrough}=require('node:stream'),{renderToPipeableStream}=require('react-dom/server');
function renderPage(tree){return new Promise((resolve,reject)=>{const out=new PassThrough();let html='';out.on('data',chunk=>html+=chunk);out.on('end',()=>resolve(html));const stream=renderToPipeableStream(tree,{onAllReady(){stream.pipe(out);},onError:reject});});}
function load(file,resolve=require){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(resolve,m,m.exports);return m.exports;}
const core=load('lib/public-video-core.ts',n=>n.endsWith('indexability')?load('lib/indexability.ts'):require(n)),nav=load('lib/public-return-navigation.ts');
const id='2061469959365280142',poster='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="392" height="220"><rect width="392" height="220" fill="#213345"/><circle cx="196" cy="110" r="32" fill="#6e8fa4"/><path d="M188 92l25 18-25 18z" fill="white"/></svg>');
const video={id,authorId:'123',handle:'sample_author',authorName:'サンプル投稿者',text:'公開投稿のサンプルです。 #タグA ＃タグB #未登録',posterUrl:poster,videoUrl:'https://video.twimg.com/fixture.mp4',createdAt:'2026-10-20T12:00:00Z',sourceHash:'a'.repeat(64),eligible:true};
let labels=[{id:'a',name:'タグA',count:4,index:true},{id:'b',name:'タグB',count:3,index:true},{id:'empty',name:'空タグ',count:0,index:false}];
const index={posts:[{id,modifiedAt:'2026-10-20T12:00:00Z'}],accounts:[{key:'sample_author',modifiedAt:'2026-10-20T12:00:00Z'}],tags:labels};
const Link=({children,href,prefetch,...props})=>React.createElement('a',{href,...props},children);
const bridge={readPublicMonths:async()=>[],readPublicIndex:async()=>index,readPublicBrowse:async page=>page===1||page===2?{page,totalCount:101,totalPages:2,videos:[video]}:null,readPublicLabels:async()=>labels,
 readPublicTag:async()=>({label:{id:'a',name:'タグA',active:true},videos:[video],index:true,totalCount:4,totalPages:1,facts:{authorCount:1,tags:[{id:"b",name:"タグB",count:1}]}}),
 readPublicDetail:async()=>({video,metadata:core.videoMetadata(video,null,labels.filter(l=>l.count>0)),labels:labels.filter(l=>l.count>0),sameAuthor:[],related:[],recommended:[]})};
function resolve(n){if(n==='react')return React;if(n.endsWith('public-video-schema'))return load('lib/public-video-schema.ts',resolve);if(n.endsWith('video-technical'))return load('lib/video-technical.ts',resolve);if(n.endsWith('video-duration-format'))return load('lib/video-duration-format.ts',resolve);
 if(n==='react'||n==='react/jsx-runtime')return require(n);if(n==='next/link')return Link;
 if(n==='next/navigation')return{notFound(){throw Error('NOT_FOUND');},permanentRedirect(){throw Error('REDIRECT');},useRouter:()=>({replace(){}})};
 if(n.endsWith('public-video-server'))return {...bridge,readPublicDetailCore:bridge.readPublicDetail,readPublicRelated:bridge.readPublicDetail};
 if(n.endsWith('initial-ranking'))throw Error('SITEMAP_MUST_NOT_LOAD_RANKING');
 if(n.endsWith('public-video-core'))return core;if(n.endsWith('public-return-navigation'))return nav;
 if(n.endsWith('public-list-pages'))return load('lib/public-list-pages.ts');if(n.endsWith('ranking-pagination'))return load('lib/ranking-pagination.ts');if(n.endsWith('indexability'))return load('lib/indexability.ts');
 if(n.endsWith('/seo'))return{SITE_URL:core.PUBLIC_SITE,SITE_NAME:'twizou'};
 if(n.endsWith('share-video'))return load('lib/share-video.ts',resolve);
 if(/(?:DirectPlaybackVideo|VideoDownloadButton|PublicPostEngagement|PublicPostClose)$/.test(n))return ()=>null;
 if(/(?:PostActionBar|PublicPostText|PublicVideoCards|PublicPostLink|PublicListRestore|SiteBrand|StructuredData)$/.test(n))return load('app/components/'+n.split('/').at(-1)+'.tsx',resolve).default;
 throw Error('UNEXPECTED_IMPORT '+n);
}
async function main(){
 const text=load('app/components/PublicPostText.tsx',resolve).default;
 const tagLinks=[{name:'タグA',href:'/tags/'+encodeURIComponent('タグA')},{name:'タグB',href:'/tags/'+encodeURIComponent('タグB')},{name:'悪い',href:'javascript:alert(1)'}];
 const textHtml=renderToStaticMarkup(React.createElement(text,{tags:tagLinks,text:'本文 #タグA ＃タグB #未登録 https://example.invalid/#タグA #悪い <script>alert(1)</script>'}));
 assert.equal((textHtml.match(/<a /g)||[]).length,2);assert(textHtml.includes('#未登録'));assert(textHtml.includes('https://example.invalid/#タグA'));assert(textHtml.includes('&lt;script&gt;'));assert(!textHtml.includes('href="javascript:'));
 assert.equal((renderToStaticMarkup(React.createElement(text,{tags:[{name:'a'.repeat(40),href:'/tags/a'}],text:'#'+'a'.repeat(41)})).match(/<a /g)||[]).length,0);
 // Actual browse batch reader: index order, 100-item cap, current exclusions and no N+1.
 const ids=Array.from({length:230},(_,i)=>String(10000+i)),calls=[];
 const serviceModule=load('lib/public-video-service.ts',n=>n.endsWith('video-technical')?load('lib/video-technical.ts'):n.endsWith('public-video-core')?core:n.endsWith('public-save-receipt')?{verifySaveReceipt:()=>null}:n.endsWith('indexability')?load('lib/indexability.ts'):n.endsWith('tag-aliases')?load('lib/tag-aliases.ts'):require(n));
 const service=serviceModule.createPublicVideoService({catalog:{read:async()=>core.blankCatalog()},indexVideos:async()=>ids.map(id=>({...video,id})),posts:async selected=>{calls.push(selected);return [...selected].reverse().map((id,i)=>({...video,id,eligible:i!==0})).concat({...video,id:'99999'});},authorVideos:async()=>[],candidates:async()=>[],secret:async()=>'fixture'});
 const ordered=[...ids].sort((a,b)=>b.localeCompare(a));
 const result=await service.browse(2);assert.equal(calls.length,1);assert.equal(calls[0].length,100);assert.equal(result.totalPages,3);assert.equal(result.videos.length,99);assert.equal(result.videos[0].id,ordered[100]);assert(!result.videos.some(v=>v.id==='99999'||v.id===ordered[199]));assert.equal(await service.browse(4),null);assert.equal(calls.length,1);assert.equal(await service.browse(0),null);
 if(fs.readFileSync(path.join(root,'lib/public-video-server.ts'),'utf8').includes('Local-management bridge')){
   const beforeFetch=global.fetch,requests=[];global.fetch=async url=>{requests.push(String(url));assert.equal(new URL(url).origin,core.PUBLIC_SITE);assert.equal(new URL(url).searchParams.get('type'),'browse');assert.equal(new URL(url).searchParams.get('page'),'2');return Response.json({ok:true,data:result});};
   try{const server=load('lib/public-video-server.ts',n=>n==='react'?{cache:fn=>fn}:require(n));assert.equal((await server.readPublicBrowse(2)).videos.length,99);assert.equal(await server.readPublicBrowse(0),null);assert.equal(requests.length,1);}finally{global.fetch=beforeFetch;}
 }else{
   const server=load('lib/public-video-server.ts',n=>n==='react'?{cache:fn=>fn}:n.endsWith('public-video-production')?{productionPublicBackend:()=>({service})}:require(n));assert.equal((await server.readPublicBrowse(2)).videos.length,99);
   const api=load('app/api/public-video/route.ts',n=>n.endsWith('public-video-production')?{productionPublicBackend:()=>({service})}:n.endsWith('manual-ranking/route')?{GET:async()=>Response.json({}, {status:401})}:n.endsWith('manual-ranking')?{}:n.endsWith('manual-thumbnail-store')?{}:require(n));
   const response=await api.GET(new Request(core.PUBLIC_SITE+'/api/public-video?type=browse&page=2'));assert.equal(response.status,200);assert.equal((await response.json()).data.videos.length,99);assert.equal((await api.GET(new Request(core.PUBLIC_SITE+'/api/public-video?type=browse&page=0'))).status,400);
 }
 const browse=load('app/browse/page.tsx',resolve),browseHtml=renderToStaticMarkup(await browse.default({searchParams:Promise.resolve({page:'2'})}));
 assert(browseHtml.includes('サンプル投稿者'));assert(browseHtml.includes('公開投稿のサンプル'));assert(browseHtml.includes('width="392" height="220"'));assert(!browseHtml.includes('>動画 '+id+'<'));assert(browseHtml.includes('href="/p/'+id+'"'));assert(!/href="\/p\/[^" ]+\?from=/.test(browseHtml));assert.equal(nav.safePublicReturn('/browse?page=2'),'/browse?page=2');assert.equal(nav.safePublicReturn('/browse?page=0'),null);
 const bm=await browse.generateMetadata({searchParams:Promise.resolve({page:'2'})});assert.equal(bm.alternates.canonical,core.PUBLIC_SITE+'/browse?page=2');assert.equal(bm.robots['max-image-preview'],'large');await assert.rejects(browse.default({searchParams:Promise.resolve({page:'3'})}),/NOT_FOUND/);
 const sitemap=load('app/sitemap.ts',resolve);const urls=await sitemap.default();
 assert(urls.some(v=>v.url===core.PUBLIC_SITE));
 assert(!urls.some(v=>v.url.startsWith(core.PUBLIC_SITE+'/?page=')));
 assert(!urls.some(v=>v.url.includes('edition=')||v.url.includes('from=')));
 assert(!urls.some(v=>v.url.includes(encodeURIComponent('空タグ'))));
 assert.equal(urls.find(v=>v.url.endsWith('/p/'+id)).lastModified,'2026-10-20T12:00:00.000Z');
 assert.equal(urls.find(v=>v.url.endsWith('/accounts/sample_author')).lastModified,'2026-10-20T12:00:00.000Z');
 assert.equal(urls.find(v=>v.url===core.PUBLIC_SITE+'/rising').lastModified,undefined);
 assert.equal(urls.find(v=>v.url===core.PUBLIC_SITE+'/browse').lastModified,'2026-10-20T12:00:00.000Z','list page = newest entry it shows');
 assert.equal(urls.find(v=>v.url===core.PUBLIC_SITE+'/accounts').lastModified,'2026-10-20T12:00:00.000Z');
 assert.equal(urls.find(v=>v.url===core.PUBLIC_SITE+'/ranking/daily').lastModified,undefined,'ranking pages change constantly: no lastmod');
 const tags=load('app/tags/page.tsx',resolve),tagsHtml=renderToStaticMarkup(await tags.default());assert(!tagsHtml.includes('空タグ'));assert(tagsHtml.includes('タグA'));
 const storedLabels=labels;labels=labels.map(l=>({...l,count:0,index:false}));assert.equal((await tags.generateMetadata()).robots.index,false);assert(renderToStaticMarkup(await tags.default()).includes('現在表示できるタグはありません。'));labels=storedLabels;
 const tag=load('app/tags/[name]/page.tsx',resolve),tagHtml=renderToStaticMarkup(await tag.default({params:Promise.resolve({name:'タグA'})}));assert(tagHtml.includes('タグの掲載動画'));assert(tagHtml.includes('再生・保存'));assert(tagHtml.includes('aria-label="一緒に付けられているタグ"'));assert(tagHtml.includes('/tags/'+encodeURIComponent('タグB')));assert(!tagHtml.includes('空タグ'));
 const post=load('app/p/[id]/page.tsx',resolve),postHtml=await renderPage(await post.default({params:Promise.resolve({id}),searchParams:Promise.resolve({from:'/browse?page=2'})}));
 const schemas=[...postHtml.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m=>JSON.parse(m[1]));const crumbs=schemas.find(s=>s['@type']==='BreadcrumbList');assert.equal(crumbs.itemListElement.length,3);assert.equal(crumbs.itemListElement[0].item,core.PUBLIC_SITE+'/rising');assert.equal(crumbs.itemListElement[1].item,core.PUBLIC_SITE+'/accounts/sample_author');assert.equal(crumbs.itemListElement[2].item,core.PUBLIC_SITE+'/p/'+id);
 assert.equal(schemas.filter(s=>s['@type']==='VideoObject').length,1);assert.equal(schemas.find(s=>s['@type']==='VideoObject').contentUrl,video.videoUrl);const pm=await post.generateMetadata({params:Promise.resolve({id})});assert.equal(pm.openGraph.images[0],poster);assert.equal(pm.robots['max-image-preview'],'large');assert(postHtml.includes('/tags/'+encodeURIComponent('タグA')));assert(postHtml.includes('この動画を報告する'));
 if(process.argv[2]==='--preview'){
  const dest=path.resolve(process.argv[3]);fs.mkdirSync(dest,{recursive:true});
  const css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');
  const html='<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>twizou 更新内容の確認用プレビュー</title><style>'+css+'\n.preview-note{padding:20px;max-width:1120px;margin:auto;border-bottom:1px solid #456}.demo a{pointer-events:none}.demo{border-bottom:3px solid #456;margin-bottom:36px}</style><body><div class="preview-note"><h1 style="font-size:28px">更新内容の確認用プレビュー</h1><p>架空のデータを使った実コンポーネントの表示見本です。リンク操作は無効です。年齢確認は実サイトで維持します。</p><p>変更：動画一覧のカード化／タグ一覧の0件非表示／タグページの案内・関連タグ／動画詳細のパンくずと既存タグへのリンク。タイトル・サイトマップ・メタ設定は変更一覧.mdをご覧ください。</p></div>'+[['動画一覧（2ページ目）',browseHtml],['タグ一覧',tagsHtml],['タグページ',tagHtml],['動画詳細',postHtml]].map(([name,body])=>'<section class="demo"><h2 class="preview-note">'+name+'</h2>'+body+'</section>').join('')+'</body></html>';
  fs.writeFileSync(path.join(dest,'preview.html'),html.replaceAll('src="/twizou-mark.svg"','src="twizou-mark.svg"'));fs.copyFileSync(path.join(root,'public/twizou-mark.svg'),path.join(dest,'twizou-mark.svg'));
 }
 console.log('PASS SITE PRIORITY: real SSR browse/cards/tag hubs/tag descriptions/post hashtag links and breadcrumb JSON; batch reads/exclusions/order; sitemap independent of ranking hydration; preview limits/canonical/OGP/report/direct video preserved. Fixture only, no network.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
