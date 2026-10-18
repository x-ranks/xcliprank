const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
const component=ts.transpileModule(fs.readFileSync('app/components/DirectPlaybackVideo.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(deps){
 let index=0,slots=[],pending=[],tree;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const hooks={
  useRef(value){const i=index++;return slots[i]??(slots[i]={current:value});},
  useState(value){const i=index++;if(!slots[i])slots[i]={value};return [slots[i].value,v=>{slots[i].value=typeof v==='function'?v(slots[i].value):v;}];},
  useCallback(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps))slots[i]={fn,deps};return slots[i].fn;},
  useEffect(fn,deps){const i=index++;if(!slots[i]||!same(slots[i].deps,deps))pending.push(()=>{slots[i]?.cleanup?.();slots[i]={deps,cleanup:fn()};});},
 };
 const m={exports:{}};
 new Function('require','module','exports',component)(name=>{
  if(name==='react')return hooks;
  if(name==='react/jsx-runtime')return {Fragment:'fragment',jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
  if(name.includes('browser-direct-download'))return {fetchDirectVideo:deps.blob};
  if(name.includes('browser-stream-playback'))return {getStreamingSources:deps.sources,attachDirectStream:deps.attach};
  if(name.includes('browser-direct-playback'))return {directPlaybackUrl:url=>url?.startsWith('https://video.twimg.com/')?url:undefined};
  throw Error(name);
 },m,m.exports);
 return {
  render(props){index=0;pending=[];tree=m.exports.default(props);for(const effect of pending)effect();return tree.props.children[0];},
  unmount(){for(const slot of slots)slot?.cleanup?.();},
 };
}
const drain=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;let created=0,revoked=[];
 URL.createObjectURL=()=>`blob:test-${++created}`;URL.revokeObjectURL=url=>revoked.push(url);
 const props={src:'https://video.twimg.com/a.mp4',postId:'21',controls:true};
 try {
  let attached=0,blobCalls=0,disposed=0;
  const h=harness({sources:async()=>({url:props.src,hlsUrl:'https://video.twimg.com/master.m3u8'}),
   attach:async(node,url,opts)=>{attached++;opts.onReady();return ()=>disposed++;},blob:async()=>{blobCalls++;throw Error('No whole-file receive for HLS');}});
  let v=h.render(props);const node={error:{code:4},play:async()=>{}};v.props.ref(node);
  v.props.onError({currentTarget:node});v=h.render(props);await drain();v=h.render(props);
  assert.equal(attached,1);assert.equal(blobCalls,0,'HLS does not enter the 128MiB Blob path');assert.equal(created,0);assert.equal(v.props['data-xclip-playback'],'stream');assert.equal(v.props.src,undefined);
  h.unmount();assert.equal(disposed,1);
  let active=0,signal;
  const reel=harness({sources:async(id,s)=>{signal=s;return {url:props.src,hlsUrl:'https://video.twimg.com/master.m3u8'};},attach:async(n,u,o)=>{active++;return ()=>{};},blob:async()=>{throw Error('no blob');}});
  v=reel.render({...props,recoverEnabled:false});v.props.ref(node);v.props.onError({currentTarget:node});await drain();assert.equal(active,0);
  reel.render({...props,recoverEnabled:true});reel.render({...props,recoverEnabled:true});await drain();assert.equal(active,1);
  reel.render({...props,recoverEnabled:false});assert.equal(signal.aborted,true);reel.unmount();
  let fallbackCount=0;
  const fallback=harness({sources:async()=>({url:props.src}),attach:async()=>{throw Error('must not attach');},blob:async()=>{fallbackCount++;return new Blob(['video']);}});
  v=fallback.render(props);v.props.ref(node);v.props.onError({currentTarget:node});fallback.render(props);await drain();v=fallback.render(props);assert.equal(fallbackCount,1);assert.equal(v.props['data-xclip-playback'],'blob');assert.equal(v.props.src,'blob:test-1');fallback.unmount();assert.deepEqual(revoked,['blob:test-1']);
  let delayedResolve;
  const delayed=harness({sources:()=>new Promise(resolve=>delayedResolve=resolve),attach:async()=>{throw Error('late attach');},blob:async()=>{throw Error('late blob');}});
  v=delayed.render(props);v.props.ref(node);v.props.onError({currentTarget:node});delayed.render(props);delayed.unmount();delayedResolve({url:props.src,hlsUrl:'https://video.twimg.com/master.m3u8'});await drain();assert.equal(created,1);
  let excludedBlob=0;
  const excluded=harness({sources:async()=>{throw Error('excluded [HTTP 404]');},attach:async()=>{},blob:async()=>excludedBlob++});
  v=excluded.render(props);v.props.ref(node);v.props.onError({currentTarget:node});excluded.render(props);await drain();v=excluded.render(props);assert.equal(excludedBlob,0);assert.equal(v.props['data-xclip-playback'],'failed');excluded.unmount();
  console.log('PASS STREAM COMPONENT: HLS skips whole-file/128MiB path; UI controls retained; inactive Reel no recovery; stop aborts; small-MP4 compatibility; Blob release; stale async discarded; excluded metadata never bypassed.');
 } finally {URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
})().catch(error=>{console.error(error);process.exitCode=1;});
