'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module'),ts=require('typescript'),React=require('react'),render=require('react-dom/server').renderToStaticMarkup;
const realLoad=Module._load,realState=React.useState;let calls=0;
const view={revision:20,phase:'completed',threshold:0.5,counts:{scanned:100,published:80,emptyLabels:3,protected:20,already:0,unavailable:0,deferred:0,failed:0},current:null,pendingPublication:false,lastErrors:[],message:null};
Module._load=function(id){if(id==='react')return{...React,useState(initial){const i=calls++;return realState(i===0?view:i===3?view.threshold:initial);}};return realLoad.apply(this,arguments);};
Module._extensions['.tsx']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText,f);
const Panel=require('../app/label-publication/AutoLabelPanel.tsx').default;
const html=render(React.createElement(Panel));assert(html.includes('全ての動画を再タグ付け'));assert(html.includes('手動正解は保持'));assert(html.includes('32MiB'));assert(html.includes('224×224'));assert(html.includes('value="0.5" selected=""'));assert(html.includes('新着・失敗分を含めて新しい一周を開始'));assert(html.includes('今の1件が終わったら停止'));console.log('PASS RETAG UI: actual React rendering, explicit full-retag action and preserved controls/threshold, manual-truth and image/size guidance; no requests.');

