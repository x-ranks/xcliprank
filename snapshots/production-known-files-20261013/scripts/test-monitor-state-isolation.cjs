const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),assert=require('node:assert/strict');
// Synthetic inherited state only: do not read the caller's real state directories.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-test-isolation-'));
try{
 const removals=path.join(directory,'manual-removals-v1.json');
 const bytes=Buffer.from(JSON.stringify({version:1,entries:[1,2,3].map(n=>({id:String(997000+n),username:'removed'+n,at:1}))}));
 fs.writeFileSync(removals,bytes,{flag:'wx',mode:0o600});
 const snapshot=fs.readdirSync(directory);
 for(const name of ['test-availability-monitor.cjs','test-availability-curated-regression.cjs']){
  const result=cp.spawnSync(process.execPath,[path.join(__dirname,name)],{encoding:'utf8',timeout:120000,
   env:{...process.env,XCLIP_FREE_CURATED_STATE_DIR:directory}});
  assert.ifError(result.error);assert.equal(result.status,0,name+'\n'+result.stdout+'\n'+result.stderr);
  assert.deepEqual(fs.readFileSync(removals),bytes,'inherited removal registry must remain unchanged');
  assert.deepEqual(fs.readdirSync(directory),snapshot,'no files added to inherited registry');
 }
 console.log('PASS MONITOR STATE ISOLATION: both monitor tests pass with 3 inherited removals / 6 keys; inherited registry bytes unchanged; no real state/provider/DB access.');
}finally{fs.rmSync(directory,{recursive:true,force:true});}
