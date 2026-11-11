'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{root,verify}=require('./verify-current-manifest.cjs');
const count=verify('docs/current-local-source-20261111.json',root);
const ts=JSON.parse(fs.readFileSync(path.join(root,'tsconfig.json'),'utf8'));
assert(ts.exclude.includes('snapshots')&&ts.exclude.includes('releases')&&ts.exclude.includes('production'));
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8')).git.deploymentEnabled,false);
for(const line of fs.readFileSync(path.join(root,'.env.example'),'utf8').split(/\r?\n/))if(line&&!line.startsWith('#'))assert(/^[A-Z0-9_]+=$/.test(line));
console.log('CANONICAL_LOCAL_SOURCE_OK; '+count+' exact files; private configuration excluded; Vercel git deployment disabled');
