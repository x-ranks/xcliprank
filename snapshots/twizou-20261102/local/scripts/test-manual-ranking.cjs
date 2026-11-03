'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>name.startsWith('./')?load(path.join(path.dirname(file),name)+'.ts'):require(name),module,module.exports);return module.exports;}
const api=load('lib/manual-ranking.ts');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-manual-ranking-test-'));
process.env.XCLIP_MANUAL_RANKING_DIR=path.join(scratch,'durable');
(async()=>{try{
 assert.equal(api.directMediaUrl('https://cdn.example.com/video.mp4?token=x'),'https://cdn.example.com/video.mp4?token=x');
 assert.equal(api.directMediaUrl('https://example.com/video-page'),null);
 for(const bad of ['http://example.com/a.mp4','https://127.0.0.1/a.mp4','https://user@example.com/a.mp4','javascript:alert(1)'])assert.equal(api.safeExternalUrl(bad),null);
 assert.deepEqual(await api.readManualState(),{version:1,revision:0,entries:[]});
 const item={url:'https://cdn.example.com/a.mp4',title:'動画A',positions:{trending:2,daily:null,weekly:1},posterUrl:null};
 let state=await api.writeManualState(0,'save',item);assert.equal(state.revision,1);assert.equal(state.entries[0].mediaUrl,item.url);
 await assert.rejects(api.writeManualState(0,'save',item),/MANUAL_REVISION_CHANGED/);
 await assert.rejects(api.writeManualState(1,'save',{...item,url:'https://cdn.example.com/b.mp4'}),/MANUAL_POSITION_OCCUPIED/);
 assert.deepEqual(await api.readManualState(),state,'rejected save leaves published file unchanged');
 const posts=[{x_post_id:'111'},{x_post_id:'222'},{x_post_id:'333'}];
 const overlaid=api.applyManualPlacements(posts,state.entries,'trending',3);
 assert.deepEqual(overlaid.map(p=>p.x_post_id),['111','manual:'+state.entries[0].id,'222']);
 assert.deepEqual(overlaid.map(p=>p.ranking_position),[1,2,3]);
 state=await api.writeManualState(1,'remove',{id:state.entries[0].id});assert.equal(state.entries.length,0);
 assert.equal((await api.readManualState()).revision,2);
 console.log('PASS MANUAL RANKING: HTTPS/media validation, fixed slots, atomic state, stale revision, conflict, removal; no network');
 }finally{if(scratch.startsWith(os.tmpdir()+path.sep)&&path.basename(scratch).startsWith('xclip-manual-ranking-test-'))fs.rmSync(scratch,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
