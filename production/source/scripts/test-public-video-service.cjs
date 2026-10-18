'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),Module=require('node:module');
const ts=require('typescript');Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createPublicCatalog}=require('../lib/public-catalog-store.ts'),{createPublicVideoService}=require('../lib/public-video-service.ts'),{issueSaveReceipt}=require('../lib/public-save-receipt.ts'),{rememberRanking}=require('../lib/public-ranking-history.ts');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-public-service-')),sha=s=>crypto.createHash('sha256').update(s).digest('hex'),label={id:crypto.randomUUID(),name:'ラベルA',active:true},secret='synthetic-secret-never-used-in-production';
const video=(id,author='authorA')=>({id,authorId:author,handle:author,authorName:author,text:'固有本文'+id,posterUrl:'https://pbs.twimg.com/a.jpg',videoUrl:'https://video.twimg.com/'+id+'.mp4',sourceHash:sha(id),createdAt:null,eligible:true});
let rows=[video('101'),video('102'),video('103','authorB'),video('104','authorC'),video('105','authorD')],calls=[];
async function main(){
 const catalog=createPublicCatalog(path.join(tmp,'catalog')),service=createPublicVideoService({catalog,posts:async ids=>{calls.push(ids);return rows.filter(v=>ids.includes(v.id));},authorVideos:async key=>rows.filter(v=>v.handle.toLowerCase()===key.toLowerCase()),candidates:async skip=>rows.filter(v=>!skip.includes(v.id)),secret:async()=>secret});
 assert.equal(await service.detail('../101'),null);assert.equal(calls.length,0);
 await service.publish({revision:0,labels:[label],posts:rows.slice(0,4).map(v=>({id:v.id,sourceHash:v.sourceHash,labelIds:[label.id],basis:'manual',modelRevision:null}))});
 let d=await service.detail('101');assert.equal(d.metadata.index,false);assert.deepEqual(d.sameAuthor.map(v=>v.id),['102']);assert.deepEqual(d.related.map(v=>v.id),['103','104']);assert.equal(d.labels[0].name,label.name);
 assert.equal((await service.tag(label.name)).videos.length,4);assert.equal((await service.account('authorA')).videos.length,2);assert.deepEqual((await service.candidates(['105'])),[]);
 let writes=0;const record=async(ids,at)=>{writes++;return catalog.ranked(ids,at);};
 await rememberRanking(Response.json({ok:true,range:'trending',data:[{x_post_id:'101'},{x_post_id:'104'}]}),record);assert.equal(writes,1);
 for(const body of [{ok:false,range:'daily',data:[{x_post_id:'102'}]},{ok:true,range:'other',data:[{x_post_id:'102'}]},{ok:true,range:'weekly',data:[{x_post_id:'bad'}]}])await rememberRanking(Response.json(body),record);
 await rememberRanking(new Response('bad',{status:503}),record);assert.equal(writes,1);assert.deepEqual((await service.indexable()).map(v=>v.id).sort(),['101','104']);
 rows.find(v=>v.id==='104').text='';assert.deepEqual((await service.indexable()).map(v=>v.id),['101']);
 const token=issueSaveReceipt('104',secret);await service.saved('104',token);await service.saved('104',token);d=await service.detail('104');assert.equal(d.metadata.saveCount,1);assert(d.metadata.firstSavedAt);assert(d.metadata.index);
 await assert.rejects(service.saved('103',token),/PUBLIC_INVALID_RECEIPT/);
 rows.find(v=>v.id==='103').sourceHash=sha('changed');assert.deepEqual((await service.detail('103')).labels,[]);assert.deepEqual((await service.detail('101')).related.map(v=>v.id),['104']);
 const revision=(await service.status()).revision;await assert.rejects(service.publish({revision,labels:[label],posts:[{id:'103',sourceHash:sha('103'),labelIds:[label.id],basis:'manual',modelRevision:null}]}),/PUBLIC_SOURCE_CHANGED/);
 rows.find(v=>v.id==='104').eligible=false;assert.equal(await service.detail('104'),null);assert(!(await service.indexable()).some(v=>v.id==='104'));await assert.rejects(service.saved('104',issueSaveReceipt('104',secret)),/PUBLIC_NOT_FOUND/);
 const response=Response.json({ok:true,range:'daily',data:[{x_post_id:'101'}]});assert.strictEqual(await rememberRanking(response,async()=>{throw Error('disk failure');}),response);
 const before=await catalog.read();await assert.rejects(service.publish({revision:before.revision,labels:[{...label,weights:[1,2]}],posts:[]}),/PUBLIC_INVALID_LABELS/);assert.equal((await catalog.read()).revision,before.revision);
 console.log('PASS PUBLIC VIDEO SERVICE: actual ranking response history, label-only noindex, thin suppression, save binding/replay, current removal, URL change invalidates labels, same-author/related dedup, no private model fields, current eligible sitemap, DB failures never grant index. Mocked DB/provider.');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{if(path.dirname(path.resolve(tmp))!==path.resolve(os.tmpdir())||!path.basename(tmp).startsWith('xclip-public-service-'))throw Error('UNSAFE_TEST_CLEANUP');fs.rmSync(tmp,{recursive:true,force:true});});
