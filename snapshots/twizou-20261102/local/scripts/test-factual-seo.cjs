'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup,renderToPipeableStream}=require('react-dom/server'),{PassThrough}=require('stream');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file,resolve){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(resolve??(n=>n.startsWith('.')?local(path.posix.normalize(path.posix.join(path.posix.dirname(file),n))+'.ts'):require(n)),m,m.exports);return m.exports;}
function local(file){if(!cache.has(file))cache.set(file,load(file));return cache.get(file);}
const core=local('lib/public-video-core.ts'),{shareVideoHref}=local('lib/share-video.ts'),{createPublicVideoService}=local('lib/public-video-service.ts');
const base={id:'2061469959365280142',authorId:'11',handle:'fixture',authorName:'投稿者A',text:'',posterUrl:'https://pbs.twimg.com/fixture.jpg',videoUrl:'https://video.twimg.com/fixture.mp4',createdAt:'2026-10-26T16:00:00Z',sourceHash:'a'.repeat(64),eligible:true};
const label={id:'a',name:'タグA',active:true},co={id:'b',name:'タグB',active:true},stale={id:'c',name:'古いタグ',active:true};
const Link=({href,prefetch,children,...props})=>React.createElement('a',{href,...props},children);
async function render(tree){return new Promise((resolve,reject)=>{const out=new PassThrough();let html='';out.on('data',b=>html+=b);out.on('end',()=>resolve(html));const stream=renderToPipeableStream(tree,{onAllReady(){stream.pipe(out)},onError:reject});});}
async function main(){
 const facts=core.publicVideoFacts({...base,views:0,likes:12,bookmarks:null},{durationSeconds:138,width:720,height:1280});
 assert.deepEqual(facts.map(f=>f.label),['投稿日','再生時間','サイズ','X表示','Xいいね']);assert(facts.some(f=>f.value==='2:18'));assert(facts.some(f=>f.value==='720×1280（縦）'));assert(facts.some(f=>f.value==='0回'));assert.equal(facts[0].value,'2026/10/27');
 assert.deepEqual(core.publicVideoFacts({...base,createdAt:'bad',views:NaN,likes:-1,bookmarks:1.5},{durationSeconds:NaN,width:0,height:1}),[]);
 const url=new URL(shareVideoHref(base.id,null,{author:base.authorName}));assert.equal(url.searchParams.get('url'),'https://twizou.net/p/'+base.id);assert(url.searchParams.get('text').includes('投稿者A'));assert(!url.searchParams.get('text').includes('見つけた'));
 for(const section of ['trending','daily','weekly']){const text=new URL(shareVideoHref(base.id,null,{section,author:'投稿者A',rank:1})).searchParams.get('text');assert(text.includes('掲載中'));assert(!text.includes('1位'));}
 const risingText=new URL(shareVideoHref(base.id,null,{author:'投稿者A',section:'rising',rank:2,updatedAt:'2026-10-27T07:05:00Z'})).searchParams.get('text');assert(risingText.includes('2位'));assert(risingText.includes('16:05'));assert(risingText.includes('集計・日本時間'));
 assert(!new URL(shareVideoHref(base.id,null,{section:'rising',rank:2})).searchParams.get('text').includes('2位'));
 assert.equal(shareVideoHref('../','https://user:pass@x.com/a/status/1'),null);assert.equal(shareVideoHref('../','https://evil.invalid/'),null);
 const catalog=core.blankCatalog();catalog.labels=[label,co,stale,{id:'off',name:'停止タグ',active:false}];
 const rows=Array.from({length:125},(_,i)=>({...base,id:String(1000+i),handle:i%2?'fixture':'other',authorId:i%2?'11':'12',views:i,eligible:i!==4}));
 for(const row of rows)catalog.records[row.id]={...core.blankRecord(row.id),sourceHash:row.sourceHash,labelIds:['a','b','off'],labelPublishedAt:row.createdAt};
 catalog.records[rows[3].id].sourceHash='b'.repeat(64);catalog.records[rows[3].id].labelIds=['a','c'];
 catalog.records[base.id]={...core.blankRecord(base.id),sourceHash:base.sourceHash,labelIds:['a','b'],technical:{durationSeconds:138,width:720,height:1280,sourceHash:base.sourceHash,observedAt:'2026-10-27T00:00:00Z',method:'mp4-range-v1'}};
 let postCalls=[],indexCalls=0;
 const deps={catalog:{read:async()=>catalog},posts:async ids=>{postCalls.push(ids);assert(ids.length<=100);return [base,...rows].filter(v=>ids.includes(v.id));},authorVideos:async()=>rows,indexVideos:async()=>{indexCalls++;throw Error('GLOBAL_INDEX_MUST_NOT_BE_USED_FOR_TAG_FACTS')},candidates:async()=>[],secret:async()=>''};
 const service=createPublicVideoService(deps,{readOnlyRender:true});
 const account=await service.account('fixture');assert(account);assert.equal(account.totalCount,62);assert.equal(account.facts.tags.find(t=>t.name==='タグB').count,61);assert(!account.facts.tags.some(t=>t.name==='古いタグ'||t.name==='停止タグ'));assert.equal(account.handle,'fixture');
 const tag=await service.tag('タグA');assert.equal(tag.totalCount,124);assert.equal(tag.facts.authorCount,2);assert.deepEqual(tag.facts.tags.map(t=>t.name),['タグB']);assert.equal(tag.facts.tags[0].count,124);assert.equal(indexCalls,0);assert(postCalls.every(ids=>ids.length<=100));
 const page2=await service.tag(encodeURIComponent('タグA'),2);assert.equal(page2.totalCount,tag.totalCount);assert.deepEqual(page2.facts,tag.facts);assert.equal(page2.videos.length,24);assert.equal(await service.tag('タグA',3),null);
 const detail=await service.detailCore(base.id);assert.equal(detail.technical.durationSeconds,138);assert(detail.metadata.description.includes('再生時間：2:18'));assert(detail.metadata.title.includes('2026/10/27'));catalog.records[base.id].technical.sourceHash='b'.repeat(64);const changed=await service.detailCore(base.id);assert.equal(changed.technical,null);assert(!changed.metadata.description.includes('再生時間'));catalog.records[base.id].technical.sourceHash=base.sourceHash;
 const bridge={readPublicDetailCore:async()=>detail,readPublicRelated:async()=>({sameAuthor:[],related:[],recommended:[]}),readPublicLabels:async()=>[{...label,count:123,index:true},{...co,count:123,index:true},{...stale,count:0,index:false}],readPublicAccount:async()=>account,readPublicTag:async()=>tag};
 function resolve(n){
  if(n==='react'||n==='react/jsx-runtime')return require(n);if(n==='next/link')return Link;if(n==='next/navigation')return{notFound(){throw Error('NOT_FOUND')},permanentRedirect(){throw Error('REDIRECT')},useRouter:()=>({replace(){}})};
  if(n.endsWith('public-video-server'))return bridge;
  if(n.endsWith('DirectPlaybackVideo'))return ({postId,...props})=>React.createElement('video',props);
  if(n.endsWith('VideoDownloadButton'))return ()=>React.createElement('button',{},'動画を保存');
  if(/(?:PublicPostClose|PublicPostEngagement|PublicListRestore)$/.test(n))return ()=>null;
  if(n.endsWith('PublicPostLink'))return({id,children,ariaLabel,...props})=>React.createElement('a',{href:'/p/'+id,'aria-label':ariaLabel},children);
  if(n.startsWith('.')&&n.includes('/components/'))return load('app/components/'+n.split('/').at(-1)+'.tsx',resolve).default;
  if(n.startsWith('.')&&n.includes('/lib/'))return local('lib/'+n.split('/').at(-1)+'.ts');
  throw Error('UNEXPECTED_FACTUAL_IMPORT '+n);
 }
 const post=load('app/p/[id]/page.tsx',resolve),props={params:Promise.resolve({id:base.id}),searchParams:Promise.resolve({from:'/rising'})};
 const html=await render(await post.default(props)),meta=await post.generateMetadata(props);
 assert.equal(meta.alternates.canonical,'https://twizou.net/p/'+base.id);assert(html.indexOf('<video')<html.indexOf('public-video-facts'));assert(html.includes('2:18'));assert(!html.includes('最高順位'));assert(!html.includes('上位'));assert(!html.includes('この動画のタグは'));assert(html.includes('この動画を報告する'));assert(html.includes('VideoObject'));assert(html.includes('BreadcrumbList'));assert(html.includes('/accounts/fixture'));
 const ap=load('app/accounts/[key]/page.tsx',resolve),tp=load('app/tags/[name]/page.tsx',resolve),aprops={params:Promise.resolve({key:'fixture'}),searchParams:Promise.resolve({page:'2'})},tprops={params:Promise.resolve({name:'タグA'})};
 const am=await ap.generateMetadata(aprops),tm=await tp.generateMetadata(tprops);assert(am.title.absolute.includes('投稿者A(@fixture)'));assert(am.title.absolute.includes('2ページ'));assert(am.description.includes('62件'));assert(tm.description.includes('124件'));assert(tm.description.includes('2投稿者'));assert.equal(tm.robots.index,tag.index);assert.equal(am.robots.index,account.index);
 const ah=renderToStaticMarkup(await ap.default(aprops)),th=renderToStaticMarkup(await tp.default(tprops));assert(ah.includes('よく付くタグ'));assert(ah.includes('タグB'));assert(th.includes('一緒に付けられているタグ'));assert(th.includes('124件'));assert(!th.includes('古いタグ'));
 const preview=process.env.FACTUAL_PREVIEW_DIR;if(preview){fs.mkdirSync(preview,{recursive:true});fs.copyFileSync(path.join(root,'public/twizou-mark.svg'),path.join(preview,'twizou-mark.svg'));const css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');fs.writeFileSync(path.join(preview,'preview.html'),'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>変更内容の見本（架空データ）</title><style>'+css+'</style><body><p>変更内容の見本です。投稿者・数値は架空。動画は取得・再生しません。</p>'+[['動画詳細',html],['投稿者ページ',ah],['タグページ',th]].map(([name,body])=>'<section><h2>'+name+'</h2>'+body.replace(/<video[\s\S]*?<\/video>/g,'<div style="height:220px;background:#1b2d39;display:grid;place-items:center">動画プレーヤー（見本）</div>').replace(/<img[^>]*>/g,'<div style="height:120px;background:#213345">サムネイル（見本）</div>').replaceAll('src="/twizou-mark.svg"','src="twizou-mark.svg"')+'</section>').join('')+'</body></html>');}
 console.log('PASS FACTUAL SEO: valid/missing metrics, JST, source-matched technical data, clean canonical/schema, player first, current permission tag batch counts, stale/inactive tags, consistent pagination, author identity and contextual timestamped sharing. No network/media/writes.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
