'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),ts=require('typescript'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),cache=new Map();let entries=[];
const stubs={'lib/manual-ranking':{readManualState:async()=>({version:1,revision:1,entries})},'lib/public-video-production':{},'app/api/manual-ranking/route':{}};
function load(id){if(stubs[id])return stubs[id];if(cache.has(id))return cache.get(id).exports;const m={exports:{}};cache.set(id,m);
 const code=ts.transpileModule(fs.readFileSync(path.join(root,id+'.ts'),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(n=>n.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),n))):require(n),m,m.exports);return m.exports;}
(async()=>{const tmp=await fs.promises.mkdtemp(path.join(os.tmpdir(),'manual-thumb-endpoint-'));process.env.XCLIP_MANUAL_RANKING_DIR=tmp;
 try{const processor=load('lib/manual-thumbnail'),store=load('lib/manual-thumbnail-store'),api=load('app/api/public-video/route');
  const raw=await sharp({create:{width:8,height:8,channels:3,background:'#114477'}}).png().toBuffer();
  const image=await processor.prepareManualThumbnail('data:image/png;base64,'+raw.toString('base64'));
  const url=await store.storeManualThumbnail(image.bytes,image.sha256);
  let response=await api.GET(new Request(url));assert.equal(response.status,404);
  entries=[{posterUrl:url}];response=await api.GET(new Request(url));assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/webp');assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),image.bytes);
  entries=[];assert.equal((await api.GET(new Request(url))).status,404);
  assert.equal((await api.GET(new Request('https://twizou.net/api/public-video?type=manual-thumbnail&value=../../x'))).status,404);
  console.log('PASS MANUAL THUMBNAIL ENDPOINT: normalized uploaded image, reference gate, no-store, removal and invalid path');
 }finally{delete process.env.XCLIP_MANUAL_RANKING_DIR;await fs.promises.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
