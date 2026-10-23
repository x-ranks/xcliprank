'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',code)(name=>name.startsWith('./')?load(path.join(path.dirname(file),name)+'.ts'):require(name),module,module.exports);return module.exports;}
const {isIndexable}=load('lib/indexability.ts'),{canonicalTagName}=load('lib/tag-aliases.ts');
assert.equal(isIndexable({type:'post',permitted:true,hasAuthor:true,hasDescription:true}),true);
assert.equal(isIndexable({type:'post',permitted:false,hasAuthor:true,hasDescription:true}),false);
assert.equal(isIndexable({type:'account',permittedVideos:0}),false);
assert.equal(isIndexable({type:'account',permittedVideos:1}),true);
assert.equal(isIndexable({type:'account',permittedVideos:2}),true);
assert.equal(isIndexable({type:'tag',permittedVideos:2,hasImage:true}),false);
assert.equal(isIndexable({type:'tag',permittedVideos:3,hasImage:false}),false);
assert.equal(isIndexable({type:'tag',permittedVideos:3,hasImage:true}),true);
for(const name of ['無修正','无修正','무수정','uncensored','UNCENSORED'])assert.equal(canonicalTagName(name),'無修正');
assert.equal(canonicalTagName('スポーツ'),'スポーツ');
console.log('PASS INDEXABILITY: shared post/account/tag thresholds and canonical aliases; no network');
