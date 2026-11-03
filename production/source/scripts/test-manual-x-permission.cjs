'use strict';
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),crypto=require('crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),m={exports:{}};
const mocks={'./manual-ranking':{},'./supabase-admin':{},'./post-status':{isUnavailablePost:(r,b)=>b.has('post:'+r.x_post_id)||b.has('id:'+r.author_id)}};
const code=ts.transpileModule(fs.readFileSync(path.join(root,'lib/manual-x-permissions.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
new Function('require','module','exports',code)(id=>mocks[id]??require(id),m,m.exports);
const {manualXPermitted}=m.exports;
const row={x_post_id:'123456',author_id:'78901',video_url:'https://video.twimg.com/a.mp4',is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS'};
const author={username:'author',curated_status:null,review_required:false};
const entry={xApproval:{postId:row.x_post_id,authorId:row.author_id,videoHash:crypto.createHash('sha256').update(row.video_url).digest('hex')}};
assert.equal(manualXPermitted(row,[entry],author,new Set()),true);
for(const modified of [{is_visible:false},{moderation_blocked:true},{review_required:true},{content_category:'BLOCK'}, {video_url:'https://video.twimg.com/changed.mp4'}, {author_id:'99999'}])
 assert.equal(manualXPermitted({...row,...modified},[entry],author,new Set()),false);
for(const modified of [{curated_status:'paused'},{curated_status:'removed'},{curated_status:'unavailable'},{review_required:true}])
 assert.equal(manualXPermitted(row,[entry],{...author,...modified},new Set()),false);
for(const key of ['post:123456','id:78901','name:author'])assert.equal(manualXPermitted(row,[entry],author,new Set([key])),false);
assert.equal(manualXPermitted(row,[],author,new Set()),false);
assert.equal(manualXPermitted(row,[entry],undefined,new Set()),false);
console.log('PASS MANUAL X PERMISSION: exact post, author, source hash, existing publication flags and current removals');
