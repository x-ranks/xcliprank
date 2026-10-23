'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const pkg=__dirname,defaultRoot='C:/Projects/xcliprank';
const root=process.env.XCLIP_LOCAL_SYNC_TEST==='1'&&process.env.XCLIP_LOCAL_SYNC_TEST_ROOT?path.resolve(process.env.XCLIP_LOCAL_SYNC_TEST_ROOT):path.resolve(defaultRoot);
const backupParent=path.join(path.dirname(root),'xcliprank-local-backups');
const manifest=JSON.parse(fs.readFileSync(path.join(pkg,'manifest.json'),'utf8'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function target(rel){
  if(typeof rel!=='string'||! /^(?:middleware\.ts|(?:app|lib|public|scripts)\/[A-Za-z0-9_./\[\]-]+)$/.test(rel)||rel.includes('..'))throw Error('INVALID_FILE_PATH');
  const abs=path.resolve(root,rel);
  if(!abs.startsWith(root+path.sep))throw Error('TARGET_OUTSIDE_PROJECT');
  return abs;
}
if(manifest.release!=='twizou-auto-label-followup-v1-20261024-local'||!Array.isArray(manifest.files)||manifest.files.length!==8||new Set(manifest.files.map(f=>f.path)).size!==8)throw Error('MANIFEST_INVALID');
if(!fs.existsSync(path.join(root,'package.json'))||!fs.existsSync(path.join(root,'node_modules/typescript/bin/tsc')))throw Error('LOCAL_PROJECT_MISSING');
const mode=process.argv[2]??'--check';
if(!['--check','--apply','--rollback'].includes(mode))throw Error('USAGE: node apply-local.cjs [--check|--apply|--rollback BACKUP_DIRECTORY]');
function inspect(){
  let baseline=0,candidate=0;
  for(const row of manifest.files){
    if(!/^[a-f0-9]{64}$/.test(row.candidateSha256)||(row.baselineSha256!==null&&!/^[a-f0-9]{64}$/.test(row.baselineSha256)))throw Error('MANIFEST_HASH_INVALID');
    const from=path.join(pkg,row.path),to=target(row.path);
    if(!fs.existsSync(from)||hash(from)!==row.candidateSha256)throw Error('PAYLOAD_CORRUPT_'+row.path);
    const actual=fs.existsSync(to)?hash(to):null;
    if(actual===row.candidateSha256)candidate++;
    else if(actual===row.baselineSha256)baseline++;
    else throw Error('LOCAL_SOURCE_CHANGED_'+row.path);
  }
  return {baseline,candidate};
}
function restore(backup,rows){
  for(const row of rows.slice().reverse()){
    const to=target(row.path);
    if(row.baselineSha256===null){if(fs.existsSync(to))fs.unlinkSync(to)}
    else {const from=path.join(backup,row.path);if(!fs.existsSync(from)||hash(from)!==row.baselineSha256)throw Error('BACKUP_CORRUPT_'+row.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to)}
  }
}
if(mode==='--rollback'){
  if(process.argv.length!==4)throw Error('ROLLBACK_BACKUP_REQUIRED');
  const backup=path.resolve(process.argv[3]);
  if(!backup.startsWith(path.resolve(backupParent)+path.sep))throw Error('BACKUP_OUTSIDE_EXPECTED_DIRECTORY');
  const record=JSON.parse(fs.readFileSync(path.join(backup,'rollback.json'),'utf8'));
  if(record.release!==manifest.release||record.root!==root||record.files.length!==manifest.files.length)throw Error('BACKUP_RECORD_MISMATCH');
  if(inspect().candidate!==manifest.files.length)throw Error('LOCAL_CHANGED_SINCE_APPLY');
  restore(backup,record.files);
  console.log('LOCAL_SYNC_ROLLBACK_COMPLETE backup='+backup);
  process.exit(0);
}
const state=inspect();
if(state.candidate===manifest.files.length){console.log('LOCAL_SYNC_ALREADY_APPLIED');process.exit(0)}
if(state.baseline!==manifest.files.length)throw Error('LOCAL_MIXED_STATE; no files changed');
console.log('LOCAL_PRECHECK_OK files='+state.baseline+'; no changes');
if(mode==='--check')process.exit(0);
if(process.argv.length!==3)throw Error('UNEXPECTED_ARGUMENTS');
const backup=path.join(backupParent,'twizou-auto-label-followup-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(backup,{recursive:true});
for(const row of manifest.files){if(row.baselineSha256!==null){const from=target(row.path),to=path.join(backup,row.path);fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);if(hash(to)!==row.baselineSha256)throw Error('BACKUP_VERIFY_FAILED_'+row.path)}}
fs.writeFileSync(path.join(backup,'rollback.json'),JSON.stringify({release:manifest.release,root,files:manifest.files},null,2)+'\n');
console.log('LOCAL_BACKUP='+backup);
const touched=[];
try{
  for(const row of manifest.files){
    const from=path.join(pkg,row.path),to=target(row.path);
    fs.mkdirSync(path.dirname(to),{recursive:true});touched.push(row);fs.copyFileSync(from,to);
    if(hash(to)!==row.candidateSha256)throw Error('COPY_VERIFY_FAILED_'+row.path);
  }
  const checks=[['node_modules/typescript/bin/tsc','--noEmit'],['scripts/test-label-auto.cjs'],['scripts/test-label-learning.cjs'],['scripts/run-auto-label-worker.cjs','--check']];
  for(const [script,...args] of checks){
    const result=spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024});
    if(result.status!==0)throw Error('LOCAL_CHECK_FAILED '+script+'\n'+(result.stdout??'')+'\n'+(result.stderr??''));
  }
  console.log('LOCAL_SYNC_APPLIED files='+manifest.files.length+' backup='+backup);
}catch(error){
  try{restore(backup,touched);console.error('LOCAL_SYNC_FAILED_PREVIOUS_FILES_RESTORED '+String(error))}
  catch(restoreError){console.error('LOCAL_SYNC_RESTORE_FAILED backup='+backup+' error='+String(restoreError))}
  process.exitCode=1;
}

