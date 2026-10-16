const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'xclip-tier-test-'));
let modelRefresh = false, calls = 0;
const rows = Array.from({length:203}, (_,i)=>({id:i+1,x_post_id:String(100+i),author_id:'author',adult_tier:'B',effective_adult_score:0.67,adult_score:0.6,creator_score:0.5,possibly_sensitive:true,manual_tier:null,content_category:'PASS',moderation_blocked:false,review_required:false,is_visible:true,video_url:'https://example.test/video.mp4'}));
rows[202].manual_tier = 'S';
function db() { return {from(table) {
 let filters=[],patch=null,limit=Infinity,sort=false;
 const q={or(){return q;},select(){return q;}, is(k,v){filters.push(r=>r[k]===v);return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},not(k,op,v){filters.push(r=>op==='is'?r[k]!==v:!v.replace(/[()]/g,'').split(',').includes(r[k]));return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){sort=true;return q;},limit(v){limit=v;return q;},update(v){patch=v;return q;},then(a,b){return Promise.resolve().then(()=>{calls++;let source=table==='authors'?[{x_author_id:'author',review_required:false,is_curated:true}]:rows;let selected=source.filter(r=>filters.every(f=>f(r)));if(sort)selected.sort((a,b)=>a.id-b.id);selected=selected.slice(0,limit);if(patch)selected.forEach(r=>Object.assign(r,patch));return {data:selected.map(r=>({...r})),error:null};}).then(a,b);}};return q;
 }};}
const cache=new Map();
function load(id) {
 if(id==='lib/supabase-admin')return {supabaseAdmin:db};
 if(id==='lib/curated-collector')return {calculateTier:()=>({tier:'B',score:0.67}),applyCuratedTierFloor:r=>r};
 if(id==='lib/tier-learning')return {loadTierLearningModel:async force=>{modelRefresh=force;return {samples:Array(100).fill({}),trainedAt:'test'};},predictLearnedTier:()=>({tier:'A'}),blendRuleAndLearnedTier:()=>({tier:'A',score:0.8})};
 if(cache.has(id))return cache.get(id).exports;
 const m={exports:{}};cache.set(id,m);
 const source=fs.readFileSync(path.join(root,id+'.ts'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 new Function('require','module','exports','process',code)(name=>name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),name))):require(name),m,m.exports,{cwd:()=>temp});
 return m.exports;
}
(async()=>{
 const lib=load('lib/tier-reevaluation');
 let job=await lib.runReevaluation('start');
 assert(modelRefresh);assert.equal(rows[0].adult_tier,'B');
 job=await lib.runReevaluation('scan',job.id);assert.equal(job.phase,'scanning');assert.equal(job.total,200);
 job=await lib.runReevaluation('scan',job.id);assert.equal(job.phase,'ready');assert.equal(job.total,202);
 assert.equal(rows[0].adult_tier,'B','preview must not write DB');
 rows[0].manual_tier='S';rows[1].moderation_blocked=true;rows[2].effective_adult_score=0.92;
 await assert.rejects(lib.runReevaluation('apply','wrong-id'));
 do {job=await lib.runReevaluation('apply',job.id);} while(job.phase==='applying');
 assert.equal(job.skipped,3);assert.equal(job.applied,199);
 assert.equal(rows[0].manual_tier,'S');assert.equal(rows[0].adult_tier,'B');assert.equal(rows[1].adult_tier,'B');assert.equal(rows[2].effective_adult_score,0.92);
 assert.equal(rows[3].adult_tier,'A');assert.equal(rows[202].adult_tier,'B');
 const status=await lib.reevaluationStatus();assert.equal(status.samples.length,50);assert.equal(status.sampleScope,'applied');assert.equal(new Set(status.samples.map(r=>r.id)).size,50);
 assert(status.samples.every(r=>r.adult_tier==='A'&&r.before==='B'&&r.proposed==='A'));
 // Simulate an interruption after DB commit but before local acknowledgement.
 const jf=path.join(temp,'.local-admin/tier-reevaluation/latest.json');const persisted=JSON.parse(fs.readFileSync(jf,'utf8'));
 persisted.phase='applying';persisted.entries.find(e=>e.row.id===6).status='writing';fs.writeFileSync(jf,JSON.stringify(persisted));
 job=await lib.runReevaluation('apply',job.id);assert.equal(job.phase,'done');assert.equal(job.applied,199,'unacknowledged commit recovered');
 // Manual review and concurrent changes after application must survive rollback.
 rows[3].manual_tier='S';rows[4].effective_adult_score=0.91;
 do {job=await lib.runReevaluation('restore',job.id);} while(job.phase==='restoring');
 assert.equal(job.phase,'restored');assert.equal(job.restored,197);assert.equal(job.restoreConflicts,2);
 assert.equal(rows[3].adult_tier,'A');assert.equal(rows[4].effective_adult_score,0.91);assert.equal(rows[5].adult_tier,'B');assert.equal(rows[5].effective_adult_score,0.67);
 const values=[1,2,3];assert.equal(lib.randomSample(values).length,3);assert.deepEqual(values,[1,2,3]);
 console.log('PASS: preview read-only, pagination, fresh model, manual/safety/score CAS protection, saved-only random 50, originals retained; CAS rollback protects manual and concurrent changes; no X calls');
})().finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
