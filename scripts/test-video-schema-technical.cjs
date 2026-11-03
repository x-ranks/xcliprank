'use strict';
const fs=require('fs'),p=require('path'),os=require('os'),assert=require('assert/strict'),crypto=require('crypto'),Module=require('module'),ts=require('typescript');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createPublicCatalog}=require('../lib/public-catalog-store.ts'),{createPublicVideoService}=require('../lib/public-video-service.ts'),{publicVideoSchema}=require('../lib/public-video-schema.ts'),{videoMetadata}=require('../lib/public-video-core.ts'),{isoVideoDuration,validVideoTechnical}=require('../lib/video-technical.ts');
const tmp=fs.mkdtempSync(p.join(os.tmpdir(),'twizou-technical-test-')),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),label={id:crypto.randomUUID(),name:'合成タグ',active:true};
const video=(id)=>({id,authorId:'author-id',handle:'fixture',authorName:'合成投稿者',text:'合成の本文',posterUrl:'https://pbs.twimg.com/fixture.jpg',videoUrl:'https://video.twimg.com/'+id+'.mp4',sourceHash:sha(id),createdAt:'2026-10-20T01:02:03.000Z',eligible:true});
(async()=>{try{
 let rows=[video('101'),video('102'),{...video('103'),eligible:false}],busy=false;
 const catalog=createPublicCatalog(p.join(tmp,'catalog')),service=createPublicVideoService({catalog,posts:async ids=>rows.filter(v=>ids.includes(v.id)),authorVideos:async()=>[],candidates:async()=>[],indexVideos:async()=>rows,scanPage:async()=>({videos:rows,scanned:3,nextCursor:'103',upper:'101',done:true}),automaticReady:async()=>!busy,secret:async()=>''});
 await catalog.labels({revision:0,labels:[label],posts:[{id:'101',sourceHash:sha('101'),labelIds:[label.id],basis:'manual',modelRevision:null}]});
 await catalog.saved('101',{id:crypto.randomUUID(),expires:Date.now()+60000});await catalog.ranked(['101'],'2026-10-20T01:02:03.000Z');
 const before=(await catalog.read()).records['101'];
 assert.equal((await service.status()).technicalMetadataVersion,1);assert.deepEqual((await service.technicalPage(null,null)).items.map(v=>v.id),['101','102']);
 assert.deepEqual(await service.technicalPublish({id:'101',sourceHash:sha('101'),metadata:{durationSeconds:12.345}}),{result:'published'});
 let stored=(await catalog.read()).records['101'];for(const key of Object.keys(before))assert.deepEqual(stored[key],before[key],key+' must survive metadata-only update');assert.equal(stored.technical.method,'mp4-range-v1');
 await catalog.technical('101',sha('101'),{durationSeconds:12.345,width:1280,height:720});stored=(await catalog.read()).records['101'];const rev=(await catalog.read()).revision;
 await service.technicalPublish({id:'101',sourceHash:sha('101'),metadata:{durationSeconds:12.345}});assert.equal((await catalog.read()).revision,rev,'duration-only must retain measured dimensions');
 let schema=publicVideoSchema(rows[0],videoMetadata(rows[0],stored,[label]),[label],stored.technical);assert.equal(schema.duration,'PT12.345S');assert.equal(schema.width.value,1280);assert.equal(schema.author.name,'合成投稿者');assert.equal(schema.author.url,'https://twizou.net/accounts/fixture');assert.deepEqual(schema.keywords,[label.name]);assert.equal(schema.contentUrl,rows[0].videoUrl);assert(!('embedUrl'in schema));assert(!('interactionStatistic'in schema));assert(!JSON.stringify(schema).includes('sourceHash'));
 assert.equal((await service.detail('101')).technical.durationSeconds,12.345);assert.deepEqual((await service.technicalPage(null,null)).items.map(v=>v.id),['102']);
 rows[0].sourceHash=sha('new-source');schema=publicVideoSchema(rows[0],videoMetadata(rows[0],stored,[]),[],stored.technical);assert(!('duration'in schema));assert(!('width'in schema));assert.equal((await service.detail('101')).technical,null);assert((await service.technicalPage(null,null)).items.some(v=>v.id==='101'));
 assert.deepEqual(await service.technicalPublish({id:'101',sourceHash:sha('101'),metadata:{durationSeconds:20}}),{result:'unavailable'});assert.deepEqual(await service.technicalPublish({id:'103',sourceHash:sha('103'),metadata:{durationSeconds:20}}),{result:'unavailable'});
 busy=true;await assert.rejects(service.technicalPublish({id:'102',sourceHash:sha('102'),metadata:{durationSeconds:3}}),/DEPLOYMENT_BUSY/);busy=false;
 for(const metadata of [{durationSeconds:0},{durationSeconds:Infinity},{durationSeconds:2,width:0},{durationSeconds:2,x:1}]){assert(!validVideoTechnical(metadata));await assert.rejects(service.technicalPublish({id:'102',sourceHash:sha('102'),metadata}),/INVALID_TECHNICAL/);}
 assert.equal(isoVideoDuration(0),null);assert.equal(publicVideoSchema({...rows[0],posterUrl:null},{canonical:'https://twizou.net/p/101'},[]),null);assert.equal(publicVideoSchema({...rows[0],eligible:false},{canonical:'https://twizou.net/p/101'},[]),null);
 await assert.rejects(service.technicalPage('../bad',null),/INVALID_SCAN/);
 await catalog.technical('101',sha('new-source'),{durationSeconds:20});stored=(await catalog.read()).records['101'];assert(!('width'in stored.technical));assert.deepEqual(stored.labelIds,[label.id]);assert.equal(stored.basis,'manual');
 console.log('PASS VIDEO SCHEMA/TECHNICAL: measured source binding, valid VideoObject, author/tags, stale metadata omitted, metadata-only writes preserve manual labels/saves/receipts, idempotency, guards. Synthetic only.');
}finally{assert.equal(p.dirname(tmp),os.tmpdir());assert(p.basename(tmp).startsWith('twizou-technical-test-'));fs.rmSync(tmp,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
