'use strict';
// Run in the isolated production checkout after npm ci. No real .env/state/API.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),deps=path.join(root,'node_modules');
assert.equal(fs.realpathSync(deps).toLowerCase(),deps.toLowerCase(),'CLEAN_PRODUCTION_DEPENDENCIES_REQUIRED');
assert(!fs.readdirSync(root).some(n=>/^\.env(?:$|\.)/.test(n)&&n!=='.env.example'),'REAL_ENV_REFUSED_FOR_OFFLINE_BUILD');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'xclip-production-build-')),home=path.join(fixture,'home');fs.mkdirSync(home);
const state=path.join(home,'protected-fixture.json'),value=JSON.stringify({quota:24,paused:['111'],removed:['222'],cursor:'preserve',privateModelFixture:true});fs.writeFileSync(state,value);const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),before=sha(fs.readFileSync(state));
try{
 const env={};for(const k of ['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP'])if(process.env[k])env[k]=process.env[k];Object.assign(env,{HOME:home,USERPROFILE:home,NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:'--require "'+path.join(root,'scripts/offline-guard.cjs').replaceAll('\\','/')+'"'});
 const r=cp.spawnSync(process.execPath,['node_modules/next/dist/bin/next','build'],{cwd:root,env,encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:3*1024*1024});if(r.stdout)process.stdout.write(r.stdout);if(r.stderr)process.stderr.write(r.stderr);
 assert.equal(r.status,0,'PRODUCTION_BUILD_FAILED');assert.equal(sha(fs.readFileSync(state)),before);assert(fs.existsSync(path.join(root,'.next/standalone/server.js')),'STANDALONE_SERVER_MISSING');
 console.log('PUBLIC_PRODUCTION_STANDALONE_BUILD_OK; actual configuration, clean production dependencies, no env/provider/database, isolated home/state; unchanged fixture.');
}finally{assert.equal(path.dirname(path.resolve(fixture)),path.resolve(os.tmpdir()));assert(path.basename(fixture).startsWith('xclip-production-build-'));fs.rmSync(fixture,{recursive:true,force:true});}
