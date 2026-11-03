const fs=require('fs'),path=require('path'),{createRequire}=require('module');
const root=path.resolve(__dirname,'..'),ts=createRequire(path.join(root,'package.json'))('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const args=process.argv.slice(2);
if(args.length>1||args.length===1&&args[0]!=='--verify-random-five'){console.error('FX_CURATED_INVALID_ARGUMENT; no scan started');process.exit(2);}
require('../lib/free-curated-scan.ts').scanFreeCurated(args.length?{verification:'random-five'}:{}).then(stats=>{
 console.log(JSON.stringify({...stats,at:new Date().toISOString()}));
 if(stats.verification){
  console.log(stats.verification.result==='PASSED'?'XCLIP_FX_RANDOM_FIVE_PASSED':stats.verification.result==='FAILED'?'XCLIP_FX_RANDOM_FIVE_FAILED':'XCLIP_FX_RANDOM_FIVE_WAITING; keep quota/24h/interval; retry at a later eligible window');
  if(stats.verification.result==='FAILED')process.exitCode=1;
  if(stats.verification.result==='WAITING')process.exitCode=3;
 }
})
 .catch(()=>{console.error('FX_CURATED_SCAN_FAILED; watermark/quota preserved; inspect state/DB/connectivity');process.exitCode=1;});
