'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const initial={phase:'running',revision:7,scope:'empty',threshold:0.7,counts:{scanned:200,published:121,emptyLabels:120,protected:20,already:0,unavailable:42,deferred:10,failed:1},lastErrors:[],pendingPublication:true};
const slots=[initial,false,'',0.7],refs=[{current:initial},{current:false},{current:false},{current:true}];let slot=0,ref=0;
const react={...React,useState:()=>{const index=slot++;return[slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},useRef:()=>refs[ref++],useEffect(){}};
const source=fs.readFileSync(p.join(__dirname,'../app/label-publication/AutoLabelPanel.tsx'),'utf8'),exportsUI={};new Function('require','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(name=>name==='react'?react:require(name),exportsUI);
function render(){slot=0;ref=0;return exportsUI.default();}
function all(node,test,result=[]){if(!node||typeof node!=='object')return result;if(test(node))result.push(node);React.Children.forEach(node.props?.children,child=>all(child,test,result));return result;}
async function main(){
 let tree=render(),select=all(tree,node=>node.type==='select')[0];assert.equal(select.props.disabled,false,'waiting state must allow choosing a new threshold');
 const markup=renderToStaticMarkup(tree);assert(markup.includes('タグを付けた動画</dt><dd>1件'));assert(markup.includes('判定結果の記録</dt><dd>121件'));assert(markup.includes('タグなしで記録</dt><dd>120件'));
 select.props.onChange({target:{value:'0.5'}});tree=render();const switchButton=all(tree,node=>node.type==='button'&&node.props.children==='選んだ基準で空タグだけ再処理')[0];assert.equal(switchButton.props.disabled,false);
 const resume=all(tree,node=>node.type==='button'&&node.props.children==='自動反映を開始・続きから再開')[0];assert.equal(resume.props.disabled,true,'do not resume the old threshold accidentally');
 const requests=[],oldFetch=global.fetch;global.fetch=async(url,options)=>{const body=JSON.parse(options.body);requests.push(body);return Response.json({...initial,pendingPublication:false,threshold:0.5,revision:body.revision+1,phase:body.action==='step'?'completed':'running',counts:{...initial.counts,published:0,emptyLabels:0}});};
 try{switchButton.props.onClick();for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(requests.map(row=>row.action),['restart-threshold','step']);assert(requests.every(row=>row.threshold===0.5));assert.equal(slots[0].phase,'completed');}finally{global.fetch=oldFetch;}
 slots[1]=true;tree=render();assert.equal(all(tree,node=>node.type==='select')[0].props.disabled,true,'do not change a live browser step');
 console.log('PASS THRESHOLD UI: actual waiting-state selection, 121/120 => one tagged counter, explicit 0.5 action and step payloads, old-resume prevention, busy-state lock. Mocked API only.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
