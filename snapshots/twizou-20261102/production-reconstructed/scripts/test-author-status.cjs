const assert=require('node:assert/strict'),fs=require('fs'),fsp=fs.promises,path=require('path'),os=require('os'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const {classifyAuthorResponse,authorKey,isSuspendedAuthor}=require('../lib/author-status.ts');
const {scanAuthorStatuses,fetchAuthorStatus}=require('../lib/author-status-scan.ts');
const {readAuthorState,suspendedAuthorKeys}=require('../lib/author-status-store.ts');
const profile=id=>({code:200,message:'OK',user:{type:'profile',id,screen_name:'test',protected:false}});
async function main(){
 assert.equal(authorKey({author_id:'123',author_username:'Old_Name'}),'id:123');
 assert.equal(authorKey({author_username:'@TEST'}),'name:test');
 assert.equal(authorKey({author_id:'../../secret',author_username:'https://evil'}),null);
 assert.equal(isSuspendedAuthor({author_id:'456',author_username:'test'},new Set(['id:123','name:test'])),false,'a recycled handle must not block a different numeric author');
 const gone={code:404,message:'User is suspended',reason:'suspended',id:'123'};
 assert.equal(classifyAuthorResponse('id:123',404,gone),'suspended');
 assert.equal(classifyAuthorResponse('id:123',200,gone),'suspended');
 assert.equal(classifyAuthorResponse('id:123',404,{...gone,user:{id:'123',type:'profile'}}),'suspended','optional profile metadata is permitted by the documented error schema');
 assert.equal(classifyAuthorResponse('id:123',404,{...gone,user:{id:'456'}}),'unknown','every supplied identity must match');
 for(const [http,body] of [[404,{code:404,message:'NOT_FOUND'}],[429,gone],[503,gone],[404,{...gone,id:'456'}],[200,{code:200,user:{...profile('123').user,protected:true}}],[200,profile('456')],[200,{...profile('123'),reason:'suspended'}]])assert.equal(classifyAuthorResponse('id:123',http,body),'unknown');
 assert.equal(classifyAuthorResponse('id:123',200,profile('123')),'public');
 let called=0;const fetcher=async (url,init)=>{called++;assert.equal(new URL(url).hostname,'api.fxtwitter.com');assert.match(url,/\/2\/profile\/id%3A\d+$/);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.ok(!JSON.stringify(init).includes('Bearer'));return Response.json(gone,{status:404});};
 assert.equal((await fetchAuthorStatus('id:123',fetcher)).outcome,'suspended');
 assert.equal((await fetchAuthorStatus('id:../../test',fetcher)).outcome,'unknown');assert.equal(called,1);
 for(const response of [new Response('<html>',{status:404}),Response.json({code:404}),Response.json(gone,{status:503}),new Response('x'.repeat(140000),{headers:{'content-type':'application/json'}})])assert.equal((await fetchAuthorStatus('id:123',async()=>response)).outcome,'unknown');
 assert.equal((await fetchAuthorStatus('id:123',async()=>{throw Error('timeout')})).outcome,'unknown');
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-authors-'));let time=1000000;
 try{
  const options={directory:dir,now:()=>time,pause:async()=>{},fetcher};
  const authors=[{author_id:'123'},{author_id:'123',author_username:'duplicate'}];
  let result=await scanAuthorStatuses(authors,options);assert.equal(result.checked,1);assert.equal(result.suspended,1);assert.equal(result.paid_x_requests,0);
  assert((await suspendedAuthorKeys(dir)).has('id:123'));if(process.platform!=='win32')assert.equal((await fsp.stat(path.join(dir,'state-v1.json'))).mode&0o777,0o600);
  assert.equal((await scanAuthorStatuses(authors,options)).checked,0,'back-to-back runs deduplicate');
  time+=86400001;await scanAuthorStatuses(authors,{...options,fetcher:async()=>Response.json({code:404},{status:404})});assert((await suspendedAuthorKeys(dir)).has('id:123'),'plain 404 does not clear a confirmed suspension');
  time+=86400001;await scanAuthorStatuses(authors,{...options,fetcher:async()=>Response.json(profile('123'))});assert.equal((await suspendedAuthorKeys(dir)).size,0,'verified public profile restores');
  time+=86400001;await scanAuthorStatuses(authors,{...options,fetcher:async()=>Response.json({code:429},{status:429})});
  time+=120001;assert.equal((await scanAuthorStatuses(authors,options)).checked,0,'429 cooldown honored');
  time+=86400001;result=await scanAuthorStatuses(Array.from({length:12},(_,i)=>({author_id:String(1000+i)})),{...options,maxChecks:4,fetcher:async url=>Response.json(profile(decodeURIComponent(url.split('/').at(-1)).slice(3)))});assert.equal(result.checked,4);assert.equal(result.deferred,9);
  assert.equal((await readAuthorState(dir)).entries['id:1000'].status,'public');
  await fsp.writeFile(path.join(dir,'state-v1.json'),'broken');await assert.rejects(()=>readAuthorState(dir),/AUTHOR_STATE_UNREADABLE/);
 }finally{await fsp.rm(dir,{recursive:true,force:true});}
 console.log('PASS AUTHOR MONITOR: explicit suspension only; identity matching; no paid/CDN calls; timeout/404/429/5xx preserved; disk/restart state; restore; dedup/cooldown/fair scan; corrupt state refused.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
