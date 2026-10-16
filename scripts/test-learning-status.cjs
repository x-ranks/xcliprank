const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createRequire}=require('node:module');
const base=path.resolve(__dirname,'..'),deps=process.env.XCLIP_TEST_DEPENDENCY_ROOT||base;
const ts=createRequire(path.join(deps,'package.json'))('typescript');
const bundle={featureSpec:'spec',trainedAt:'2026-10-15T00:00:00Z',revision:12,head:{samples:42,weights:Array(1024).fill(0.123456)},validation:{passed:true},mode:'manual_recall',adoption:{id:'fixture-adoption',at:'2026-10-15T00:00:00Z'}};
const state={'config':{enabled:true},'worker-status':{finished:true},'active-model':bundle,'video-preparation':{enabled:false},'new-video-evaluation':{enabled:true,cursor:101}};
const reads=[];let error=false,preview=true;
const forbidden=()=>{throw Error('UNEXPECTED_MUTATION');};
const db={from:name=>{assert.equal(name,'xclip_tier_state');let selection;
 return {select(value){selection=value;assert(value.includes('payload->'));assert(!value.includes('payload,')&&!value.includes('weights'));return this;},eq(column,value){assert.equal(column,'key');assert.equal(value,'active-model');return this;},async maybeSingle(){reads.push(selection);if(error)return {data:null,error:{message:'MOCK_ERROR'}};if(!state['active-model'])return {data:null,error:null};
   const data={};for(const part of selection.split(',')){const [alias,field]=part.split(':');let value={payload:state['active-model']};for(const key of field.split(/->>?/))value=value?.[key];data[alias]=value??null;}return {data,error:null};}};}};
const store={personalState:async key=>{assert.notEqual(key,'active-model');return state[key]??null;},savePersonalState:forbidden,personalFeatures:forbidden,activePersonalBundle:forbidden};
function load(rel){
 const code=ts.transpileModule(fs.readFileSync(path.join(base,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const exports={};const modules={
  'node:crypto':crypto,'node:path':{...path,default:path},
  'node:fs/promises':{readFile:async()=>{if(!preview)throw Object.assign(Error('missing'),{code:'ENOENT'});return JSON.stringify({id:'fixture-preview',model:bundle,entries:[{id:'fixture'}]});},mkdir:forbidden,writeFile:forbidden,open:forbidden,unlink:forbidden},
  './supabase-admin':{supabaseAdmin:()=>db},'./tier-personal-store':store,
  './tier-personal-core':{PERSONAL_FEATURE_SPEC:'spec'},'./tier-personal-evaluation':{PERSONAL_EVALUATION_SPEC:'eval'},
  './tier-learning':{},'./curated-collector':{}};
 vm.runInNewContext(code,{exports,require:n=>{if(n in modules)return modules[n];throw Error('UNEXPECTED_IMPORT '+n);},process:{cwd:()=>'/isolated-fixture'}});return exports;
}
(async()=>{
 const engine=load('lib/tier-personal-engine.ts'),release=load('lib/tier-model-release.ts');
 const actual=await engine.personalModelStatus();assert.deepEqual(JSON.parse(JSON.stringify(actual)),{enabled:true,status:state['worker-status'],preparation:state['video-preparation'],newVideos:state['new-video-evaluation'],active:{trainedAt:bundle.trainedAt,revision:12,samples:42,validation:{passed:true}}});
 const result=await release.releaseStatus();assert.equal(result.activeMode,'manual_recall');assert.equal(result.adoption.id,'fixture-adoption');assert.equal(result.preview.count,1);assert.equal(result.preview.modelHash,release.modelHash(bundle));
 assert.equal(reads.length,2);assert(reads[0].includes('samples:payload->head->samples'));assert.equal(reads[1],'mode:payload->>mode,adoption:payload->adoption');
 preview=false;state['active-model']=null;assert.equal((await engine.personalModelStatus()).active,null);assert.equal((await release.releaseStatus()).preview,null);
 state['active-model']={...bundle,featureSpec:'old'};assert.equal((await engine.personalModelStatus()).active,null);
 error=true;await assert.rejects(()=>engine.personalModelStatus());await assert.rejects(()=>release.releaseStatus());
 console.log('PASS LEARNING STATUS: actual status/release functions; projected JSON fields only, no model weights; same public summary/adoption/preview hash; missing/old models and DB errors; no state writes or model adoption. DB/files mocked.');
})().catch(e=>{console.error(e);process.exitCode=1;});
