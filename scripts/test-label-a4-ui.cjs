'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),Module=require('module'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const report={prepared:300,training:200,unreviewed:100,testReviewed:0,independentTestVideos:0,modelSamples:200,stale:false,comparisons:[{threshold:0.7,videos:200,tagged:9,tp:8,fp:1,fn:601,tn:2382}],labels:[{id:'fixture',name:'合成タグ <script>',positive:1,negative:199,positiveAuthors:1,trained:false,guidance:'untrained',crossCheck:null}]};
function renderComponent(relative,hookState){const source=fs.readFileSync(p.join(__dirname,'..',relative),'utf8'),out=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,exports={};new Function('require','exports',out)(name=>name==='react'?{...React,useState:initial=>[initial===null?hookState:initial,()=>{}],useEffect(){},useRef:initial=>({current:initial})}:name==='next/link'?{__esModule:true,default:({href,children})=>React.createElement('a',{href},children)}:require(name),exports);return renderToStaticMarkup(React.createElement(exports.default));}
async function main(){
 const html=renderComponent('app/label-publication/LabelA4Diagnostics.tsx',report);assert(html.includes('正解未保存 100件'));assert(html.includes('タグが付く動画'));assert(html.includes('本番の正解率ではありません'));assert(html.includes('未学習動画で精度を確認')||html.includes('該当・非該当の教材を追加'));assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('href="/label-learning"'));
 const auto=renderComponent('app/label-publication/AutoLabelPanel.tsx',{phase:'completed',revision:1,scope:'empty',threshold:0.7,counts:{scanned:1,published:0,emptyLabels:0,protected:0,already:0,unavailable:0,deferred:0,failed:0},lastErrors:[]});assert(auto.includes('タグが空の動画だけ再処理'));assert(auto.includes('今回の対象：タグが空の動画のみ'));
 const apiSource=fs.readFileSync(p.join(__dirname,'../app/api/label-diagnostics/route.ts'),'utf8');assert(!apiSource.includes('export async function POST'));
 const originalLoad=Module._load;let calls=0;Module._load=function(name,parent,isMain){if(name.endsWith('/label-a4-server'))return{readLabelA4Diagnostics:async()=>{calls++;return report;}};return originalLoad.apply(this,arguments);};
 try{
  const route=require('../app/api/label-diagnostics/route.ts'),before=process.env.NODE_ENV;
  process.env.NODE_ENV='production';assert.equal((await route.GET(new Request('http://localhost:3004/api/label-diagnostics'))).status,404);assert.equal(calls,0);
  process.env.NODE_ENV='development';for(const url of ['https://twizou.net/api/label-diagnostics','https://evil.invalid/api/label-diagnostics'])assert.equal((await route.GET(new Request(url))).status,404);
  assert.equal((await route.GET(new Request('http://localhost:3004/api/label-diagnostics',{headers:{origin:'https://evil.invalid'}}))).status,404);assert.equal(calls,0);
  const response=await route.GET(new Request('http://localhost:3004/api/label-diagnostics'));assert.equal(response.status,200);assert.equal(calls,1);assert.match(response.headers.get('cache-control'),/no-store/);assert.match(response.headers.get('x-robots-tag'),/noindex/);assert.deepEqual(await response.json(),report);if(before===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=before;
 }finally{Module._load=originalLoad;}
 console.log('PASS A4 UI/API: actual SSR tables/escaping/scope/button; local-only GET rejects production/foreign hosts/origins before reading; mocked diagnostics and synthetic data.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
