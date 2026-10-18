'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),ts=require('typescript'),React=require('react');
const root=path.resolve(__dirname,'..');
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
function harness(){const states=[],refs=[];let si=0,ri=0;return{reset(){si=ri=0;},states,hooks:{useId:()=> 'fixture-id',useEffect:()=>{},useRef(value){return refs[ri++]??(refs[ri-1]={current:value});},useState(value){const i=si++;if(!(i in states))states[i]=value;return[states[i],v=>states[i]=typeof v==='function'?v(states[i]):v];}}};}
function nodes(tree){return!tree||typeof tree!=='object'?[]:[tree,...React.Children.toArray(tree.props?.children).flatMap(nodes)];}
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
async function scenario(mode){
 const h=harness();let finish,downloadCalls=0,events=0,clicks=0;const pending=new Promise(resolve=>finish=resolve);
 const Client=load('app/components/VideoDownloadButton.tsx',n=>{if(n==='react')return h.hooks;if(n==='react/jsx-runtime')return require(n);if(n==='next/link')return props=>React.createElement('a',props);if(n.endsWith('browser-direct-download'))return{fetchDirectVideo:async()=>{downloadCalls++;if(mode==='failure')throw Error('fixture CDN error');return pending;}};throw Error('UNEXPECTED_IMPORT '+n);}).default;
 global.document={createElement:()=>({click(){clicks++;},remove(){}}),body:{appendChild(){}}};
 global.fetch=async(url,options)=>{if(url==='/api/public-save-event'){events++;assert.deepEqual(JSON.parse(options.body),{id:'101',receipt:'signed-fixture'});return Response.json({ok:true});}return Response.json({ready:true,mode:'browser-direct',...(url.includes('consent=1')?{url:'https://video.twimg.com/fixture.mp4',saveReceipt:'signed-fixture'}:{})});};
 const render=()=>{h.reset();return Client({postId:'101'});};
 let tree=render();nodes(tree).find(n=>n.type==='dialog').props.ref.current={showModal(){},close(){}};
 nodes(tree).find(n=>n.props?.className==='video-download-trigger').props.onClick();await flush();assert.equal(events,0,'checking alone never counts');
 tree=render();nodes(tree).find(n=>n.type==='input').props.onChange({target:{checked:true}});tree=render();const save=nodes(tree).find(n=>n.props?.className==='video-download-confirm');save.props.onClick();save.props.onClick();await flush();assert.equal(events,0,'metadata or pending bytes never count');assert.equal(downloadCalls,1,'double click uses same request');
 if(mode==='cancel'){tree=render();nodes(tree).find(n=>n.type==='button'&&n.props.children==='受信を中止').props.onClick();}
 finish(new Blob([new Uint8Array([1,2,3])],{type:'video/mp4'}));await flush();assert.equal(events,mode==='success'?1:0);assert.equal(clicks,mode==='success'?1:0);
}
async function main(){const previous={fetch:global.fetch,document:global.document};try{await scenario('success');await scenario('failure');await scenario('cancel');}finally{global.fetch=previous.fetch;if(previous.document===undefined)delete global.document;else global.document=previous.document;}
 const download=load('lib/video-download.ts');let issued=0;const deps={findPost:async()=>({video_url:'https://video.twimg.com/a.mp4',is_visible:true,moderation_blocked:false,review_required:false,content_category:'PASS',adult_tier:'A',manual_tier:null}),issueReceipt:async()=>{issued++;return'synthetic';}};
 await download.downloadVideo(new Request('https://xcliprank.com/api/video-download?postId=101&check=1'),deps);assert.equal(issued,0);assert.equal((await download.downloadVideo(new Request('https://xcliprank.com/api/video-download?postId=101'),deps)).status,400);assert.equal(issued,0);assert.equal((await(await download.downloadVideo(new Request('https://xcliprank.com/api/video-download?postId=101&consent=1'),deps)).json()).saveReceipt,'synthetic');assert.equal(issued,1);
 console.log('PASS SAVE OBSERVATION: real download button handlers; metadata/check/partial/failure/cancel never count; complete Blob and browser save request count once; double click guard; server receipt only after consent and eligibility. Synthetic DOM/CDN only.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
