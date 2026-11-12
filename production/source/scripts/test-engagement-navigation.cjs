'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{NextRequest}=require('next/server');
const root=path.resolve(__dirname,'..');
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText)(resolve,m,m.exports);return m.exports;}
const navigation=load('lib/engagement-navigation.ts');
async function main(){
 const id='2061469959365280142';
 for(const url of ['/','/rising','/ranking/daily','/ranking/weekly','/reels','/browse','/accounts','/accounts/fixture','/accounts/id-123','/tags','/tags/'+encodeURIComponent('個人撮影'),'/tags/'+encodeURIComponent('タグ A'),'/p/'+id,'/download','/removal-request'])assert(navigation.publicEngagementPath(url),url);
 for(const url of ['/engagement-admin','/api/engagement','/review','/label-learning','/accounts/a/b','/p/0','/tags/%','/tags/%2Fhidden'])assert.equal(navigation.publicEngagementPath(url),null,url);
 for(const host of ['x.com','twitter.com','www.x.com','mobile.twitter.com'])for(const suffix of ['/i/status/'+id,'/i/web/status/'+id,'/fixture/status/'+id])assert.equal(navigation.outboundXEvent('https://'+host+suffix,'/p/'+id).xPostId,id);
 for(const url of ['https://x.com.evil.invalid/i/status/'+id,'javascript:alert(1)','/p/'+id,'https://example.invalid/','https://x.com@evil.invalid/'+id])assert.equal(navigation.outboundXEvent(url,'/rising'),null,url);
 const share=navigation.outboundXEvent('https://twitter.com/intent/tweet?url='+encodeURIComponent('https://twizou.net/p/'+id),'/rising');assert.equal(share.xPostId,id);assert.equal(share.source,'public_x_share');
 assert.equal(navigation.outboundXEvent('https://x.com/fixture','/accounts/fixture').eventType,'outbound_x');
 assert.equal(navigation.outboundXEvent('https://x.com/fixture/status/'+id,'/p/'+id,'?from='+encodeURIComponent('/ranking/daily?edition=fixture')).range,'daily');
 // Exercise the real root component with navigation changes and document-level event delivery.
 const saved={window:global.window,document:global.document,Element:global.Element,navigator:global.navigator,fetch:global.fetch};
 const events=[],pageEffects=[],mountEffects=[],refs=[],listeners=[];let currentPath='/rising',refIndex=0;
 class ElementFixture {constructor(anchor){this.anchor=anchor;}closest(){return this.anchor;}}
 const documentFixture=new EventTarget();
 const add=documentFixture.addEventListener.bind(documentFixture),remove=documentFixture.removeEventListener.bind(documentFixture);
 documentFixture.addEventListener=(type,fn,capture)=>{listeners.push({type,fn,capture});add(type,fn,{capture:Boolean(capture)});};
 documentFixture.removeEventListener=(type,fn,capture)=>{remove(type,fn,{capture:Boolean(capture)});};
 global.Element=ElementFixture;global.document=documentFixture;global.window={location:{pathname:currentPath,search:''}};
 const Component=load('app/components/EngagementVisitTracker.tsx',n=>n==='react'?{...React,useRef:initial=>{const i=refIndex++;return refs[i]??(refs[i]={current:initial});},useEffect:(fn,deps)=>{(deps.length?pageEffects:mountEffects).push(fn);}}:n==='next/navigation'?{usePathname:()=>currentPath}:n.endsWith('engagement-client')?{trackEngagement:p=>events.push(p)}:n.endsWith('engagement-navigation')?navigation:n.endsWith('public-return-navigation')?load('lib/public-return-navigation.ts'):require(n)).default;
 function renderAt(next){currentPath=next;global.window.location.pathname=next;refIndex=0;pageEffects.length=0;mountEffects.length=0;assert.equal(Component(),null);pageEffects.forEach(fn=>fn());}
 renderAt('/rising');pageEffects[0]();assert.equal(events.filter(e=>e.eventType==='page_view').length,1,'Strict effect does not duplicate');
 const cleanup=mountEffects[0]();assert.equal(listeners.length,2);assert(listeners.every(l=>l.capture===true));
 for(const next of ['/p/'+id,'/tags/'+encodeURIComponent('個人撮影'),'/accounts/fixture','/review','/rising'])renderAt(next);
 assert.deepEqual(events.filter(e=>e.eventType==='page_view').map(e=>e.metadata.path),['/rising','/p/'+id,'/tags/'+encodeURIComponent('個人撮影'),'/accounts/fixture','/rising']);
 function click(href,type='click',button=0,options={}){const anchor={href,hasAttribute:name=>Boolean(options.download&&name==='download')},child=new ElementFixture(anchor),event=new Event(type,{cancelable:true});Object.defineProperties(event,{target:{value:child},button:{value:button},ctrlKey:{value:Boolean(options.ctrlKey)}});if(options.prevented)event.preventDefault();documentFixture.dispatchEvent(event);return event;}
 let before=events.length;const clickEvent=click('https://x.com/i/status/'+id);assert.equal(events.length,before+1);assert.equal(events.at(-1).xPostId,id);assert.equal(clickEvent.defaultPrevented,false,'navigation retained');
 before=events.length;click('https://x.com/i/status/'+id,'click',1);click('https://x.com/i/status/'+id,'auxclick',1);assert.equal(events.length,before+1,'middle click counted once');
 before=events.length;click('https://x.com/i/status/'+id,'click',0,{ctrlKey:true});assert.equal(events.length,before+1);
 before=events.length;click('https://x.com/i/status/'+id,'auxclick',2);click('https://example.invalid');click('https://x.com/i/status/'+id,'click',0,{prevented:true});click('https://x.com/i/status/'+id,'click',0,{download:true});assert.equal(events.length,before);
 renderAt('/review');before=events.length;click('https://x.com/i/status/'+id);assert.equal(events.length,before,'admin click not counted');
 cleanup();renderAt('/rising');before=events.length;click('https://x.com/i/status/'+id);assert.equal(events.length,before,'unmount removes listeners');
 assert(!fs.readFileSync(path.join(root,'app/components/RankingClient.tsx'),'utf8').includes('eventType: "outbound_x"'),'legacy duplicate handlers removed');
 // Real browser transport -> actual POST handler -> in-memory events -> actual stats aggregation.
 class StorageFixture {constructor(){this.data=new Map();}getItem(k){return this.data.get(k)??null;}setItem(k,v){this.data.set(k,String(v));}removeItem(k){this.data.delete(k);}}
 const localStorage=new StorageFixture(),sessionStorage=new StorageFixture();global.window={location:{pathname:'/p/'+id,search:'?utm_source=x&utm_content=fixture'},localStorage,sessionStorage};global.document={referrer:'https://t.co/fixture'};
 const beacons=[];Object.defineProperty(global,'navigator',{configurable:true,value:{sendBeacon:(url,blob)=>{beacons.push({url,blob});return true;}}});
 const client=load('lib/engagement-client.ts',n=>n.endsWith('engagement-surface')?load('lib/engagement-surface.ts'):require(n));client.trackEngagement({eventType:'page_view',source:'site_visit',metadata:{path:'/p/'+id}});client.trackEngagement(navigation.outboundXEvent('https://x.com/i/status/'+id,'/p/'+id));client.trackEngagement(navigation.outboundXEvent('https://x.com/i/status/'+id,'/p/'+id));
 const rows=[],keys=new Set();let sideEffects=0;
 const db={from:table=>{assert.equal(table,'engagement_events');return{upsert:async(row,options)=>{assert.equal(options.ignoreDuplicates,true);if(!keys.has(row.dedupe_key)){keys.add(row.dedupe_key);rows.push({...row,occurred_at:new Date().toISOString()});}return{error:null};},select:()=>({gte:()=>({order:()=>({range:async()=>({data:rows,error:null})})})})};}};
 const post=load('app/api/engagement/route.ts',n=>n.endsWith('supabase-admin')?{supabaseAdmin:()=>db}:/manual-ranking\/route$|free-curated-sync\/route$/.test(n)?{POST:async()=>{sideEffects++;throw Error('UNEXPECTED_WRITE');}}:require(n));
 for(const beacon of beacons){assert.equal(beacon.url,'/api/engagement');const body=await beacon.blob.text();const result=await post.POST(new NextRequest('https://twizou.net/api/engagement',{method:'POST',headers:{origin:'https://twizou.net','content-type':'application/json'},body}));assert.equal(result.status,200);}
 assert.equal(rows.length,2,'existing five-minute outbound dedupe retained');assert.equal(rows.filter(r=>r.event_type==='outbound_x').length,1);assert.equal(rows[1].x_post_id,id);assert.equal(rows[1].metadata.utmSource,'x');assert.equal(rows[0].metadata.landingPath,'/p/'+id);assert.equal(sideEffects,0);
 const stats=load('app/api/engagement-stats/route.ts',n=>n.endsWith('supabase-admin')?{supabaseAdmin:()=>db}:n.endsWith('cron-auth')?{isCronAuthorized:()=>true}:n.endsWith('error-message')?{errorMessage:()=> 'fixture error'}:n.endsWith('engagement-retention')?load('lib/engagement-retention.ts',n=>n.endsWith('engagement-surface')?load('lib/engagement-surface.ts'):require(n)):require(n));
 const response=await stats.GET(new NextRequest('https://twizou.net/api/engagement-stats'));assert.equal(response.status,200);const data=await response.json();assert.equal(data.totals.outboundX,1);assert.equal(data.totals.users,1);assert.equal(data.totals.sessions,1);assert.equal(data.totals.xSessions,1);assert.equal(data.daily[0].outboundX,1);
 const fallback=[];Object.defineProperty(global,'navigator',{configurable:true,value:{sendBeacon:()=>false}});global.fetch=async(url,init)=>{fallback.push({url,init});return Response.json({ok:true});};client.trackEngagement({eventType:'outbound_x',xPostId:id});assert.equal(fallback.length,1);assert.equal(fallback[0].init.keepalive,true);
 for(const [key,value]of Object.entries(saved))if(key==='navigator')Object.defineProperty(global,key,{configurable:true,value});else if(value===undefined)delete global[key];else global[key]=value;
 console.log('PASS ENGAGEMENT NAVIGATION: public landing/SPA paths, capture/normal/middle/modified X clicks, no admin/manual/legacy duplicates, cleanup and navigation preserved; real beacon/fetch transport -> real event API -> real daily stats with in-memory dedupe/DB only. No live writes.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
