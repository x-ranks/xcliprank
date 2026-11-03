const assert=require('node:assert/strict'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),ts=require('typescript'),{spawnSync,spawn}=require('node:child_process');
(async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-compatible-test-')),fixture=path.join(dir,'fixture.mp4');const r=spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=red:s=224x224:r=25:d=1','-c:v','libx264','-pix_fmt','yuv420p',fixture]);assert.equal(r.status,0,r.stderr.toString());
 const video=fs.readFileSync(fixture),originalFetch=global.fetch;let calls=0,allowed=true;
 const m={exports:{}};const stubs={'./tier-video-preview':{videoPreviewStatus:async()=>({samples:allowed?Array.from({length:10},(_,i)=>({id:i+1,video:'https://video.twimg.com/fixture.mp4'})):[]})},'./tier-personal-video':{runVideoTool:async(name,args)=>new Promise((resolve,reject)=>{const p=spawn(name,args);p.stdout.resume();p.stderr.resume();p.on('error',reject);p.on('close',c=>c===0?resolve(Buffer.alloc(0)):reject(Error('FFMPEG_FAILED')));})}};
 new Function('require','module','exports','process',ts.transpileModule(fs.readFileSync('lib/tier-preview-playback.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(n=>stubs[n]??require(n),m,m.exports,{cwd:()=>dir});
 global.fetch=async()=>{calls++;return new Response(video,{headers:{'content-length':String(video.length)}});};
 try{const a=m.exports;assert.deepEqual(a.playbackRange('bytes=0-9',100),{start:0,end:9,partial:true});assert.deepEqual(a.playbackRange('bytes=-10',100),{start:90,end:99,partial:true});assert.equal(a.playbackRange('bytes=100-',100),null);assert.equal(a.playbackRange('bytes=0-1,4-5',100),null);
 const unprepared=await a.servePreviewPlayback(1,null);assert.equal(unprepared.status,409);
 await a.preparePreviewPlayback(1);assert.equal(calls,1);await a.preparePreviewPlayback(1);assert.equal(calls,1,'cached video reused');
 const range=await a.servePreviewPlayback(1,'bytes=0-99');assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,100);assert.equal(range.headers.get('content-length'),'100');
 const head=await a.servePreviewPlayback(1,null,true);assert.equal(head.status,200);assert.equal(head.body,null);
 const invalid=await a.servePreviewPlayback(1,'bytes=9999999999-');assert.equal(invalid.status,416);
 const files=fs.readdirSync(path.join(dir,'.local-admin','tier-video-playback-cache'));const bytes=fs.readFileSync(path.join(dir,'.local-admin','tier-video-playback-cache',files[0]));assert(bytes.indexOf('moov')<bytes.indexOf('mdat'),'faststart header before media');
 for(let id=2;id<=9;id++)await a.preparePreviewPlayback(id);assert.equal(fs.readdirSync(path.join(dir,'.local-admin','tier-video-playback-cache')).length,8,'cache capped at8 videos');
 allowed=false;await assert.rejects(a.servePreviewPlayback(9,null),/PREVIEW_VIDEO_NOT_AVAILABLE/);
 console.log('PASS: real H264 remux faststart, cached reuse, Range206/suffix/416, HEAD, 8-video cache cap, safety recheck');
 }finally{global.fetch=originalFetch;await fsp.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
