const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),ts=require(root+'/node_modules/typescript');
const {NextRequest,NextResponse}=require(root+'/node_modules/next/server');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-newest500-test-'));
process.env.XCLIP_RANKING_FEED_STATE_DIR=path.join(scratch,'editions');
process.env.XCLIP_AUTHOR_STATE_DIR=path.join(scratch,'authors');
process.env.XCLIP_FREE_CURATED_STATE_DIR=path.join(scratch,'curated');
delete process.env.RANKINGS_SOURCE_URL;
global.fetch=()=>{throw Error('UNEXPECTED_REAL_HTTP');};
function load(file,resolve=require){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
const liquidity=load('lib/ranking-liquidity.ts'),feed=load('lib/newest-feed.ts'),pagination=load('lib/ranking-pagination.ts');
const editions=load('lib/ranking-editions.ts',n=>n==='./ranking-liquidity'?liquidity:require(n));
const authorStatus=load('lib/author-status.ts'),postStatus=load('lib/post-status.ts',n=>n==='./author-status'?authorStatus:require(n));
const clock=liquidity.liquidityClock(),before=Date.parse(clock.since);
const authors=Array.from({length:100},(_,i)=>({x_author_id:String(100+i),is_curated:true,curated_status:'active'}));
const make=(i,days,tier)=>({x_post_id:String(100000+i),author_id:String(100+i%100),author_username:'a'+i%100,author_name:'fixture',adult_tier:tier,manual_tier:null,effective_adult_score:0.8,score:3000-i,created_at:new Date(clock.snapshot-days*86400000-i*1000).toISOString(),x_url:'https://x.com/fixture/status/'+(100000+i),video_url:'https://video.twimg.com/ext_tw_video/'+(900000+i)+'/pu/vid/test.mp4',preview_image_url:null,content_category:'PASS',is_visible:true,moderation_blocked:false,review_required:false,views:1,likes:0,reposts:0,replies:0,visual_preference_score:i%7});
const rows=[...Array.from({length:230},(_,i)=>make(i,0.1,i%5===0?'B':'A')),...Array.from({length:1800},(_,i)=>make(300+i,3,i%3===0?'S':'A'))];
let blocked=new Set(),queries=0,dbFailure=false;
function from(table){let data=table==='authors'?[...authors]:[...rows],orders=[];
 const q={select(){return q;},eq(k,v){data=data.filter(p=>p[k]===v);return q;},not(k,op,v){data=data.filter(p=>p[k]!==v);return q;},or(expr){const m=expr.match(/adult_tier.in.\(([^)]+)\)/);if(m)data=data.filter(p=>m[1].split(',').includes(p.adult_tier)||m[1].split(',').includes(p.manual_tier));const manual=expr.match(/manual_tier.is.null,manual_tier.in.\(([^)]+)\)/);if(manual)data=data.filter(p=>p.manual_tier==null||manual[1].split(',').includes(p.manual_tier));return q;},in(k,v){if(k==='x_post_id')assert(v.length<=100,'PostgREST ID batches stay bounded');data=data.filter(p=>v.includes(p[k]));return q;},gte(k,v){data=data.filter(p=>p[k]>=v);return q;},lt(k,v){data=data.filter(p=>p[k]<v);return q;},order(k,{ascending}){orders.push([k,ascending]);return q;},range(a,b){queries++;data.sort((a,b)=>{for(const[k,asc]of orders){const d=a[k]<b[k]?-1:a[k]>b[k]?1:0;if(d)return asc?d:-d;}return 0;});return Promise.resolve({data:data.slice(a,b+1),error:dbFailure?{message:'PRIVATE_DB_ERROR'}:null});},then(a,b){return Promise.resolve({data,error:dbFailure?{message:'PRIVATE_DB_ERROR'}:null}).then(a,b);}};return q;}
function newRoute(){return load('app/api/rankings/route.ts',n=>{
 if(n==='next/server')return {NextRequest,NextResponse};
 if(n.endsWith('ranking-liquidity'))return liquidity;
 if(n.endsWith('ranking-editions'))return editions;
 if(n.endsWith('newest-feed'))return feed;
 if(n.endsWith('ranking-pagination'))return pagination;
 if(n.endsWith('ranking-update'))return load('lib/ranking-update.ts',require);
 if(n.endsWith('post-status-store'))return {unavailableKeys:async()=>new Set(blocked)};
 if(n.endsWith('post-status'))return postStatus;
 if(n.endsWith('supabase-admin'))return {supabaseAdmin:()=>({from})};
 if(n.endsWith('content-filter'))return {classifyContent:text=>({category:text==='excluded'?'SAFETY_REVIEW':'PASS'})};
 if(n.endsWith('public-ranking-history'))return load('lib/public-ranking-history.ts',id=>id.endsWith('public-video-core')?load('lib/public-video-core.ts'):require(id));
 if(n.endsWith('public-catalog-store'))return {createPublicCatalog:()=>({ranked:async()=>{}})};
 if(n.endsWith('public-save-secret'))return {publicCatalogDirectory:()=>'/isolated-mock-catalog'};
 throw Error('Unexpected module '+n);
});}
let route=newRoute();
async function get(query){const r=await route.GET(new NextRequest('http://internal.local/api/rankings?'+query));return {status:r.status,...await r.json()};}
(async()=>{
 const [n,d,w]=await Promise.all(['trending','daily','weekly'].map(r=>get('range='+r)));
 assert.equal(n.status,200);assert.equal(typeof n.rankingUpdatedAt,'string');assert.equal(n.rankingUpdatedAt,d.rankingUpdatedAt);assert.equal(n.rankingUpdatedAt,w.rankingUpdatedAt);assert.equal(n.rankingSnapshotAt,new Date(clock.snapshot).toISOString());assert.equal(n.count,500);assert.equal(d.count,100);assert.equal(w.count,100);assert.equal(n.liquidity.dailyFixedArchive,85);
 const wb=await get('range=weekly&visual=0&edition='+n.edition);
 const reserved=new Set([...d.data,...w.data,...wb.data].map(p=>p.x_post_id));
 assert(n.data.every(p=>!reserved.has(p.x_post_id)));assert.equal(new Set(n.data.map(p=>p.x_post_id)).size,500);
 assert.equal(n.data.filter(p=>!p.ranking_supplemented).length,n.liquidity.newRecent);
 assert(n.data.filter(p=>p.ranking_supplemented).every(p=>['S','A+','A'].includes(p.adult_tier)));
 const counts=new Map();n.data.forEach(p=>counts.set(p.author_id,(counts.get(p.author_id)||0)+1));assert([...counts.values()].every(v=>v<=20));
 const pages=[];for(let p=1;p<=10;p++)pages.push(await get('range=trending&page='+p+'&edition='+n.edition));
 assert(pages.every(p=>p.count===50));assert(pages.every(p=>p.rankingUpdatedAt===n.rankingUpdatedAt));assert.deepEqual(pages.flatMap(p=>p.data.map(r=>r.x_post_id)),n.data.map(r=>r.x_post_id));
 assert.equal(pages[9].pagination.nextHref,null);assert.equal(pages[0].pagination.previousHref,null);assert.equal(pages[1].data[0].ranking_position,51);
 for(const invalid of ['0','11','-1','1.5','01',''])assert.equal((await get('range=trending&page='+invalid)).status,400);
 assert.equal((await get('range=daily&page=2')).status,400);assert.equal((await get('range=trending&edition=../../bad')).status,400);
 const old=new Date(clock.snapshot-25*3600000).getTime();assert.equal((await get('range=trending&edition='+old+'-aaaaaaaaaaaa')).status,410);
 const observed=pages[1].data.map(p=>p.x_post_id),removed=pages[1].data[0].x_post_id;
 blocked.add('post:'+removed);rows.push({...make(9000,0,'S'),created_at:new Date(clock.snapshot-1).toISOString()});
 const hidden=rows.find(p=>p.x_post_id===pages[1].data[1].x_post_id);hidden.is_visible=false;
 const paused=authors.find(a=>a.x_author_id===pages[1].data[2].author_id);paused.curated_status='paused';
 route=newRoute(); // restart: immutable on-disk edition, not the in-memory candidate order.
 const after=await get('range=trending&page=2&edition='+n.edition);
 assert.equal(after.rankingUpdatedAt,n.rankingUpdatedAt);assert(after.data.every(p=>observed.includes(p.x_post_id)));assert(!after.data.some(p=>p.x_post_id===removed||p.x_post_id===hidden.x_post_id||p.author_id===paused.x_author_id));
 assert(after.data.every(p=>p.ranking_position>=51&&p.ranking_position<=100));
 const file=path.join(process.env.XCLIP_RANKING_FEED_STATE_DIR,n.edition+'.json'),bytes=fs.readFileSync(file);
 assert(!bytes.includes(Buffer.from('video.twimg.com')));assert(!bytes.includes(Buffer.from('PRIVATE_DB_ERROR')));
 const collision={...JSON.parse(bytes),metadata:{test:'loser'}};const winner=await editions.saveEdition(collision);assert.notEqual(winner.metadata.test,'loser');assert.deepEqual(fs.readFileSync(file),bytes);
 const legacy=JSON.parse(bytes);delete legacy.metadata.generatedAt;fs.writeFileSync(file,JSON.stringify(legacy));const legacyBytes=fs.readFileSync(file);route=newRoute();
 const legacyResult=await get('range=weekly&edition='+n.edition);assert.equal(legacyResult.rankingUpdatedAt,null);assert.equal(legacyResult.rankingSnapshotAt,new Date(clock.snapshot).toISOString());assert(fs.readFileSync(file).equals(legacyBytes));fs.writeFileSync(file,bytes);
 fs.writeFileSync(file,'invalid');route=newRoute();assert.equal((await get('range=trending&page=2&edition='+n.edition)).status,503);assert.equal(fs.readFileSync(file,'utf8'),'invalid');fs.writeFileSync(file,bytes);
 dbFailure=true;route=newRoute();const failure=await get('range=trending&page=2&edition='+n.edition);assert.equal(failure.status,503);assert.equal(failure.error,'RANKING_LOAD_FAILED');dbFailure=false;
 const oneAuthor=Array.from({length:50},(_,i)=>({...make(10000+i,0,'A'),author_id:i<10?'A':String(i)}));
 const spread=feed.spreadAuthors(oneAuthor,'seed');const indices=spread.flatMap((p,i)=>p.author_id==='A'?[i]:[]);assert(indices.at(-1)-indices[0]>35);assert(!indices.slice(1).some((v,i)=>v===indices[i]+1));
 assert.deepEqual(feed.spreadAuthors(oneAuthor,'seed'),spread);assert.notDeepEqual(feed.spreadAuthors(oneAuthor,'different'),spread);
 const sameMedia=[make(12000,0,'A'),{...make(12001,0,'A'),video_url:make(12000,0,'A').video_url+'?tag=12'}];assert.equal(feed.buildNewestFeed(sameMedia,[],new Set(),'seed').posts.length,1);
 assert.equal(feed.buildNewestFeed([],[],new Set(),'seed').shortfall,500);
 console.log('PASS NEWEST500: actual route with mocked DB; 500=recent+archive; daily85 preserved; weekly visual variants excluded; 10x50 unique; positions; author dispersion; pinned restart/order; current blocks/visibility/pause; media dedup; corrupt/race/error guards; zero live HTTP/DB.');
})().catch(e=>{console.error(e);process.exitCode=1;});
