const fs=require('fs'), assert=require('node:assert/strict');
const root=require('node:path').resolve(__dirname,'..');
const ts=require(root+'/node_modules/typescript');
const {NextRequest,NextResponse}=require(root+'/node_modules/next/server');
const since=new Date(Math.floor(Date.now()/300000)*300000-86400000).toISOString();
const rows=Array.from({length:400},(_,i)=>({x_post_id:String(1000+i),author_id:String(i%30),adult_tier:i<200?'S':'A',manual_tier:null,effective_adult_score:0.8,created_at:new Date(Date.parse(since)-86400000-i*1000).toISOString(),is_visible:true,moderation_blocked:false,review_required:false,video_url:'https://video.twimg.com/test.mp4',content_category:'PASS',score:400-i}));
for(let i=0;i<10;i++) rows.push({...rows[i],x_post_id:String(10000+i),adult_tier:'B',created_at:new Date(Date.parse(since)+3600000+i*1000).toISOString()});
rows.push({...rows[0],x_post_id:'blocked',moderation_blocked:true});
let queries=0;
function from(table){let data=table==='authors'?Array.from({length:30},(_,i)=>({x_author_id:String(i),is_curated:true,curated_status:'active'})):[...rows];let orders=[];
 const q={select(){return q;},eq(k,v){data=data.filter(p=>p[k]===v);return q;},not(k,op,v){data=data.filter(p=>p[k]!==v);return q;},or(expr){if(expr.includes('adult_tier.in.')){const tiers=expr.match(/adult_tier.in.\(([^)]+)\)/)[1].split(',');data=data.filter(p=>tiers.includes(p.adult_tier)||tiers.includes(p.manual_tier));}return q;},in(k,v){data=data.filter(p=>v.includes(p[k]));return q;},gte(k,v){data=data.filter(p=>p[k]>=v);return q;},lt(k,v){data=data.filter(p=>p[k]<v);return q;},order(k,{ascending}){orders.push([k,ascending]);return q;},range(a,b){queries++;data.sort((a,b)=>{for(const[k,asc]of orders){const d=a[k]<b[k]?-1:a[k]>b[k]?1:0;if(d)return asc?d:-d;}return 0;});return Promise.resolve({data:data.slice(a,b+1),error:null});},then(a,b){return Promise.resolve({data,error:null}).then(a,b);}};return q;}
function load(file,requireFn){const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(requireFn,m,m.exports);return m.exports;}
const liquidity=load('lib/ranking-liquidity.ts',require);
const cache=new Map();
const route=load('app/api/rankings/route.ts',name=>{
 if(name==='next/server') return {NextRequest,NextResponse};
 if(name==='next/cache') return {unstable_cache:fn=>(...args)=>{const key=JSON.stringify(args);if(!cache.has(key))cache.set(key,fn(...args));return cache.get(key);}};
 if(name.endsWith('ranking-liquidity'))return liquidity;
 if(name.endsWith('supabase-admin'))return {supabaseAdmin:()=>({from})};
 if(name.endsWith('content-filter'))return {classifyContent:()=>({category:'PASS'})};
 throw Error('Unexpected module '+name);
});
delete process.env.RANKINGS_SOURCE_URL;
(async()=>{
 const [n,d]=await Promise.all(['trending','daily'].map(async range=>{const r=await route.GET(new NextRequest('http://internal.local/api/rankings?range='+range));assert.equal(r.status,200);return r.json();}));
 assert.equal(n.count,100);assert.equal(n.liquidity.newRecent,10);assert.equal(n.liquidity.newArchive,90);assert.equal(d.count,100);assert.equal(d.liquidity.dailyFixedArchive,85);assert.equal(d.liquidity.dailyExtraArchive,15);
 const ids=new Set(n.data.map(p=>p.x_post_id));assert.equal(d.data.filter(p=>ids.has(p.x_post_id)).length,0);assert.ok(![...n.data,...d.data].some(p=>p.x_post_id==='blocked'));
 assert.equal(queries,2,'both requests share one DB candidate plan');
 console.log('PASS: actual ranking route with mocked DB; 10+90 / 85+15; shared plan; blocked excluded; overlap=0');
})().catch(e=>{console.error(e);process.exitCode=1;});
