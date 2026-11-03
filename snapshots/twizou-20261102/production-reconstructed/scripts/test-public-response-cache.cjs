'use strict';
const assert=require('assert/strict'),http=require('http'),fs=require('fs/promises'),path=require('path'),os=require('os'),{EventEmitter}=require('events');
const {createPublicResponseCache,createControlSignature,context,requestKey}=require('./public-response-cache.cjs');
(async()=>{
 let now=0,signature='valid-1',calls=0,deny=false,sourceAge=0;
 const cache=createPublicResponseCache({signature:async()=>{if(deny)throw Error('READ_FAILED');return signature;},now:()=>now});
 const handler=cache.wrap((req,res)=>{
  calls++;const state=context.getStore();if(!req.url.startsWith('/browse'))state.rankingSeen=true;state.freshUntil=now+30000-sourceAge;
  res.setHeader('Content-Type',req.headers.rsc?'text/x-component':'text/html; charset=utf-8');
  if(req.url.includes('page=7'))res.setHeader('Set-Cookie','fixture=private');
  if(req.url.includes('page=8'))res.statusCode=503;
  res.write('start:');res.end(String(calls));
 });
 const offline=Boolean(process.env.XCLIP_TEST_DEPENDENCY_ROOT||process.env.NODE_OPTIONS?.includes('offline-guard')||process.execArgv.some(x=>x.includes('offline-guard'))),server=offline?null:http.createServer(handler);if(server)await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const get=async(url='/',headers={})=>{
  if(!offline)return new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path:url,headers:{Accept:'text/html',...headers}},res=>{const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));}).on('error',reject);});
  // Canonical checks prohibit sockets. Exercise the same real wrapper using a
  // minimal response stream; the isolated built-Next fixture verifies the wire.
  const res=new EventEmitter(),values={},chunks=[];Object.assign(res,{statusCode:200,headersSent:false,setHeader:(k,v)=>values[k.toLowerCase()]=v,getHeader:k=>values[k.toLowerCase()],hasHeader:k=>k.toLowerCase() in values,getHeaders:()=>({...values}),writeHead(status){res.statusCode=status;res.headersSent=true;return res;},write(chunk){if(!res.headersSent)res.writeHead(res.statusCode);if(chunk)chunks.push(Buffer.from(chunk));return true;},end(chunk){if(!res.headersSent)res.writeHead(res.statusCode);if(chunk)chunks.push(Buffer.from(chunk));res.emit('finish');return res;}});
  const originalHead=res.writeHead;res.writeHead=function(status,provided){if(provided)for(const[k,v]of Object.entries(provided))res.setHeader(k,v);return originalHead.call(this,status);};
  await handler({method:'GET',url,headers:Object.fromEntries(Object.entries({host:'127.0.0.1',Accept:'text/html',...headers}).map(([k,v])=>[k.toLowerCase(),v]))},res);await Promise.resolve();
  return {status:res.statusCode,headers:values,body:Buffer.concat(chunks).toString()};
 };
 try{
  const first=await get(),hit=await get();assert.equal(hit.headers['x-twizou-html-cache'],'HIT');assert.equal(first.body,hit.body);assert.equal(hit.headers['cache-control'],'private, max-age=300, must-revalidate');assert.equal(calls,1);
  const unchanged=await get('/',{'If-None-Match':hit.headers.etag});assert.equal(unchanged.status,304);assert.equal(unchanged.body,'');assert.equal(calls,1);
  signature='valid-2';const removed=await get('/',{'If-None-Match':hit.headers.etag});assert.equal(removed.status,200);assert.notEqual(removed.body,hit.body);assert.equal(calls,2);
  deny=true;const failed=await get();assert.equal(failed.status,503);assert.equal(failed.headers['cache-control'],'no-store');deny=false;
  await get('/',{Cookie:'private=1'});await get('/',{Authorization:'Bearer fixture'});assert.equal(calls,4);
  const rsc=await get('/',{RSC:'1','Next-Router-State-Tree':'tree-A'});assert.equal(rsc.headers['x-twizou-html-cache'],'MISS');const rscHit=await get('/?_rsc=different',{RSC:'1','Next-Router-State-Tree':'tree-A'});assert.equal(rscHit.body,rsc.body);assert.equal(rscHit.headers['x-twizou-html-cache'],'HIT');
  const differentTree=await get('/',{RSC:'1','Next-Router-State-Tree':'tree-B'});assert.notEqual(differentTree.body,rsc.body);
  await get('/?page=7');await get('/?page=7');const cookieCalls=calls;assert(cookieCalls>=8,'Set-Cookie bodies were not cached');
  await get('/?page=8');await get('/?page=8');assert.equal(calls,cookieCalls+2,'Error responses are not cached');
  now=6000;const stillFresh=await get();assert.equal(stillFresh.headers['x-twizou-html-cache'],'HIT');
  now=16000;const expired=await get();assert.equal(expired.headers['x-twizou-html-cache'],'MISS');
  const browse=await get('/browse?page=2'),browseHit=await get('/browse?page=2');assert.equal(browse.headers['x-twizou-html-cache'],'MISS');assert.equal(browseHit.headers['x-twizou-html-cache'],'HIT');assert.equal(browseHit.headers['cache-control'],'private, max-age=300, must-revalidate');
  assert.equal(requestKey({method:'GET',url:'/browse?edition=fixture',headers:{host:'twizou.net'}}),null);
  sourceAge=29900;await get('/?page=2');now+=101;const aged=await get('/?page=2');assert.equal(aged.headers['x-twizou-html-cache'],'MISS','HTML must not extend original ranking data lifetime');
  assert.equal(requestKey({method:'GET',url:'/contact',headers:{host:'twizou.net'}}),null);assert.equal(requestKey({method:'POST',url:'/',headers:{host:'twizou.net'}}),null);assert.equal(requestKey({method:'GET',url:'/',headers:{host:'www.twizou.net'}}),null);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'twizou-control-test-'));try{const file=path.join(dir,'state.json'),sig=createControlSignature([file]);const missing=await sig();await fs.writeFile(file,'{"ok":1}');const one=await sig();assert.notEqual(missing,one);const replacement=path.join(dir,'new.json');await fs.writeFile(replacement,'{"ok":2}');await fs.rename(replacement,file);assert.notEqual(await sig(),one);await fs.unlink(file);assert.equal(await sig(),missing);}finally{await fs.rm(dir,{recursive:true,force:true});}
  const envKeys=['XCLIP_AUTHOR_STATE_DIR','XCLIP_FREE_CURATED_STATE_DIR','XCLIP_MANUAL_RANKING_DIR'],oldEnv=envKeys.map(key=>process.env[key]),lateRoot=await fs.mkdtemp(path.join(os.tmpdir(),'twizou-late-env-test-'));
  try{
   const deferred=createControlSignature();envKeys.forEach((key,index)=>process.env[key]=path.join(lateRoot,'configured-'+index));
   const absent=await deferred();await fs.mkdir(process.env.XCLIP_AUTHOR_STATE_DIR);const authorFile=path.join(process.env.XCLIP_AUTHOR_STATE_DIR,'state-v1.json'),author={version:1,entries:{'id:123':{status:'public',checkedAt:1,confirmedAt:1,nextCheckAt:2}},cooldownUntil:0};await fs.writeFile(authorFile,JSON.stringify(author));const publicSignature=await deferred();assert.notEqual(publicSignature,absent,'Late configured directories honored');
   author.entries['id:123'].checkedAt=3;await fs.writeFile(authorFile,JSON.stringify(author));assert.equal(await deferred(),publicSignature,'Public patrol timestamps do not invalidate HTML');
   author.entries['id:123'].status='suspended';await fs.writeFile(authorFile,JSON.stringify(author));assert.notEqual(await deferred(),publicSignature,'Suspension invalidates immediately');
   author.entries['id:123'].status='public';await fs.writeFile(authorFile,JSON.stringify(author));assert.equal(await deferred(),publicSignature,'Restoration changes effective block signature');
   const postFile=path.join(process.env.XCLIP_AUTHOR_STATE_DIR,'post-state-v1.json'),posts={version:1,cursor:null,cycleStartedAt:1,cycleCompletedAt:0,nextBatchAt:2,cooldownUntil:0,entries:{'901':{authorKey:'id:123',checkedAt:1,nextCheckAt:2,missingSince:0,lastMissingAt:0,blocked:false}}};await fs.writeFile(postFile,JSON.stringify(posts));const clear=await deferred();posts.entries['901'].checkedAt=3;await fs.writeFile(postFile,JSON.stringify(posts));assert.equal(await deferred(),clear);posts.entries['901'].blocked=true;await fs.writeFile(postFile,JSON.stringify(posts));assert.notEqual(await deferred(),clear,'Confirmed removal invalidates immediately');await fs.writeFile(postFile,'broken');await assert.rejects(deferred,'Invalid state must fail closed');
  }finally{envKeys.forEach((key,index)=>{if(oldEnv[index]===undefined)delete process.env[key];else process.env[key]=oldEnv[index];});await fs.rm(lateRoot,{recursive:true,force:true});}
  console.log('PASS public response cache: '+(offline?'offline response-stream':'real HTTP')+' HIT/304, live signature invalidation, fail closed, auth/cookie/error bypass, HTML/RSC/tree separation, TTL bounded by source age, atomic file changes and late environment configuration');
 }finally{if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
