'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=p.resolve(__dirname,'..');
function load(file,resolve=require){resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(p.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(resolve,m,m.exports);return m.exports;}
const nav=load('lib/public-return-navigation.ts'),id='2110528771107492016',other='2110528771107492017';
const record=(overrides={})=>JSON.stringify({version:1,from:'/?page=7&edition=snapshot_123',postId:id,y:4200,at:Date.now(),restore:false,...overrides});
for(const from of ['/', '/rising', '/?page=7&edition=snapshot_123','/tags/3P?page=2','https://evil.invalid'])assert.equal(nav.publicDetailHref(id,from),'/p/'+id);
assert.throws(()=>nav.publicDetailHref('../private'));
assert.equal(nav.publicReturnForPost(id,null,record()),'/?page=7&edition=snapshot_123');
assert.equal(nav.publicReturnForPost(other,null,record()),null,'A direct visit must not inherit another video return target');
assert.equal(nav.publicReturnForPost(id,null,record({restore:true})),null);
assert.equal(nav.publicReturnForPost(id,null,record({at:Date.now()-86400001})),null);
assert.equal(nav.publicReturnForPost(id,null,record({from:'//evil.invalid'})),null);
assert.equal(nav.publicReturnForPost(id,'/ranking/daily',record()),'/ranking/daily','Legacy explicit return retains priority');
assert.equal(nav.publicReturnForPost(id,'https://evil.invalid',null),null);
const outbound=load('lib/engagement-navigation.ts');assert.equal(outbound.outboundXEvent('https://x.com/i/status/'+id,'/p/'+id,'','/ranking/weekly').range,'weekly');
const stored=new Map(),replace=[],nativeReplace=[],tracked=[];global.sessionStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
global.window={addEventListener(){},removeEventListener(){},location:{href:'https://twizou.net/?page=7&edition=snapshot_123',replace:t=>nativeReplace.push(t)},scrollY:4200};
let slots=[],index=0,effects=[],lastLink;
const hooks={useRef(initial){const i=index++;return slots[i]??(slots[i]={current:initial});},useState(initial){const i=index++;slots[i]??={value:initial};return[slots[i].value,v=>{slots[i].value=v;}];},useEffect(fn,deps){const i=index++;if(!slots[i]||deps.some((v,j)=>v!==slots[i].deps[j])){slots[i]={deps};effects.push(fn);}}};
const Link=props=>{lastLink=props;return React.createElement('a',{href:props.href,'aria-label':props['aria-label']},props.children);};
const resolve=name=>name==='react'?hooks:name==='next/link'?{__esModule:true,default:Link}:name==='next/navigation'?{useRouter:()=>({replace:(...a)=>replace.push(a)})}:name.endsWith('public-return-navigation')?nav:name.endsWith('engagement-client')?{trackEngagement:e=>tracked.push(e),createEngagementEventId:()=>"fixture-event-id"}:require(name);
const Open=load('app/components/PublicPostLink.tsx',resolve).default,Close=load('app/components/PublicPostClose.tsx',resolve).default,Engagement=load('app/components/PublicPostEngagement.tsx',resolve).default;
const openProps={id,returnTo:'/',children:'動画を開く'};
let html=renderToStaticMarkup(React.createElement(Open,openProps));assert(html.includes('href="/p/'+id+'"'));assert(!html.includes('?from='));lastLink.onClick({button:0,preventDefault(){}});
assert.equal(JSON.parse(stored.get(nav.RETURN_STORAGE_KEY)).from,'/?page=7&edition=snapshot_123');assert.equal(JSON.parse(stored.get(nav.RETURN_STORAGE_KEY)).y,4200);
const render=(Component,props,reset=false)=>{if(reset)slots=[];index=0;effects=[];const tree=Component(props);const output=tree?renderToStaticMarkup(tree):'';for(const fn of effects)fn();return output;};
render(Close,{postId:id},true);html=render(Close,{postId:id});assert(html.includes('href="/?page=7&amp;edition=snapshot_123"'));
let prevented=false;lastLink.onClick({button:0,preventDefault(){prevented=true;}});assert(prevented);assert.deepEqual(replace.at(-1),['/?page=7&edition=snapshot_123',{scroll:false}]);assert.equal(JSON.parse(stored.get(nav.RETURN_STORAGE_KEY)).restore,true);
// An unrelated clean direct visit must use the default close link even if storage exists.
render(Close,{postId:other},true);html=render(Close,{postId:other});assert(html.includes('href="/"'));
// Related video navigation carries the original list position forward under the new post ID.
stored.set(nav.RETURN_STORAGE_KEY,record());window.location.href='https://twizou.net/p/'+id;
renderToStaticMarkup(React.createElement(Open,{...openProps,id:other}));lastLink.onClick({button:0,preventDefault(){}});const next=JSON.parse(stored.get(nav.RETURN_STORAGE_KEY));assert.equal(next.postId,other);assert.equal(next.y,4200);assert.equal(next.from,'/?page=7&edition=snapshot_123');
// Tracking range survives removing the query parameter; the existing single effect remains single.
stored.set(nav.RETURN_STORAGE_KEY,record({from:'/ranking/weekly',postId:other}));render(Engagement,{postId:other,sourcePage:null},true);render(Engagement,{postId:other,sourcePage:null});assert.equal(tracked.length,1);assert.equal(tracked[0].range,'weekly');
render(Engagement,{postId:id,sourcePage:'/ranking/daily'},true);assert.equal(tracked.at(-1).range,'daily');
// Storage unavailable still leaves a usable link and legacy URL navigation fallback.
global.sessionStorage={getItem(){throw Error('disabled');},setItem(){throw Error('disabled');}};
renderToStaticMarkup(React.createElement(Open,openProps));assert.doesNotThrow(()=>lastLink.onClick({button:0,preventDefault(){}}));render(Close,{postId:id,returnTo:'/ranking/daily'},true);html=render(Close,{postId:id,returnTo:'/ranking/daily'});assert(html.includes('href="/ranking/daily"'));
const page=fs.readFileSync(p.join(root,'app/p/[id]/page.tsx'),'utf8');assert(page.indexOf('className="public-post-player"')<page.indexOf('className="public-post-actions"'));assert(page.includes('postId={v.id} returnTo={sourcePage ?? undefined}'));assert(page.includes('canonical: d.metadata.canonical'));
delete global.window;delete global.sessionStorage;
console.log('PASS GSC WATCH: clean SSR links, legacy/safe return, page+edition+scroll restore, related transfer, unrelated/expired context rejection, storage-disabled fallback, analytics range and single event, prominent player. No network/media/DB.');
