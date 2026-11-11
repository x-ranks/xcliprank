'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{PassThrough}=require('stream'),{renderToPipeableStream}=require('react-dom/server');
const root=path.resolve(__dirname,'..'),cache=new Map();
const id='2061469959365280142',video={id,authorId:'123',handle:'fixture',authorName:'Fixture',text:null,posterUrl:null,videoUrl:'https://video.twimg.com/fixture.mp4',sourceHash:'a'.repeat(64),eligible:true,createdAt:'2026-10-20T00:00:00Z',views:1,likes:0,bookmarks:0};
const detail={video,technical:null,labels:[{id:'fixture-label',name:'テスト',active:true}],metadata:{title:'Fixture',description:'Fixture',canonical:'https://twizou.net/p/'+id,index:true,saveCount:0}};
let labels=0,related=0;
const never=()=>new Promise(()=>{}),Link=({href,prefetch,children,...props})=>React.createElement('a',{href,...props},children);
function load(file){if(cache.has(file))return cache.get(file);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(n=>resolve(n,file),m,m.exports);cache.set(file,m.exports);return m.exports;}
function resolve(n,file){
 if(n==='next/headers')return {headers:async()=>new Headers()};
 if(n.endsWith('AgeGate'))return {__esModule:true,default:()=>null};
 if(n==='react'||n==='react/jsx-runtime')return require(n);
 if(n==='next/link')return Link;if(n==='next/navigation')return {notFound(){throw Error('NOT_FOUND');}};
 if(n.endsWith('public-video-server'))return {readPublicDetailCore:async()=>detail,readPublicLabels:()=>{labels++;return never();},readPublicRelated:()=>{related++;return never();}};
 if(n.endsWith('DirectPlaybackVideo'))return ({postId,recoverEnabled,...props})=>React.createElement('video',props);
 if(/(?:VideoDownloadButton|PublicPostClose|PublicPostEngagement)$/.test(n))return ()=>null;
 if(n.startsWith('.')){const raw=path.posix.normalize(path.posix.join(path.posix.dirname(file),n)),target=['.ts','.tsx','.cjs'].map(ext=>raw+ext).find(at=>fs.existsSync(path.join(root,at)));if(target)return load(target);}
 return require(n);
}
(async()=>{
 const realSet=global.setTimeout,realClear=global.clearTimeout,timers=new Map();let sequence=0;
 global.setTimeout=(fn,ms,...args)=>{if(ms===2500||ms===4000){const timer={fixture:++sequence};timers.set(timer,{fn:()=>fn(...args),ms});return timer;}return realSet(fn,ms,...args);};
 global.clearTimeout=timer=>{if(timers.has(timer)){timers.delete(timer);return;}return realClear(timer);};
 try{
  const page=load('app/p/[id]/page.tsx'),tree=await page.default({params:Promise.resolve({id})});
  const html=await new Promise((done,fail)=>{
   const output=new PassThrough();let body='';output.on('data',chunk=>body+=chunk);output.on('end',()=>done(body));
   const stream=renderToPipeableStream(tree,{onShellReady(){stream.pipe(output);setImmediate(()=>{try{assert(body.includes('public-post-player'));assert(body.includes('<video'));assert.deepEqual([...timers.values()].map(timer=>timer.ms).sort((a,b)=>a-b),[4000]);for(const timer of [...timers.values()])timer.fn();}catch(error){stream.abort();fail(error);}});},onError:fail});
  });
  assert(html.includes('この動画に付けられたタグ'));assert(html.includes('テスト'));assert(html.includes('ほかの動画は'));assert(html.includes('href="/browse"'));assert(!html.includes('タグを読み込んでいます…</p></div><script>ERROR'));
  assert.equal(labels,0,'Detail must never start the full tag inventory');assert.equal(related,1);assert.equal(timers.size,0,'Optional timeout handle is released');
  console.log('PASS detail auxiliary budget: actual streamed player first; full tag scan is never called; never-settling related read cannot prevent completion; known tags and browse fallback retained; timers cleaned; no real network');
 }finally{global.setTimeout=realSet;global.clearTimeout=realClear;}
})().catch(error=>{console.error(error);process.exitCode=1;});
