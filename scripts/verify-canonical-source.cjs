'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/canonical-source-baseline-20261016.json'),'utf8'));
const exceptions=new Set(['package.json','scripts/test-learning-poll.cjs','scripts/test-learning-status.cjs','scripts/test-playback-component.cjs','scripts/test-tier-model-release.cjs','scripts/test-tier-teacher-analysis.cjs']);
let checked=0;
for(const [name,record]of Object.entries(manifest.files)){
 const p=path.join(root,name);assert(fs.existsSync(p),'MISSING_SOURCE '+name);
 if(exceptions.has(name))continue;
 const actual=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');assert.equal(actual,record.sha256,'SOURCE_MISMATCH '+name);checked++;
}
const ts=JSON.parse(fs.readFileSync(path.join(root,'tsconfig.json'),'utf8'));
assert(ts.exclude.includes('snapshots')&&ts.exclude.includes('releases'));
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).git.deploymentEnabled,false);
for(const line of fs.readFileSync(path.join(root,'.env.example'),'utf8').split(/\r?\n/))if(line&&!line.startsWith('#'))assert(/^[A-Z0-9_]+=$/.test(line));
console.log('CANONICAL_LOCAL_SOURCE_OK; '+checked+' exact source hashes; private configuration excluded; Vercel git deployment disabled.');
console.log('PRODUCTION_SOURCE_PENDING: six differing playback files and full live-source inventory still required; root is the complete local management code.');
