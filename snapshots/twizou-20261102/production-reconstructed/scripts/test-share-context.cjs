'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file,resolve){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve??(n=>n.startsWith('.')?local(path.posix.normalize(path.posix.join(path.posix.dirname(file),n))+'.ts'):require(n)),m,m.exports);return m.exports;}
function local(file){if(!cache.has(file))cache.set(file,load(file));return cache.get(file);}
const Link=({href,prefetch,children,...props})=>React.createElement('a',{href,...props},children),share=local('lib/share-video.ts');
function resolve(n){
 if(n==='react'||n==='react/jsx-runtime')return require(n);if(n==='next/link')return Link;
 if(n.endsWith('useSuspendedAuthors'))return()=>[];
 if(n.endsWith('share-video'))return share;
 if(n.endsWith('post-status'))return{isUnavailablePost:()=>false};
 if(n.endsWith('browser-direct-playback'))return{directPlaybackUrl:v=>v};
 if(n.endsWith('engagement-client'))return{trackEngagement:()=>{throw Error('SSR_MUST_NOT_TRACK')}};
 if(n.endsWith('PublicPostLink'))return({id,children,ariaLabel})=>React.createElement('a',{href:'/p/'+id,'aria-label':ariaLabel},children);
 if(/(?:PublicListRestore|DirectPlaybackVideo|ExternalVideo|VideoDownloadButton|VideoDurationBadge)$/.test(n))return()=>null;
 if(n.endsWith('ranking-pagination'))return local('lib/ranking-pagination.ts');
 if(n.endsWith('ranking-update'))return local('lib/ranking-update.ts');
 if(n.endsWith('ranking-display'))return local('lib/ranking-display.ts');
 throw Error('UNEXPECTED_SHARE_TEST_IMPORT '+n);
}
const Client=load('app/components/RankingClient.tsx',resolve).default,post={x_post_id:'2110000000000000001',author_name:'投稿者A',author_username:'fixture',x_url:'https://x.com/fixture/status/2110000000000000001',preview_image_url:null,video_url:null,video_bitrate:null,views:12,likes:2,bookmarks:1,reposts:0,replies:0,score:1,adult_tier:'A',created_at:'2026-10-27T00:00:00Z'};
const cases=[{props:{},expected:'新着'},{props:{range:'daily',fixedRange:true},expected:'24時間ランキング'},{props:{range:'weekly',fixedRange:true},expected:'週間ランキング'},{props:{initialRange:'daily'},expected:'24時間ランキング'},{props:{initialRange:'weekly'},expected:'週間ランキング'},{props:{range:'weekly',initialRange:'daily',fixedRange:true},expected:'週間ランキング'},{props:{range:'daily',initialRange:'weekly',fixedRange:true},expected:'24時間ランキング'}];
const before=global.fetch;global.fetch=()=>{throw Error('SSR_MUST_NOT_FETCH')};
try{for(const c of cases){
 const html=renderToStaticMarkup(React.createElement(Client,{...c.props,initialPosts:[post,{...post,x_post_id:'manual-fixture',manual_id:'manual-fixture',x_url:'https://x.com/fixture/status/2110000000000000002'}]}));
 assert(!html.includes('twitter.com/intent/tweet'),'Lists no longer expose X share buttons');
 assert(!html.includes('Xで共有'));
 // The detail share builder retains factual context for callers that still use it.
 const u=new URL(share.shareVideoHref(post.x_post_id,null,{author:post.author_name,section:c.props.range??c.props.initialRange??'trending'}));
 assert(u.searchParams.get('text').includes('投稿者Aの動画'));
 assert(u.searchParams.get('text').includes(c.expected+'に掲載中'));assert(!u.searchParams.get('text').includes('1位'));
}console.log('PASS SHARE CONTEXT: ranking lists contain no share buttons; detail share builder retains accurate range context.');}finally{global.fetch=before;}
