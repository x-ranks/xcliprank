'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),Module=require('module'),ts=require('typescript');
const original=Module._load;let options,calls=0,error=null;
Module._load=function(id,parent){if(parent?.filename.endsWith('label-learning-video.ts')&&id==='./video-range-frames')return{extractRangeVideoFrames:async(url,o)=>{calls++;options=o;if(error)throw Error(error);return{frames:Array(4).fill(Buffer.from([255,216])),times:[1,2,3,4],hash:'a'.repeat(64),technical:{durationSeconds:5}};}};if(parent?.filename.endsWith('label-learning-video.ts')&&id==='./tier-personal-image')return{extractPersonalFrame:async()=>Array(256).fill(0)};return original.apply(this,arguments);};
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {prepareLabelVideo}=require('../lib/label-learning-video.ts');
(async()=>{
 const url='https://video.twimg.com/fixture.mp4';let v=await prepareLabelVideo(url);assert.equal(options.maxBytes,32*1024*1024);assert.equal(v.frames.length,4);assert.equal(v.features.length,1024);assert.equal(v.technical.durationSeconds,5);await prepareLabelVideo(url,{maxBytes:1024*1024*1024});assert.equal(options.maxBytes,32*1024*1024,'legacy maximum cannot restore whole downloads');
 for(const [code,expected]of [['VIDEO_HTTP_403','FORBIDDEN'],['VIDEO_HTTP_404','NOT_FOUND'],['VIDEO_HTTP_429','RATE_LIMIT'],['VIDEO_RANGE_UNAVAILABLE','RANGE_UNAVAILABLE'],['VIDEO_RANGE_BUDGET_EXCEEDED','RANGE_BUDGET_EXCEEDED'],['VIDEO_TOOLS_MISSING','TOOLS_MISSING']]){error=code;await assert.rejects(prepareLabelVideo(url),new RegExp('LABEL_VIDEO_.*'+expected));}
 const before=calls;await assert.rejects(prepareLabelVideo('http://video.twimg.com/a'),/URL_REFUSED/);for(const maxBytes of [0,NaN,1.5,1024*1024*1024+1])await assert.rejects(prepareLabelVideo(url,{maxBytes}),/INVALID_LIMIT/);assert.equal(calls,before);
 for(const file of ['label-learning-video.ts','tier-personal-video.ts']){const s=fs.readFileSync(p.join(__dirname,'../lib',file),'utf8');assert(s.includes('extractRangeVideoFrames'));assert(!s.includes('response.body.getReader'));assert(!s.includes('mkdtemp'));}
 console.log('PASS LABEL PARTIAL VIDEO: 32MiB enforced including legacy options, four-frame features, measured metadata, 403/404 unchanged, Range failures not full-download fallback, invalid input guarded. Mock extraction only.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>Module._load=original);
