'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {createVerifier,wrapVerifiedGooglebot,probeRecord,MARKER}=require('./verified-googlebot.cjs');
const {requestKey}=require('./public-response-cache.cjs');
async function main(){
  let lookups=0;
  const verify=createVerifier({
    reverse:async ip=>{lookups++;return ip==='66.249.66.1'?['crawl-66-249-66-1.googlebot.com']:['crawl-66-249-66-1.googlebot.com'];},
    lookup:async()=>[{address:'66.249.66.1'}],
  });
  const base={'user-agent':'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'};
  assert.equal(await verify({headers:{...base,'x-forwarded-for':'66.249.66.1'}}),false);
  assert.equal(await verify({headers:{...base,'!~passenger-client-address':'66.249.66.1'}}),true);
  assert.equal(await verify({headers:{...base,'!~passenger-client-address':'66.249.66.1'}}),true);
  assert.equal(lookups,1);
  assert.equal(await verify({headers:{...base,'!~passenger-client-address':'192.0.2.4'}}),false);
  assert.equal(await verify({headers:{...base,'!~passenger-client-address':'66.249.66.1, 192.0.2.4'}}),false);
  assert.equal(await verify({headers:{'user-agent':'Mozilla/5.0','!~passenger-client-address':'66.249.66.1'}}),false);
  const captured=[];
  const handler=wrapVerifiedGooglebot((req)=>captured.push(req.headers[MARKER]),{verify});
  await new Promise(resolve=>{handler({method:'GET',url:'/p/12345',headers:{...base,[MARKER]:'1','x-forwarded-for':'66.249.66.1'}},{});setImmediate(resolve);});
  assert.equal(captured.pop(),undefined);
  await new Promise(resolve=>{handler({method:'GET',url:'/p/12345',headers:{...base,'!~passenger-client-address':'66.249.66.1'}},{});setImmediate(resolve);});
  assert.equal(captured.pop(),'1');
  assert.equal(requestKey({method:'GET',url:'/',headers:{host:'twizou.net',[MARKER]:'1'}}),null);
  const probe=probeRecord({headers:{'!~passenger-client-address':'66.249.66.64','x-forwarded-for':'66.249.66.64, 192.0.2.1'},socket:{remoteAddress:'127.0.0.1'}},false,21.6);
  assert.equal(probe.protectedAddress,'66.249.66.64');
  assert.equal(probe.forwardedFirst,'66.249.66.64');
  assert.equal(probe.socketAddress,'127.0.0.1');
  assert.equal(probe.verified,false);
  assert.equal(probe.durationMs,22);
  const gateSource=fs.readFileSync(path.join(__dirname,'../app/components/AgeGate.tsx'),'utf8');
  const gateModule={exports:{}};
  const js=ts.transpileModule(gateSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',js)((name)=>{
    if(name==='next/navigation')return{usePathname:()=>'/p/12345'};
    if(name==='next/link')return{__esModule:true,default:({href,children})=>React.createElement('a',{href},children)};
    return require(name);
  },gateModule,gateModule.exports);
  const Gate=gateModule.exports.default;
  assert.equal(renderToStaticMarkup(React.createElement(Gate)), '');
  assert.match(renderToStaticMarkup(React.createElement(Gate,{forceForPost:true})),/class="age-gate"/);
  assert.equal(renderToStaticMarkup(React.createElement(Gate,{forceForPost:true,verifiedGooglebot:true})), '');
  console.log('VERIFIED_GOOGLEBOT_TEST_OK');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
