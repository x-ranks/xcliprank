'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{root,verify}=require('./verify-current-manifest.cjs');
// Preserve the historical 2026-10-18 live snapshot independently of the new source.
const baseline=JSON.parse(fs.readFileSync(path.join(root,'docs/production-source-baseline-20261018.json'),'utf8'));
for(const [name,row] of Object.entries(baseline.files))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'snapshots/production-live-20261018',name))).digest('hex'),row.sha256,'HISTORICAL_SNAPSHOT_CHANGED '+name);
const count=verify('docs/current-production-source-20261111.json',path.join(root,'production/source'));
console.log('PRODUCTION_SOURCE_OK; '+count+' current source files and historical snapshot verified; no configuration values or runtime state');
