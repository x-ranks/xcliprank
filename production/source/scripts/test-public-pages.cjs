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

const core=load('lib/public-video-core.ts'),video={id:'1850123456789012345',authorId:'111',handle:'fixture',authorName:'投稿者A',text:'本文です <script>alert(1)</script>',posterUrl:null,videoUrl:'https://video.twimg.com/fixture.mp4',createdAt:null,sourceHash:'a'.repeat(64),eligible:true};
let record={...core.blankRecord(video.id),firstRankedAt:'2026-10-18T00:00:00Z'},reads=0,missing=false;
const Link=({children,href,prefetch,...props})=>React.createElement('a',{href,...props},children);
const bridge={readPublicDetail:async()=>{reads++;return missing?null:{video,metadata:core.videoMetadata(video,record),labels:[{id:'a',name:'ラベルA',active:true}],sameAuthor:[{...video,id:'1850123456789012346'}],related:[{...video,id:'1850123456789012347'}]};},readPublicIndex:async()=>[{id:video.id,modifiedAt:record.firstRankedAt}],readPublicAccount:async()=>({name:video.authorName,key:'fixture',videos:[video]}),readPublicTag:async()=>({label:{name:'ラベルA'},videos:[video]})};
const cards=load('app/components/PublicVideoCards.tsx',resolve).default;
function resolve(n){if(/(?:PublicPostLink|PublicListRestore|PublicPostClose)$/.test(n))return mobileComponent(n.split('/').at(-1));if(n.endsWith('public-return-navigation'))return load('lib/public-return-navigation.ts');if(n.endsWith('ranking-pagination'))return load('lib/ranking-pagination.ts');if(n==='react/jsx-runtime')return require('react/jsx-runtime');if(n==='next/link')return Link;if(n==='next/navigation')return{notFound(){throw Error('NOT_FOUND');}};if(n.endsWith('public-video-core'))return core;if(n.endsWith('public-video-server'))return bridge;if(n.endsWith('/seo'))return{SITE_URL:core.PUBLIC_SITE};if(n.endsWith('PublicVideoCards'))return cards;if(n.endsWith('DirectPlaybackVideo'))return props=>React.createElement('video',props);if(n.endsWith('VideoDownloadButton'))return props=>React.createElement('button',{'data-post':props.postId},'動画を保存');throw Error('UNEXPECTED_IMPORT '+n);}
async function main(){
 const p=load('app/p/[id]/page.tsx',resolve),props={params:Promise.resolve({id:video.id})};let m=await p.generateMetadata(props);assert.equal(m.robots.index,true);assert.equal(m.alternates.canonical,core.PUBLIC_SITE+'/p/'+video.id);assert(m.title.absolute.includes('投稿者A')&&m.title.absolute.includes('本文です')&&m.title.absolute.includes('動画を保存'));
 const html=renderToStaticMarkup(await p.default(props));for(const value of ['動画を保存','https://x.com/i/status/'+video.id,'/accounts/fixture','同じ投稿者の他動画','関連動画','/p/1850123456789012346','/p/1850123456789012347','/tags/'+encodeURIComponent('ラベルA')])assert(html.includes(value),value);assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>alert'));assert(!html.includes('初回保存'));assert(!html.includes('保存数（'));
 record={...record,saves:2,firstSavedAt:'2026-10-18T01:02:03Z'};const saved=renderToStaticMarkup(await p.default(props));assert(saved.includes('初回保存'));assert(saved.includes('2026-10-18T01:02:03Z'));assert(saved.includes('2件'));
 record=core.blankRecord(video.id);assert.equal((await p.generateMetadata(props)).robots.index,false);video.text='';record.firstRankedAt='2026-10-18T00:00:00Z';assert.equal((await p.generateMetadata(props)).robots.index,false);
 missing=true;await assert.rejects(p.default(props),/NOT_FOUND/);assert.equal((await p.generateMetadata(props)).robots.index,false);const before=reads;await assert.rejects(p.default({params:Promise.resolve({id:'../invalid'})}),/NOT_FOUND/);assert.equal(reads,before);
 const sitemap=await load('app/sitemap.ts',resolve).default();assert(sitemap.some(r=>r.url===core.PUBLIC_SITE+'/p/'+video.id));assert.equal(sitemap.length,5);
 for(const [file,params]of [['app/accounts/[key]/page.tsx',{key:'fixture'}],['app/tags/[name]/page.tsx',{name:'ラベルA'}]]){const page=load(file,resolve),meta=await page.generateMetadata({params:Promise.resolve(params)});assert.equal(meta.robots.index,false);assert(meta.alternates.canonical.startsWith(core.PUBLIC_SITE));assert(renderToStaticMarkup(await page.default({params:Promise.resolve(params)})).includes('/p/'+video.id));}
 const ranking=fs.readFileSync(path.join(root,'app/components/RankingClient.tsx'),'utf8');assert(ranking.includes('<PublicPostLink id={p.x_post_id}'));assert(html.includes('class="public-post-close"'));assert(html.includes('aria-label="動画を閉じて元の一覧へ戻る"'));assert(html.includes('/p/1850123456789012346?from='));assert(!ranking.includes('onClick={() => setSelectedPost(p)}'));
 console.log('PASS PUBLIC PAGES: real async page rendering/metadata, unique title and self canonical, save first, original/author/same-author/label-related links, escaped body, absent metrics hidden, noindex thin/no-history, invalid404, conservative sitemap and noindex author/tag navigation; no network/effects.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
