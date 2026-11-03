'use strict';
// Explicit metadata-only backfill. Never an installed background task.
const fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript');
const root=path.resolve(__dirname,'..');process.chdir(root);require('@next/env').loadEnvConfig(root);
Module._extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const {createTechnicalBackfill}=require('../lib/technical-backfill.ts'),{readVideoDuration}=require('../lib/video-duration-probe.ts'),{labelPublicationRemote}=require('../lib/label-publication-server.ts');
const mode=process.argv[2],args=process.argv.slice(3);if(!['--check','--run'].includes(mode)||args.length&&!(args.length===2&&args[0]==='--limit'&&/^\d+$/.test(args[1]))){console.error('Usage: node scripts/run-video-technical-backfill.cjs --check|--run [--limit 20]');process.exit(2);}
const service=createTechnicalBackfill(path.join(root,'.local-admin/video-technical-v1'),{remote:labelPublicationRemote,probe:async url=>{const durationSeconds=await readVideoDuration(url);return durationSeconds===null?null:{durationSeconds};}});
(async()=>{const result=mode==='--check'?await service.status():await service.run(args.length?Number(args[1]):20);console.log(JSON.stringify({feature:'video_technical_backfill',mode,...result,noVideoFilesSaved:true,noInference:true,perVideoMetadataBudgetBytes:256*1024}));})().catch(error=>{console.error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'TECHNICAL_BACKFILL_FAILED');process.exitCode=1;});
