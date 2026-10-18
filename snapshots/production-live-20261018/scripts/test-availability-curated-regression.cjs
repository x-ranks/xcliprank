const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),ts=require('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {classifyPostResponse}=require('../lib/post-status.ts'),{scanAvailabilityStatuses}=require('../lib/availability-scan.ts');
const {readPostState,unavailableKeys}=require('../lib/post-status-store.ts'),{fetchFreeMediaPage}=require('../lib/fxtwitter-curated.ts');
const {DAY,HOUR}=require('../lib/availability-policy.ts');
const identity=id=>({x_post_id:id,author_id:'123',author_username:'test'});
const normal=id=>({code:200,status:{type:'status',provider:'twitter',id,text:'video',media:{videos:[{type:'video',url:'https://video.twimg.com/test.mp4'}]},author:{id:'123',screen_name:'test',protected:false}}});
const privatePost=id=>({code:200,status:{type:'tombstone',provider:'twitter',id,reason:'private'}});
const profile={code:200,user:{type:'profile',id:'123',screen_name:'test',protected:false}};
const author={id:'123',username:'test',name:'Test',expectedTier:'S'};
(async()=>{
 const previousCuratedDirectory=process.env.XCLIP_FREE_CURATED_STATE_DIR;
 const dirs=[];async function dir(){const p=await fs.promises.mkdtemp(path.join(os.tmpdir(),'xclip-regression-'));dirs.push(p);return p;}
 try{
  // This registry is independent of the author/post directory passed to the scanner.
  // Never inherit live manual removals during an isolated monitor test.
  process.env.XCLIP_FREE_CURATED_STATE_DIR=await dir();
  const p=identity('9000');assert.equal(classifyPostResponse(p,200,normal('9000')),'public');
  for(const reason of ['private','blocked','suspended','unavailable'])assert.equal(classifyPostResponse(p,200,{code:200,status:{type:'tombstone',provider:'twitter',id:'9000',reason}}),'hidden');
  assert.equal(classifyPostResponse(p,200,privatePost('9001')),'unknown');
  const wrong=normal('9000');wrong.status.author.id='456';wrong.status.author.protected=true;assert.equal(classifyPostResponse(p,200,wrong),'unknown');
  const quote=normal('9000');quote.status.quote=privatePost('9001').status;assert.equal(classifyPostResponse(p,200,quote),'public');
  const protectedPost=normal('9000');protectedPost.status.author.protected=true;assert.equal(classifyPostResponse(p,200,protectedPost),'hidden');
  const explicitError=normal('9000');explicitError.message='ERROR';assert.equal(classifyPostResponse(p,200,explicitError),'unknown');
  const noMedia=normal('9000');delete noMedia.status.media;assert.equal(classifyPostResponse(p,200,noMedia),'unknown');
  const removedVideo=normal('9000');removedVideo.status.media.videos=[];assert.equal(classifyPostResponse(p,200,removedVideo),'hidden');
  const externalVideo=normal('9000');externalVideo.status.media.videos[0].url='https://evil.test/a.mp4';assert.equal(classifyPostResponse(p,200,externalVideo),'hidden');
  let time=100*DAY,mode='hidden',calls=0;
  const rows=['9000','8999','8998','8997'].map(identity),directory=await dir();
  const fetcher=async url=>{calls++;if(url.includes('/profile/'))return Response.json(profile);const id=url.split('/').at(-1);
   if(mode==='outage')return Response.json({code:503},{status:503});
   return Response.json(id==='9000'&&mode==='hidden'?privatePost(id):['8999','8998'].includes(id)?{code:200}:normal(id));};
  const opts={directory,now:()=>time,pause:async()=>{},fetcher};
  let stats=await scanAvailabilityStatuses(async()=>rows,opts);assert.equal(stats.post_checked,4);assert.equal(stats.post_unknown,2);assert.equal(stats.stopped,false);assert.equal(stats.post_hidden,0);
  time+=DAY;stats=await scanAvailabilityStatuses(async()=>rows,opts);assert.equal(stats.post_hidden,1);assert((await unavailableKeys(directory)).has('post:9000'));
  time+=7*DAY;mode='public';stats=await scanAvailabilityStatuses(async()=>rows,opts);assert.equal(stats.post_restored,1);assert(!(await unavailableKeys(directory)).has('post:9000'));
  time+=DAY;mode='outage';stats=await scanAvailabilityStatuses(async()=>rows,opts);assert(stats.stopped);assert.equal(stats.post_checked,2);assert.equal((await readPostState(directory)).cooldownUntil,time+6*HOUR);
  const isolated=await dir();time+=DAY;const hiddenOnly={...opts,directory:isolated,fetcher:async url=>Response.json(url.includes('/profile/')?profile:privatePost('9000'))};
  await scanAvailabilityStatuses(async()=>[identity('9000')],hiddenOnly);time+=DAY;stats=await scanAvailabilityStatuses(async()=>[identity('9000')],hiddenOnly);assert.equal(stats.post_hidden,0,'all-hidden provider response cannot add exclusions');
  const feeds=[];const get=async url=>{const u=new URL(url);feeds.push([u.pathname,u.searchParams.get('cursor')]);return Response.json({code:200,results:[],cursor:{bottom:'next'}})};
  const first=await fetchFreeMediaPage(author,20,null,get);assert.equal(first.nextCursor,'xclip-statuses-v1:next');
  await fetchFreeMediaPage(author,20,first.nextCursor,get);await fetchFreeMediaPage(author,20,'legacy-media-cursor',get);
  assert.deepEqual(feeds,[['/2/profile/id%3A123/statuses',null],['/2/profile/id%3A123/statuses','next'],['/2/profile/id%3A123/media','legacy-media-cursor']]);
  await assert.rejects(()=>fetchFreeMediaPage(author,20,'xclip-statuses-v1:',get));
  console.log('PASS REGRESSION: missing message; private/tombstone identity; quote isolation; unknown posts continue; separated hidden confirmation; healthy-control guard; restoration; genuine outage stops; new/legacy cursor feeds isolated. DB/network mocked.');
 }finally{if(previousCuratedDirectory===undefined)delete process.env.XCLIP_FREE_CURATED_STATE_DIR;else process.env.XCLIP_FREE_CURATED_STATE_DIR=previousCuratedDirectory;for(const d of dirs)await fs.promises.rm(d,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
