const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),ts=createRequire(path.join(root,'package.json'))('typescript');
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
require('../lib/curated-common.ts').manageCommonAuthors({operation:'migrate'}).then(r=>console.log('CURATED_COMMON_MIGRATION_OK; authors='+r.migrated+'; no provider requests; quota and positions preserved')).catch(()=>{console.error('CURATED_COMMON_MIGRATION_FAILED; retry from common management; no secrets printed');process.exitCode=1;});
