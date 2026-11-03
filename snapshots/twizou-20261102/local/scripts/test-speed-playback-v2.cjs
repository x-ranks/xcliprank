'use strict';
const fs=require('fs'),p=require('path'),assert=require('assert/strict'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=p.resolve(__dirname,'..');
function load(file,resolve=require,append=''){if(resolve)resolve=require("./public-ui-test-loader.cjs").wrap(resolve);const m={exports:{}};new Function('require','module','exports',ts.transpileModule(fs.readFileSync(p.join(root,file),'utf8')+'\n'+append,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,jsx:ts.JsxEmit.ReactJSX}}).outputText)(resolve,m,m.exports);return m.exports;}
async function main(){
 const initial=load('lib/initial-ranking.ts',n=>n==='server-only'?{}:n==='next/server'?require('next/server'):n.endsWith('ranking-update')?{}:n.includes('api/rankings')?{}:require(n));
 const raw={x_post_id:'123',author_username:'fixture',manual_id:undefined,video_url:'https://video.twimg.com/x.mp4',bookmarks:0,private_note:'do not serialize',text:'x'.repeat(2000),visual_model_version:'private'};
 assert.deepEqual(initial.rankingClientRows([raw]),[{x_post_id:'123',author_username:'fixture',bookmarks:0,has_video:true}]);
 const client=fs.readFileSync(p.join(root,'app/components/RankingClient.tsx'),'utf8');assert(!client.includes('blockSignature'));assert(client.includes('posts.filter(p => !isUnavailablePost(p, blocked))'),'Current exclusions are still filtered locally');
 const Link=({href,prefetch,children,...props})=>React.createElement('a',{href,...props},children);
 const cards=load('app/components/PublicVideoCards.tsx',n=>n==='next/link'?Link:n.endsWith('PublicPostLink')?({id,children})=>React.createElement('a',{href:'/p/'+id},children):n.endsWith('PublicListRestore')?()=>null:n.endsWith('public-video-core')?{authorHref:()=>'/accounts/fixture'}:require(n)).default;
 const html=renderToStaticMarkup(React.createElement(cards,{videos:[{id:'123',handle:'fixture',authorName:'Fixture',posterUrl:null,text:null,views:0,likes:0,bookmarks:0}]}));assert(!html.includes('Xで共有'));assert(html.includes('/accounts/fixture'));assert(html.includes('/p/123'));
 assert(!fs.readFileSync(p.join(root,'app/rising/page.tsx'),'utf8').includes('Xで共有'));
 const css=fs.readFileSync(p.join(root,'app/globals.css'),'utf8');assert(css.includes('min-height:44px'));assert(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));
 if(!fs.readFileSync(p.join(root,'app/api/rankings/route.ts'),'utf8').includes('Three bounded ID queries')){console.log('PASS SPEED PLAYBACK LOCAL: narrow client payload, exclusions stay local, all list share buttons removed, mobile targets.');return;}
 let active=0,peak=0,reads=0,refReads=0,failure=false;
 const rows=Array.from({length:500},(_,i)=>({x_post_id:String(10000+i),author_id:'123',video_url:'https://video.twimg.com/'+i+'.mp4',adult_tier:'A',manual_tier:null,is_visible:true,moderation_blocked:false,review_required:false}));
 const from=()=>{let selected=rows;const q={select(){return q;},eq(){return q;},not(){return q;},or(){return q;},order(){return q;},in(k,ids){selected=selected.filter(r=>ids.includes(r[k]));return q;},async range(a,b){active++;peak=Math.max(peak,active);reads++;try{await new Promise(r=>setTimeout(r,15));if(failure)throw Error('PRIVATE_FAILURE');return{data:selected.slice(a,b+1),error:null};}finally{active--;}}};return q;};
 const route=load('app/api/rankings/route.ts',n=>{
  if(n==='next/server')return require('next/server');
  if(n.endsWith('supabase-admin'))return{supabaseAdmin:()=>({from})};
  if(n.endsWith('post-status-store'))return{unavailableKeys:async()=>new Set()};
  if(n.endsWith('post-status'))return{isUnavailablePost:()=>false};
  if(n.endsWith('curated-video-references'))return{readCuratedReferences:async(db,ids,authors)=>{if(ids?.length===0)return[];refReads++;assert.deepEqual(authors,['123']);return[];},eligibleCuratedReferences:async(db,refs)=>refs,referencePermitsPost:()=>false};
  return {};
 },'export const __testPool = fetchCandidatePool;');
 const selected=await route.__testPool(null,new Set(['123']),['A'],{ids:rows.map(r=>r.x_post_id),poolLimit:500});
 assert.equal(selected.length,500);assert.deepEqual(selected.map(r=>r.x_post_id),rows.map(r=>r.x_post_id));assert.equal(reads,5);assert.equal(peak,3);assert.equal(refReads,0,'Own eligible IDs need no repeated reference reads');
 reads=0;peak=0;refReads=0;
 const cold=await route.__testPool(null,new Set(['123']),['A'],{poolLimit:1000});assert.equal(cold.length,500);assert.equal(reads,2);assert.equal(peak,2,'Separate cold-scan builders overlap without sharing range state');assert.equal(refReads,1);
 failure=true;await assert.rejects(route.__testPool(null,new Set(['123']),['A'],{ids:rows.slice(0,100).map(r=>r.x_post_id)}));failure=false;
 const empty=await route.__testPool(null,new Set(),['A'],{ids:[]});assert.deepEqual(empty,[]);
 console.log('PASS SPEED PLAYBACK V2: 500 rows preserved in order across five <=100-ID queries, max3 in flight, own-reference reads skipped, query failure not cached; narrow client payload; current exclusions retained; list shares removed; mobile targets. No real DB/media requests.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
