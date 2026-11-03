'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict'),ts=require('typescript'),crypto=require('crypto');
const source=fs.readFileSync(path.resolve(__dirname,'../lib/manual-thumbnail-store.ts'),'utf8');
const m={exports:{}};
const localRequire=id=>id==='./manual-thumbnail'?{MANUAL_IMAGE_OUTPUT_BYTES:2*1024*1024}:require(id);
new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(localRequire,m,m.exports);
(async()=>{
 const dir=await fs.promises.mkdtemp(path.join(os.tmpdir(),'manual-thumbnail-test-'));
 process.env.XCLIP_MANUAL_RANKING_DIR=dir;
 try {
  const bytes=Buffer.from('sample image bytes'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
  const url=await m.exports.storeManualThumbnail(bytes,hash);
  assert.equal(await m.exports.storeManualThumbnail(bytes,hash),url);
  assert.equal(await m.exports.readPublishedManualThumbnail(hash,[]),null);
  assert.deepEqual(await m.exports.readPublishedManualThumbnail(hash,[{posterUrl:url}]),bytes);
  assert.equal(await m.exports.readPublishedManualThumbnail(hash,[{posterUrl:'https://example.com/'}]),null);
  await assert.rejects(m.exports.readPublishedManualThumbnail('../x',[]),/INVALID/);
  await assert.rejects(m.exports.storeManualThumbnail(bytes,'a'.repeat(64)),/INVALID/);
  await fs.promises.writeFile(path.join(dir,'thumbnails',hash+'.webp'),'changed');
  await assert.rejects(m.exports.readPublishedManualThumbnail(hash,[{posterUrl:url}]),/UNSAFE/);
  console.log('PASS MANUAL THUMBNAIL STORE: isolated durable storage, publication gate, integrity and invalid hashes');
 } finally { delete process.env.XCLIP_MANUAL_RANKING_DIR; await fs.promises.rm(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1});
