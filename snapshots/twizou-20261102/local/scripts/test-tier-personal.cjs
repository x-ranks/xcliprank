const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path');
const loaded=new Map();
function load(id){if(loaded.has(id))return loaded.get(id).exports;const m={exports:{}};loaded.set(id,m);
 const code=ts.transpileModule(fs.readFileSync(id+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const req=name=>name.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(id),name))):require(name);
 new Function('require','module','exports',code)(req,m,m.exports);return m.exports;}
const c=load('lib/tier-personal-core');
const samples=Array.from({length:180},(_,i)=>({id:String(i),author:'u'+Math.floor(i/6),label:c.PERSONAL_CLASSES[i%6],features:Array.from({length:1024},(_,j)=>j%6===i%6?1+0.001*(i%7):0)}));
const head=c.trainPersonal(samples);
assert(c.validPersonalHead(head));
assert.equal(samples.filter(s=>c.predictPersonal(s.features,head).label===s.label).length,samples.length);
assert.deepEqual(c.trainPersonal(samples).weights,head.weights,'deterministic');
assert.throws(()=>c.trainPersonal(samples.map((s,i)=>i? s:{...s,features:[NaN]})));
assert.throws(()=>c.projectEmbedding([Infinity]));
assert.equal(c.projectEmbedding(Array(2048).fill(1)).length,256);
assert.equal(c.safeAutomaticTier('X'),'D');
const partial=samples.map(s=>({...s,label:['B','C','D'].includes(s.label)?'OTHER':s.label}));
const phead=c.trainPersonal(partial);
for(const s of partial.filter(s=>s.label==='OTHER')){const p=c.predictPersonal(s.features,phead).probabilities;assert(p[2]+p[3]+p[4]>0.8,'OTHER is a partial low-tier label');}
console.log('PASS: supervised head, deterministic training, partial labels, finite guards, low-rating X does not become a safety block');
console.log('Synthetic results do not establish accuracy on user videos.');
// Real packaged frozen network + sharp decoder, with an in-memory image fixture.
(async()=>{
 const sharp=require('sharp'),tf=require('@tensorflow/tfjs');
 const image=await sharp({create:{width:224,height:224,channels:3,background:{r:120,g:70,b:30}}}).png().toBuffer();
 const originalFetch=global.fetch;global.fetch=async url=>{assert.equal(new URL(url).hostname,'pbs.twimg.com');return new Response(image,{headers:{'content-type':'image/png'}});};
 try{const {extractPersonalImage}=load('lib/tier-personal-image');
   await assert.rejects(extractPersonalImage('https://example.com/a.png'));
   const first=await extractPersonalImage('https://pbs.twimg.com/fixture.png');assert.equal(first.length,256);assert(first.every(Number.isFinite));
   const tensors=tf.memory().numTensors;
   const second=await extractPersonalImage('https://pbs.twimg.com/fixture.png');assert.deepEqual(second,first);assert.equal(tf.memory().numTensors,tensors,'inference tensors disposed');
   console.log('PASS: actual bundled MobileNetV2 embedding, sharp image preprocessing, 256 features, URL restriction, reusable network, no tensor leak or X API calls');
 }finally{global.fetch=originalFetch;}
})().catch(e=>{console.error(e);process.exitCode=1;});
