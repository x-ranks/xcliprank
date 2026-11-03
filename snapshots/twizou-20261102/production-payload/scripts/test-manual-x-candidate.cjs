'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),ts=require('typescript');
const root=p.resolve(__dirname,'..'),cache=new Map();
function load(file){if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const code=ts.transpileModule(fs.readFileSync(p.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('require','module','exports',code)(name=>name.startsWith('.')?load(p.posix.normalize(p.posix.join(p.posix.dirname(file),name))+'.ts'):require(name),m,m.exports);return m.exports;}
const {prepareManualXCandidate}=load('lib/manual-x-candidate.ts');
const author={id:'12345',username:'fixture',name:'fixture',expectedTier:'A'};
const candidate={x_post_id:'123456',author_id:'12345',text:'fixture',video_url:'https://video.twimg.com/example.mp4'};
(async()=>{
 const calls=[];const fetchPost=async(...args)=>{calls.push(args);return {author,candidate}};
 assert.deepEqual(await prepareManualXCandidate('https://x.com/fixture/status/123456',{fetchPost}),{author,candidate});assert.equal(calls.length,1);assert.equal(calls[0][1],'A');
 await assert.rejects(prepareManualXCandidate('x',{fetchPost:async()=>({author,candidate:{...candidate,author_id:'9'}})}),/IDENTITY_INVALID/);
 await assert.rejects(prepareManualXCandidate('x',{fetchPost:async()=>({author,candidate:{...candidate,video_url:null}})}),/IDENTITY_INVALID/);
 await assert.rejects(prepareManualXCandidate('x',{fetchPost:async()=>({author,candidate:{...candidate,text:'児童ポルノ'}})}),/REVIEW_REQUIRED/);
 await assert.rejects(prepareManualXCandidate('x',{fetchPost:async()=>{throw Error('FETCH_FAILURE')}}),/FETCH_FAILURE/);
 const original=global.fetch;try{
  global.fetch=async url=>{assert.equal(url,'https://api.fxtwitter.com/2/status/123456');return Response.json({code:200,status:{type:'status',provider:'twitter',id:'123456',text:'fixture text',author:{type:'profile',id:'12345',screen_name:'fixture',name:'Fixture',protected:false},created_timestamp:Math.floor(Date.now()/1000)-60,possibly_sensitive:false,media:{videos:[{type:'video',id:'video-1',formats:[{container:'mp4',url:'https://video.twimg.com/a.mp4',bitrate:100}],thumbnail_url:'https://pbs.twimg.com/a.jpg'}]},views:123,likes:9,reposts:3,replies:2,bookmarks:4}})};
  const actual=await prepareManualXCandidate('https://x.com/fixture/status/123456');assert.equal(actual.candidate.text,'fixture text');assert.equal(actual.candidate.preview_image_url,'https://pbs.twimg.com/a.jpg');assert.equal(actual.candidate.video_url,'https://video.twimg.com/a.mp4');assert.equal(actual.candidate.views,123);assert.equal(actual.candidate.bookmarks,4);
 }finally{global.fetch=original}
 console.log('PASS MANUAL X CANDIDATE: fetch metadata once, safety, identity, failure; fixture only');
})().catch(e=>{console.error(e);process.exitCode=1});
