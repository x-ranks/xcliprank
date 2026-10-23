'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=process.env.XCLIP_LOCAL_SYNC_TEST==='1'&&process.env.XCLIP_LOCAL_SYNC_TEST_ROOT?path.resolve(process.env.XCLIP_LOCAL_SYNC_TEST_ROOT):path.resolve('C:/Projects/xcliprank');
const target=path.join(root,'scripts','install-auto-label-task.ps1');
const source=path.join(__dirname,'install-auto-label-task.ps1');
const backupParent=path.join(path.dirname(root),'xcliprank-local-backups');
const baseline='22df68361cb6c97120a0bfe223c63d2ec54ec589e7e5573dfd3fdda6ac9f1805';
const candidate='a6760d5532ecbeca5599704e6c1a1ead70cc2eda770bbffea29ba65c35676f71';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function check(){
  if(!fs.existsSync(target)||!fs.existsSync(source)||hash(source)!==candidate)throw Error('TASK_SCRIPT_PAYLOAD_OR_TARGET_MISSING');
  const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('TASK_SCRIPT_UNSAFE');
  const current=hash(target);if(current!==baseline&&current!==candidate)throw Error('TASK_SCRIPT_UNKNOWN_VERSION');
  return current;
}
const mode=process.argv[2];
if(!['--check','--apply','--rollback'].includes(mode))throw Error('USAGE: node apply-task-fix1.cjs --check|--apply|--rollback BACKUP');
if(mode==='--rollback'){
  if(process.argv.length!==4)throw Error('BACKUP_REQUIRED');
  const backup=path.resolve(process.argv[3]);if(!backup.startsWith(backupParent+path.sep))throw Error('BACKUP_OUTSIDE_EXPECTED_DIRECTORY');
  if(check()!==candidate)throw Error('TASK_SCRIPT_CHANGED_SINCE_APPLY');
  const original=path.join(backup,'install-auto-label-task.ps1');if(!fs.existsSync(original)||hash(original)!==baseline)throw Error('BACKUP_INVALID');
  fs.copyFileSync(original,target);if(hash(target)!==baseline)throw Error('ROLLBACK_VERIFY_FAILED');
  console.log('TASK_SCRIPT_ROLLBACK_COMPLETE backup='+backup);process.exit(0);
}
const current=check();if(current===candidate){console.log('TASK_SCRIPT_ALREADY_FIXED; no changes');process.exit(0);}
console.log('TASK_SCRIPT_PRECHECK_OK; no changes');if(mode==='--check')process.exit(0);
if(process.argv.length!==3)throw Error('UNEXPECTED_ARGUMENTS');
const backup=path.join(backupParent,'twizou-auto-label-task-fix1-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
fs.mkdirSync(backup,{recursive:true});const saved=path.join(backup,'install-auto-label-task.ps1');fs.copyFileSync(target,saved);if(hash(saved)!==baseline)throw Error('BACKUP_VERIFY_FAILED');
console.log('TASK_SCRIPT_BACKUP='+backup);
try{
  fs.copyFileSync(source,target);if(hash(target)!==candidate)throw Error('COPY_VERIFY_FAILED');
  const encoded=Buffer.from(target,'utf16le').toString('base64');
  const script=`$p=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}'));$t=$null;$e=$null;[System.Management.Automation.Language.Parser]::ParseFile($p,[ref]$t,[ref]$e)|Out-Null;if($e.Count){exit 1}`;
  const validation=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-Command',script],{encoding:'utf8',timeout:30000});
  if(validation.status!==0)throw Error('POWERSHELL_PARSE_FAILED');
  console.log('TASK_SCRIPT_FIX1_APPLIED backup='+backup);
}catch(error){fs.copyFileSync(saved,target);console.error('TASK_SCRIPT_FIX1_FAILED_PREVIOUS_FILE_RESTORED '+String(error));process.exitCode=1;}
