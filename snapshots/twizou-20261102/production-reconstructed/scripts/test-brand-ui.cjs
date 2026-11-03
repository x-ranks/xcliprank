'use strict';
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
function load(file){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,mod,mod.exports);return mod.exports;}
const Link=({href,children,prefetch,...props})=>React.createElement('a',{href,...props},children);
function resolve(n){
 if(n==='react/jsx-runtime')return require(n);
 if(n==='next/headers')return {headers:async()=>new Headers()};
 if(n==='next/server')return {after:()=>{}};
 if(n==='next/link')return Link;
 if(n.endsWith('SiteFooter'))return load('app/components/SiteFooter.tsx').default;
 if(n.endsWith('SiteBrand'))return load('app/components/SiteBrand.tsx').default;
 if(n.endsWith('rising-ranking'))return {loadRisingRanking:async()=>({posts:[{x_post_id:'123',author_name:'Sample',video_url:'https://example.invalid/video.mp4',siteOpens:5,siteSaves:2}]})};
 if(n.endsWith('share-video'))return {shareVideoHref:()=> 'https://twitter.com/intent/tweet?url=example'};
 if(n.endsWith('VideoDurationBadge'))return ()=>React.createElement('span',{},'0:30');
 if(n.endsWith('PublicPostLink'))return ({id,children})=>React.createElement('a',{href:'/p/'+id},children);
 if(n.endsWith('RankingClient')||n.endsWith('StructuredData'))return ()=>null;
 if(n.endsWith('ranking-display'))return {INITIAL_RANKING_COUNTS:{daily:50,weekly:50}};
 if(n.endsWith('ranking-pagination'))return {rankingHref:range=>range==='trending'?'/':'/ranking/'+range};
 if(n.endsWith('/seo'))return {rankingBreadcrumb:()=>({}),rankingItemList:()=>({})};
 throw Error('UNEXPECTED_TEST_IMPORT '+n);
}
async function main(){
 const rising=load('app/rising/page.tsx');
 assert(rising.metadata.title.absolute === '急上昇のTwitter動画ランキング・保存｜twizou');
 assert.equal(rising.metadata.alternates.canonical,'/rising');
 const html=renderToStaticMarkup(await rising.default());
 assert(html.includes('twizou内で人気の動画をまとめました！'));
 assert(html.includes('Twitter動画ランキングについて'));assert(html.includes('18歳未満の方は利用できません。'));
 for(const href of ['/browse','/accounts','/tags','/privacy','/terms','/copyright','/advertising-disclosure','/contact','/removal-request'])assert(html.includes('href="'+href+'"'),href);
 assert(html.indexOf('about-ranking')>html.indexOf('video-grid'));assert(html.indexOf('<footer>')>html.indexOf('about-ranking'));

 assert(html.includes('aria-label="twizouのトップページ（急上昇）へ"'));
 assert(html.includes('href="/rising"'));assert(html.includes('src="/twizou-mark.svg"'));
 assert(html.includes('width="64" height="64" alt="" aria-hidden="true"'));
 assert(html.includes('/reels'));assert(html.includes('/download'));assert(html.includes('0:30'));
 assert(html.includes('サイトで開いた回数 5回'));assert(html.includes('保存操作 2回'));
 const daily=renderToStaticMarkup(React.createElement(load('app/components/DedicatedRankingPage.tsx').default,{range:'daily',initialPosts:[]}));
 assert(daily.includes('毎日入れ替わる動画を紹介！'));
 const weekly=renderToStaticMarkup(React.createElement(load('app/components/DedicatedRankingPage.tsx').default,{range:'weekly',initialPosts:[]}));
 assert(weekly.includes('直近1週間の人気動画を紹介！'));
 if(process.env.XCLIP_BRAND_PREVIEW_DIR){const out=path.resolve(process.env.XCLIP_BRAND_PREVIEW_DIR);fs.mkdirSync(out,{recursive:true});for(const [name,body] of Object.entries({rising:html,daily,weekly})){fs.writeFileSync(path.join(out,name+'.html'),'<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+fs.readFileSync(path.join(root,'app/globals.css'),'utf8')+'</style>'+body+'</html>');}}
 console.log('PASS brand masthead SSR, rising home link, decorative monochrome icon, ranking copy, duration, counts and canonical');
}
main().catch(e=>{console.error(e);process.exitCode=1});
