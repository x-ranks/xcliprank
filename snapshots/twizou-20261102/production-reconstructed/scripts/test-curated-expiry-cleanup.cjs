// Execute the actual cleanup CLI with fake Supabase; any non-author table is rejected.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const now=Date.now(),day=86400000,id=ms=>((BigInt(ms)-1288834974657n)<<22n).toString();
const base={is_curated:true,curated_status:'active',curated_search_expiry:null,curated_last_post_id:'success-id',curated_last_collected_at:'success-time'};
const rows=[{...base,x_author_id:'one',username:'one',curated_pending_search:{startTime:new Date(now-8*day).toISOString(),endTime:new Date(now-3600000).toISOString(),untilId:id(now-day),latestPostId:id(now-2*3600000)}},{...base,x_author_id:'two',username:'two',curated_pending_search:{startTime:new Date(now-10*day).toISOString(),endTime:new Date(now-2*day).toISOString(),untilId:id(now-8*day),latestPostId:id(now-3*day)}}];
let writes=0;
const db={from(table){assert.equal(table,'authors','free cleanup must never write/read posts or X logs');let filters=[],values;
 const q={select(){return q;},eq(k,v){filters.push(r=>typeof r[k]==='object'&&typeof v==='string'&&v.startsWith('{')?JSON.stringify(r[k])===v:r[k]===v);return q;},is(k,v){filters.push(r=>(r[k]??null)===v);return q;},not(k,op,v){filters.push(r=>r[k]!==v);return q;},order(){return q;},range(){return Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r))).map(r=>({...r})),error:null});},update(v){values=v;return q;},then(a,b){const selected=rows.filter(r=>filters.every(f=>f(r)));if(values){writes++;selected.forEach(r=>Object.assign(r,values));}return Promise.resolve({data:selected.map(r=>({x_author_id:r.x_author_id})),error:null}).then(a,b);}};return q;}};
const source=fs.readFileSync(path.join(root,'scripts/cleanup-curated-expiry.cjs'),'utf8').replace('(async()=>{','return (async()=>{');
const outputs=[];
const mocks=name=>name==='@supabase/supabase-js'?{createClient:()=>db}:name==='node:fs'?{...fs,readFileSync:(p,...args)=>String(p).endsWith('.env.production')?'SUPABASE_URL=https://offline.supabase.co\nSUPABASE_SECRET_KEY=offline-only\n':fs.readFileSync(p,...args)}:require(name);
(async()=>{
 for(let i=0;i<2;i++){
  const proc={env:{},exitCode:0};
  await new Function('require','__dirname','process','console',source)(mocks,path.join(root,'scripts'),proc,{log:(...v)=>outputs.push(v.join(' ')),error:(...v)=>outputs.push(v.join(' '))});
  assert.equal(proc.exitCode,0);
 }
 assert.equal(writes,2,'only the first run changes the two expired states');
 for(const r of rows){assert.equal(r.curated_last_post_id,'success-id');assert.equal(r.curated_last_collected_at,'success-time');assert.equal(r.curated_search_expiry.totalEvents,1);}
 assert.ok(outputs.some(s=>s.includes('"clamped":1')&&s.includes('"restarted":1')));
 console.log('PASS: actual free cleanup CLI; author-only updates; success cursors retained; repeat run unchanged');
})().catch(e=>{console.error(e);process.exitCode=1;});
