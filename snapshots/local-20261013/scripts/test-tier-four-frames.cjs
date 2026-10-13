const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),{spawnSync}=require('node:child_process');
const modules=new Map();
function load(id){if(modules.has(id))return modules.get(id).exports;const m={exports:{}};modules.set(id,m);
 const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n);
 new Function('require','exports','module',code)(req,m.exports,m);return m.exports;}
(async()=>{
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'xclip-frame-test-')),file=path.join(dir,'colors.mp4');
 const args=['-v','error','-y'];for(const color of ['red','green','blue','yellow'])args.push('-f','lavfi','-i',`color=c=${color}:s=224x224:r=25:d=1`);
 args.push('-filter_complex','[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0[out]','-map','[out]','-c:v','libx264','-pix_fmt','yuv420p',file);
 const result=spawnSync('ffmpeg',args);assert.equal(result.status,0,result.stderr.toString());
 const originalFetch=global.fetch;
 try{
   const core=load('lib/tier-personal-core'),video=load('lib/tier-personal-video'),sharp=require('sharp');
   assert.deepEqual(core.PERSONAL_FRAME_POSITIONS,[.1,.25,.5,.8]);
   const x=await video.extractLocalVideoFrames(file);assert.equal(x.frames.length,4);assert.deepEqual(x.times,[.4,1,2,3.2]);
   const colors=[];for(const b of x.frames){const rgb=await sharp(b).resize(1,1).removeAlpha().raw().toBuffer();colors.push([...rgb]);}
   assert(colors[0][0]>colors[0][1]*3,'10% red');assert(colors[1][1]>colors[1][0]*3,'25% green');assert(colors[2][2]>colors[2][0]*3,'50% blue');assert(colors[3][0]>100&&colors[3][1]>100&&colors[3][2]<30,'80% yellow');
   assert.throws(()=>core.combinePersonalFrames([Array(256).fill(1)]));
   assert.throws(()=>core.combinePersonalFrames(Array.from({length:4},()=>Array(256).fill(NaN))));
   const combined=core.combinePersonalFrames(Array.from({length:4},(_,i)=>Array(256).fill(i)));
   assert.equal(combined.length,1024);assert.deepEqual([combined[0],combined[256],combined[512],combined[768]],[0,1,2,3]);
   await assert.rejects(video.extractPersonalVideo('https://example.com/a.mp4'));
   let cancelled=0;
   global.fetch=async()=>({ok:false,status:404,body:{cancel:async()=>cancelled++}});
   await assert.rejects(video.extractPersonalVideo('https://video.twimg.com/fixture.mp4'),/VIDEO_HTTP_404/);
   global.fetch=async()=>({ok:true,headers:{get:()=>String(257*1024*1024)},body:{cancel:async()=>cancelled++}});
   await assert.rejects(video.extractPersonalVideo('https://video.twimg.com/fixture.mp4',{maxBytes:999*1024*1024}),/VIDEO_TOO_LARGE/);
   assert.equal(cancelled,2,'HTTP failures and oversize headers cancel body');
   const bytes=fs.readFileSync(file);global.fetch=async url=>{assert.equal(new URL(url).hostname,'video.twimg.com');return new Response(bytes);};
   const features=await video.extractPersonalVideo('https://video.twimg.com/fixture.mp4');assert.equal(features.length,1024);assert(features.every(Number.isFinite));
   assert.notDeepEqual(features.slice(0,256),features.slice(512,768),'distinct scenes retain distinct features');
   console.log('PASS: actual four-scene video -> 10/25/50/80% images -> ordered 1024-D features; missing/nonfinite frames rejected; non-X-video URL rejected; no X API');
 }finally{global.fetch=originalFetch;await fsp.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
