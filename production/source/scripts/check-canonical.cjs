'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),mode=process.argv[2]||'test';
if(!['test','build','types'].includes(mode))throw Error('INVALID_CHECK_MODE');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-canonical-check-'));
const inside=p=>{const rel=path.relative(fixture,p);return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);};
function copy(dir){const target=path.join(fixture,dir);fs.mkdirSync(target,{recursive:true});for(const entry of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){
 const rel=path.join(dir,entry.name);if(entry.isSymbolicLink())throw Error('SOURCE_SYMLINK_REFUSED');
 if(entry.isDirectory())copy(rel);else fs.copyFileSync(path.join(root,rel),path.join(fixture,rel));
}}
const deps=path.join(root,'node_modules');
const report={mode,passed:[],skipped:[],failures:[],network:'denied',realState:'denied'};
try{
 for(const dir of ['app','lib','scripts','sql','supabase'])copy(dir);
 for(const file of ['package.json','package-lock.json','next-env.d.ts','tsconfig.json','next.config.ts','middleware.ts'])fs.copyFileSync(path.join(root,file),path.join(fixture,file));
 fs.symlinkSync(fs.realpathSync(deps),path.join(fixture,'node_modules'),process.platform==='win32'?'junction':'dir');
 const home=path.join(fixture,'test-home');fs.mkdirSync(home);
 const protectedFiles={
  '.local-admin/fixtures/registration.json':{authors:Array.from({length:101},(_,i)=>({id:String(1000+i),paused:i===4}))},
  'test-home/.xclip-patrol-fixture/quota.json':{reservations:Array.from({length:24},(_,i)=>({author:String(1000+i),at:'2026-10-16T00:00:00Z'}))},
  'test-home/.xclip-patrol-fixture/manual-removals.json':{removed:['1001','1002','1003','1004','1005','1006']},
  '.local-admin/fixtures/cursors.json':{author:'1000',cursor:'fixture-cursor',lowerBound:'123',paused:true},
  'data/fixture-teacher-model.json':{privateFixture:true,seeds:[{label:'A'}],weights:[1,2,3]}
 };
 const hashes=new Map();
 for(const [rel,value]of Object.entries(protectedFiles)){const p=path.join(fixture,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(value));hashes.set(p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));}
 const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];
 Object.assign(env,{HOME:home,USERPROFILE:home,NEXT_TELEMETRY_DISABLED:'1',XCLIP_TEST_DEPENDENCY_ROOT:fixture,
  NODE_OPTIONS:'--require "'+path.join(fixture,'scripts/offline-guard.cjs').replaceAll('\\','/')+'"'});
 const run=args=>cp.spawnSync(process.execPath,args,{cwd:fixture,env,encoding:'utf8',windowsHide:true,timeout:mode==='test'?45000:240000,maxBuffer:2*1024*1024});
 if(mode==='test'){
  const optional=new Set(['test-tier-four-frames.cjs','test-tier-compatible-playback.cjs']);
  for(const name of fs.readdirSync(path.join(fixture,'scripts')).filter(n=>/^test-.*\.cjs$/.test(n)).sort()){
   if(optional.has(name)){report.skipped.push({name,reason:'Requires external FFmpeg/FFprobe; run separately with installed tools'});continue;}
   const r=run(['scripts/'+name]);
   if(r.status===0){report.passed.push(name);console.log('PASS '+name);}else{report.failures.push({name,status:r.status,output:(r.stderr||r.stdout||String(r.error)).slice(-5000)});console.error('FAIL '+name);}
  }
 }else{
  const r=run(mode==='types'?['node_modules/typescript/bin/tsc','--noEmit']:['node_modules/next/dist/bin/next','build']);
  if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
  if(r.status!==0)report.failures.push({name:mode,status:r.status});else report.passed.push(mode);
 }
 for(const [p,h]of hashes)if(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')!==h)report.failures.push({name:'STATE_FIXTURE_CHANGED',file:path.relative(fixture,p)});
 fs.writeFileSync(path.join(root,'.canonical-check-report-'+mode+'.json'),JSON.stringify(report,null,2)+'\n');
 console.log('CANONICAL_CHECK_REPORT='+JSON.stringify({mode,passed:report.passed.length,skipped:report.skipped,failures:report.failures.map(x=>({name:x.name,status:x.status,output:x.output?.slice(-1500)})),network:report.network,realState:report.realState}));
 if(report.failures.length)process.exitCode=1;
}finally{
 const link=path.join(fixture,'node_modules');if(fs.existsSync(link))fs.unlinkSync(link);
 if(!inside(path.join(fixture,'app'))||!path.basename(fixture).startsWith('xclip-canonical-check-'))throw Error('UNSAFE_CLEANUP_TARGET');
 fs.rmSync(fixture,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
