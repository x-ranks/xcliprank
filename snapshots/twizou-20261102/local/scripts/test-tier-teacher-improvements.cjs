const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path');
const loaded=new Map();
function load(id){if(loaded.has(id))return loaded.get(id).exports;const m={exports:{}};loaded.set(id,m);
 const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=name=>name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),name))):require(name);
 new Function('require','module','exports',code)(req,m,m.exports);return m.exports;}
const e=load('lib/tier-personal-evaluation');
const seed=(i,label,source='manual_db')=>({id:String(i),author:'a'+Math.floor(i/5),label,source,image:null,video:'https://video.twimg.com/'+i+'.mp4',adultScore:0.5,creatorScore:0.5,sensitive:true,features:Array.from({length:1024},(_,j)=>j%5===i%5?1+i*0.000001:0)});
assert.equal(e.rankingTeacherLabel({...seed(1,'X'),reviewReason:'weak_content'}),'D');
for(const reason of ['ai_generated','out_of_scope','policy_violation','other',null])assert.equal(e.rankingTeacherLabel({...seed(1,'X'),reviewReason:reason}),null);
assert.equal(e.rankingTeacherLabel(seed(1,'S')),'S');
const samples=Array.from({length:400},(_,i)=>seed(i,['S','A','B','C','D'][i%5],i%7===0?'reference':'manual_db'));
samples[10].features=samples[30].features; // same features join different authors into one partition
const p=e.partitionTeachers(samples);
for(const [a,b] of [[p.train,p.tuning],[p.train,p.test],[p.tuning,p.test]]){
 const authors=new Set(a.map(s=>s.author)),features=new Set(a.map(s=>JSON.stringify(s.features)));
 assert(!b.some(s=>authors.has(s.author)),'author leak');assert(!b.some(s=>features.has(JSON.stringify(s.features))),'feature leak');
}
const rows=items=>items.filter(s=>s.source==='manual_db').map(s=>({id:s.id,actual:s.label,baseline:'B',features:s.features}));
const comparison=e.compareTeacherSources(p.train,rows(p.tuning),rows(p.test));
assert(comparison.head);assert.equal(comparison.validation.selectionUsesFinalTest,false);assert.equal(comparison.validation.refitAfterTest,false);
const changed=e.compareTeacherSources(p.train,rows(p.tuning),rows(p.test).map(s=>({...s,actual:'D'})));
assert.equal(changed.validation.selectedMode,comparison.validation.selectedMode,'test labels cannot choose model');
assert.deepEqual(changed.head.weights,comparison.head.weights,'test labels cannot train model');
const manual=comparison.validation.candidates.find(c=>c.mode==='manual_only');
assert.equal(manual.trainingCount,p.train.filter(s=>s.source==='manual_db').length);
const health=e.summarizeFeatureHealth([seed(1,'S'),seed(2,'A'),{...seed(3,'X'),video:null,reviewReason:'ai_generated'}],new Map([
 ['1',{source_url:seed(1,'S').video,feature_spec:'test',features:Array(1024).fill(0),retry_after:null}],
 ['2',{source_url:seed(2,'A').video,feature_spec:'test',features:null,retry_after:'2099-01-01',error:'VIDEO_UNAVAILABLE'}]
]),'test');
assert.equal(health.byTier.S.usable,1);assert.equal(health.byTier.A.failed,1);assert.equal(health.causes.VIDEO_UNAVAILABLE,1);assert.equal(health.causes.NO_VIDEO_URL,1);assert.equal(health.excludedX,1);
assert.equal(e.featureFailureCode('https://example.com?secret=abc'),'OTHER_RECORDED_ERROR');
console.log('PASS: reason-aware X labels; author/fingerprint-separated train/tune/test; same manual evaluation rows; selection independent of test labels; no test refit; failure counts without sensitive text');
console.log('Synthetic tests verify the comparison logic, not accuracy on the user\'s videos.');
