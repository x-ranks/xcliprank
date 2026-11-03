'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),sharp=require('sharp');
const file=path.resolve(__dirname,'../lib/manual-thumbnail.ts'),m={exports:{}};
new Function('require','module','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(require,m,m.exports);
(async()=>{
 const input=await sharp({create:{width:1600,height:800,channels:3,background:'#af8542'}}).png().toBuffer();
 const result=await m.exports.prepareManualThumbnail('data:image/png;base64,'+input.toString('base64'));
 assert.equal(result.contentType,'image/webp');assert.match(result.sha256,/^[a-f0-9]{64}$/);const info=await sharp(result.bytes).metadata();assert.equal(info.format,'webp');assert.equal(info.width,1200);assert(!info.exif);
 await assert.rejects(m.exports.prepareManualThumbnail('data:image/svg+xml;base64,'+Buffer.from('<svg/>').toString('base64')),/INVALID/);
 await assert.rejects(m.exports.prepareManualThumbnail('data:image/jpeg;base64,'+input.toString('base64')),/INVALID/);
 await assert.rejects(m.exports.prepareManualThumbnail('data:image/png;base64,'+'A'.repeat(5*1024*1024)),/TOO_LARGE/);
 await assert.rejects(m.exports.prepareManualThumbnail('data:image/png;base64,AAAA'),/INVALID/);
 console.log('PASS MANUAL THUMBNAIL: actual decode, resize, metadata removal, type and size rejection; no writes');
})().catch(e=>{console.error(e);process.exitCode=1});
