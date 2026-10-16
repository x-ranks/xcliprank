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
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 let created=0,revoked=[],calls=0,release,signal;
 URL.createObjectURL=()=>('blob:canonical-'+(++created));URL.revokeObjectURL=u=>revoked.push(u);
 const props={src:'https://video.twimg.com/a.mp4',postId:'21',controls:true};
 const node={error:{code:4},play:async()=>{}};
 try{
  const h=harness({sources:async()=>({url:props.src}),attach:async()=>{throw Error('NO_HLS');},blob:async()=>{calls++;return new Blob(['video']);}});
  let v=h.render(props);assert.equal(v.props.src,props.src);assert.equal(v.props.controls,true);assert.equal(v.props.crossOrigin,'anonymous');v.props.ref(node);
  v.props.onError({currentTarget:node});v.props.onError({currentTarget:node});h.render(props);await drain();v=h.render(props);
  assert.equal(calls,1);assert.equal(v.props.src,'blob:canonical-1');h.unmount();assert.deepEqual(revoked,['blob:canonical-1']);
  const pending=harness({sources:async()=>({url:props.src}),attach:async()=>{throw Error('NO_HLS');},blob:(u,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);}});
  v=pending.render(props);v.props.ref(node);v.props.onError({currentTarget:node});pending.render(props);await drain();assert.equal(signal.aborted,false);
  pending.unmount();assert.equal(signal.aborted,true);release(new Blob(['old']));await drain();assert.equal(created,1);
  console.log('PASS PLAYBACK COMPONENT: current MP4/HLS imports; native source and controls, single Blob fallback, abort and stale Blob refusal, URL revocation.');
 }finally{URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
})().catch(e=>{console.error(e);process.exitCode=1;});
