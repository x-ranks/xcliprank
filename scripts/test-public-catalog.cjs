'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),deps=root;
const ts=require(path.join(deps,'node_modules/typescript'));Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const core=require(path.join(root,'lib/public-video-core.ts')),{createPublicCatalog}=require(path.join(root,'lib/public-catalog-store.ts')),ticket=require(path.join(root,'lib/public-save-receipt.ts'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-public-catalog-')),now=Date.parse('2026-10-18T00:00:00Z'),time=new Date(now).toISOString(),secret='synthetic-fixture-secret-never-production';
const post={id:'1850123456789012345',authorId:'12345678',handle:'fixture',authorName:'投稿者A',text:'本文の例',posterUrl:'https://pbs.twimg.com/fixture.jpg',videoUrl:'https://video.twimg.com/fixture.mp4',createdAt:time,sourceHash:'b'.repeat(64),eligible:true};
async function main(){
 const store=createPublicCatalog(path.join(tmp,'durable'));assert.equal((await store.read()).revision,0);assert(!fs.existsSync(path.join(tmp,'durable')));
 assert.equal(core.videoMetadata(post,null).index,false);assert.equal(core.videoMetadata(post,null).saveCount,null);
 const label={id:crypto.randomUUID(),name:'屋外',active:true};let c=await store.labels({revision:0,labels:[label],posts:[{id:post.id,sourceHash:post.sourceHash,labelIds:[label.id],basis:'manual',modelRevision:null}]},now);
 assert.equal(core.videoMetadata(post,c.records[post.id]).index,false,'a label alone never grants indexing');
 assert.equal(core.visibleLabels(c,post.id)[0].name,'屋外');assert.equal(core.tagHref(label),'/tags/'+encodeURIComponent('屋外'));
 c=await store.ranked([post.id],time);assert.equal(core.videoMetadata(post,c.records[post.id]).index,true);assert.equal(core.videoMetadata({...post,text:''},c.records[post.id]).index,false,'ranked but no saves/text remains noindex');
 const revision=c.revision;c=await store.ranked([post.id],time);assert.equal(c.revision,revision,'same ranking sighting is idempotent');
 const token=ticket.issueSaveReceipt(post.id,secret,now);assert(token);assert.equal(ticket.verifySaveReceipt(token,'99999999',secret,now),null);assert.equal(ticket.verifySaveReceipt(token,post.id,'different-secret-that-is-long-enough',now),null);assert.equal(ticket.verifySaveReceipt(token,post.id,secret,now+600001),null);
 const receipt=ticket.verifySaveReceipt(token,post.id,secret,now);c=await store.saved(post.id,receipt,now);assert.equal(c.records[post.id].saves,1);assert.equal(c.records[post.id].firstSavedAt,time);const r=c.revision;c=await store.saved(post.id,receipt,now+1);assert.equal(c.revision,r);assert.equal(c.records[post.id].saves,1);
 assert(core.videoMetadata({...post,text:''},c.records[post.id]).index);assert(!core.videoMetadata({...post,eligible:false},c.records[post.id]).index,'a prior save never overrides current removals');
 const m=core.videoMetadata(post,c.records[post.id]);assert.equal(m.canonical,'https://xcliprank.com/p/'+post.id);assert(m.title.includes('投稿者A')&&m.title.includes('本文の例')&&m.title.includes('動画を保存'));assert.notEqual(m.title,core.videoMetadata({...post,id:'1850123456789012346'},null).title);
 await assert.rejects(store.labels({revision:0,labels:[label],posts:[]},now),/PUBLIC_CATALOG_STALE/);assert.equal((await store.read()).records[post.id].saves,1);
 const id2='1850123456789012346';c=await store.labels({revision:c.revision,labels:[label],posts:[{id:id2,sourceHash:post.sourceHash,labelIds:[label.id],basis:'model_reviewed',modelRevision:'a'.repeat(64)}]},now);assert.deepEqual(core.relatedIds(c,post.id),[id2]);
 const renamed={...label,name:'屋外の例',active:false};c=await store.labels({revision:c.revision,labels:[renamed],posts:[]},now);assert.deepEqual(core.visibleLabels(c,post.id),[]);assert.equal(c.records[post.id].saves,1);
 const disk=path.join(tmp,'durable/catalog.json'),saved=fs.readFileSync(disk);fs.writeFileSync(disk,'{"version":99}');await assert.rejects(store.read(),/PUBLIC_CATALOG_UNREADABLE/);await assert.rejects(store.ranked([post.id],time),/PUBLIC_CATALOG_UNREADABLE/);assert.equal(fs.readFileSync(disk,'utf8'),'{"version":99}');fs.writeFileSync(disk,saved);
 fs.writeFileSync(path.join(tmp,'durable/catalog.lock'),JSON.stringify({pid:process.pid}));await assert.rejects(store.ranked([post.id],time),/PUBLIC_CATALOG_BUSY/);fs.unlinkSync(path.join(tmp,'durable/catalog.lock'));
 const restarted=createPublicCatalog(path.join(tmp,'durable'));assert.equal((await restarted.read()).records[post.id].firstSavedAt,time);
 console.log('PASS PUBLIC CATALOG: index policy truth table, thin/no-save suppression, unique titles/self canonical, labels never grant index, real first-observation timestamps, signed expiring post-bound receipts, replay idempotency, removal overrides, atomic persistence/restart/corrupt refusal, stale revision and locks. Synthetic data only.');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{const p=path.resolve(tmp);if(path.dirname(p)!==path.resolve(os.tmpdir())||!path.basename(p).startsWith('xclip-public-catalog-'))throw Error('UNSAFE_TEST_CLEANUP');fs.rmSync(p,{recursive:true,force:true,maxRetries:3,retryDelay:50});});
