'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),m={exports:{}};
let state={version:1,revision:0,entries:[]}, publishError=false, providerCalls=0;
const author={id:'78901',username:'author',name:'Author',expectedTier:'A'};
const candidate={x_post_id:'123456',author_id:'78901',author_username:'author',video_url:'https://video.twimg.com/a.mp4',preview_image_url:'https://pbs.twimg.com/a.jpg',text:'text'};
const store={parseManualPlacement:x=>x,readManualState:async()=>structuredClone(state),writeManualState:async(revision,action,entry)=>{
 assert.equal(revision,state.revision);state.revision++;
 if(action==='save'){const row={...structuredClone(entry),id:entry.id||'test-id'};state.entries=state.entries.filter(e=>e.id!==row.id);state.entries.push(row);}
 else state.entries=state.entries.filter(e=>e.id!==entry.id);
 return structuredClone(state);
}};
const mocks={'next/server':{NextResponse:{json:(v,i)=>Response.json(v,i)}},'manual-ranking':store,
 'public-video-production':{productionPublicBackend:()=>({service:{inspect:async()=>state.entries.length?[{eligible:true}]:[]}})},
 'manual-thumbnail':{},'manual-thumbnail-store':{},'manual-request-body':{readManualRequestBody:r=>r.text()},
 'manual-x-candidate':{prepareManualXCandidate:async()=>{providerCalls++;return {author,candidate}}},
 'free-curated-publish':{publishFreeCandidates:async(a,c,o)=>{assert.equal(o.manualPost,true);if(publishError)throw Error('MOCK_DB_FAILURE')}},
 'fxtwitter-curated':{parseFreePostUrl:()=>candidate.x_post_id},'post-status-store':{unavailableKeys:async()=>new Set()},'post-status':{isUnavailablePost:()=>false}};
const code=ts.transpileModule(fs.readFileSync(path.join(root,'app/api/manual-ranking/route.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
new Function('require','module','exports',code)(id=>mocks[id]??mocks[id.split('/').pop()]??require(id),m,m.exports);
function req(secret,entry){const url=new URL('https://twizou.net/api/engagement?type=placement');const body={action:'save',revision:state.revision,entry};return {nextUrl:url,url:url.href,headers:new Headers({'content-type':'application/json',...(secret?{authorization:'Bearer '+secret}:{})}),text:async()=>JSON.stringify(body)};}
(async()=>{const old=process.env.CRON_SECRET;process.env.CRON_SECRET='test';try{
 const entry={url:'https://x.com/author/status/123456',title:'',positions:{trending:1,daily:null,weekly:null},xApproval:{postId:'attacker'}};
 let r=await m.exports.POST(req(null,entry));assert.equal(r.status,401);assert.equal(providerCalls,0);
 r=await m.exports.POST(req('test',entry));assert.equal(r.status,200);assert.equal(state.entries[0].title,'Authorの動画');
 assert.equal(state.entries[0].posterUrl,candidate.preview_image_url);assert.equal(state.entries[0].xApproval.postId,candidate.x_post_id);
 state={version:1,revision:0,entries:[]};publishError=true;r=await m.exports.POST(req('test',entry));assert.notEqual(r.status,200);assert.equal(state.entries.length,0);
 console.log('PASS MANUAL X REGISTRATION: authorization, provider metadata, post-specific approval and failed-write rollback; DB/provider mocked');
}finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}})().catch(e=>{console.error(e);process.exitCode=1});
