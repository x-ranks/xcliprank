'use strict';
// Local-only worker. The trained model, frames and video bytes never leave this PC.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
process.chdir(root);
require('@next/env').loadEnvConfig(root);
Module._extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const {autoLabels}=require('../lib/label-auto-server.ts');
const {acquirePublicOperation}=require('../lib/public-operation-lock.ts');
const mode=process.argv[2];
if(!['--check','--run'].includes(mode)||process.argv.length!==3){console.error('Usage: node scripts/run-auto-label-worker.cjs --check|--run');process.exit(2);}
const summary=v=>({phase:v.phase,revision:v.revision,counts:v.counts,message:v.message,updatedAt:v.updatedAt});
const stateDir=path.join(root,'.local-admin','label-auto-v1');
function report(name,data){
  const line=JSON.stringify({at:new Date().toISOString(),name,...data});
  console.log(line);
  if(mode==='--run'){
    const log=path.join(stateDir,'worker-runs.log');
    let size=0;
    try { const stat=fs.lstatSync(log);if(!stat.isFile()||stat.isSymbolicLink())throw Error('LABEL_AUTO_WORKER_LOG_UNSAFE');size=stat.size; }
    catch(e){if(e.code!=='ENOENT')throw e;}
    if(size<1024*1024)fs.appendFileSync(log,line+'\n',{mode:0o600});
  }
}
async function main(){
  const initial=await autoLabels.status();
  if(mode==='--check') {report('AUTO_LABEL_WORKER_PRECHECK',summary(initial));return;}
  await fs.promises.mkdir(stateDir,{recursive:true,mode:0o700});
  const lock=await acquirePublicOperation(path.join(stateDir,'worker.lock'),'LABEL_AUTO_WORKER_BUSY');
  let steps=0;
  try{
    let v=await autoLabels.status();
    if(v.phase==='blocked'){report('AUTO_LABEL_WORKER_BLOCKED',summary(v));return;}
    if(v.phase==='completed'&&v.updatedAt&&Date.now()-Date.parse(v.updatedAt)<2*60*60*1000){report('AUTO_LABEL_WORKER_RECENT_CYCLE',summary(v));return;}
    if(v.phase==='idle'||v.phase==='completed'||v.phase==='paused')v=await autoLabels.mutate({action:v.phase==='completed'?'new':'start',revision:v.revision,threshold:v.threshold});
    const deadline=Date.now()+150*60*1000;
    while(v.phase==='running'&&Date.now()<deadline&&steps<15000){
      v=await autoLabels.mutate({action:'step',revision:v.revision});steps++;
      if(v.phase==='running')await new Promise(resolve=>setTimeout(resolve,1000));
    }
    report('AUTO_LABEL_WORKER_RESULT',{steps,...summary(v)});
    if(v.phase==='blocked'||v.phase==='paused')process.exitCode=1;
  }finally{await lock.release();}
}
main().catch(e=>{const code=e instanceof Error?e.message:'UNKNOWN';try{if(mode==='--run'&&fs.existsSync(stateDir))report('AUTO_LABEL_WORKER_FAILED',{code});else console.error('AUTO_LABEL_WORKER_FAILED',code);}catch{console.error('AUTO_LABEL_WORKER_FAILED',code);}process.exitCode=1;});
