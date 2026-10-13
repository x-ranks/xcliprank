const fs=require('node:fs'),assert=require('node:assert/strict'),ts=require('typescript');
const component=ts.transpileModule(fs.readFileSync('app/components/DirectPlaybackVideo.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(recover){
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
  if(name.includes('browser-playback-recovery'))return {recoverDirectPlayback:recover};
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
 URL.createObjectURL=()=>`blob:local-${++created}`;URL.revokeObjectURL=url=>revoked.push(url);
 try{
  const props={src:'https://video.twimg.com/a.mp4',postId:'21',controls:true};let calls=0;
  const h=harness(async()=>{calls++;return new Blob(['video']);});let v=h.render(props);
  assert.equal(v.props.src,props.src);assert.equal(v.props.crossOrigin,'anonymous');assert.equal(v.props.controls,true);
  v.props.ref({error:{code:4}});v.props.onError({currentTarget:{error:{code:4}}});v.props.onError({});await drain();v=h.render(props);
  assert.equal(calls,1);assert.match(v.props.src,/^blob:local/);h.unmount();assert.deepEqual(revoked,['blob:local-1']);
  let release,signal;
  const pending=harness((u,id,s)=>{signal=s;return new Promise(resolve=>release=resolve);});
  v=pending.render(props);v.props.ref({error:{code:2}});v.props.onError({});assert.equal(signal.aborted,false);
  pending.unmount();assert.equal(signal.aborted,true);release(new Blob(['old']));await drain();assert.equal(created,1,'No object URL for unmounted result');
  let activeCalls=0,reelSignal,finish;
  const reel=harness((u,id,s)=>{activeCalls++;reelSignal=s;return new Promise(resolve=>finish=resolve);});
  v=reel.render({...props,recoverEnabled:false});v.props.ref({error:{code:2}});v.props.onError({});assert.equal(activeCalls,0);
  reel.render({...props,recoverEnabled:true});assert.equal(activeCalls,1);
  reel.render({...props,recoverEnabled:false});assert.equal(reelSignal.aborted,true);finish(new Blob(['old']));await drain();assert.equal(created,1);reel.unmount();
  console.log('PASS PLAYBACK COMPONENT: native src/CORS; single retry; browser Blob src; cleanup/revocation; abort/stale result protection; active Reel only.');
 }finally{URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
})().catch(error=>{console.error(error);process.exitCode=1;});
